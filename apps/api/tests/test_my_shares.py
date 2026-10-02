from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core import auth_middleware
from app.models.conversation_event import ConversationEvent
from app.models.share import Share
from test_auth import auth_client, owner_login  # noqa: F401


def register(client: TestClient, name: str) -> None:
    client.cookies.clear()
    assert owner_login(client).status_code == 200
    assert client.put('/api/admin/access/registration', json={'mode': 'OPEN', 'require_admin_approval': False, 'email_verification_enabled': False}).status_code == 200
    client.cookies.clear()
    password = 'synthetic share test passphrase'
    response = client.post('/api/auth/register', json={'email': f'{name}@example.test', 'password': password, 'confirm_password': password})
    assert response.status_code == 201


def conversation(client: TestClient, title: str) -> dict:
    response = client.post('/api/conversations', json={'title': title, 'messages': [
        {'role': 'user', 'content_markdown': 'Synthetic public question'},
        {'role': 'assistant', 'content_markdown': 'Synthetic private answer'},
    ]})
    assert response.status_code == 201
    return response.json()['conversation']


def share(client: TestClient, conversation_id: str, title: str = 'Synthetic share') -> dict:
    response = client.post(f'/api/conversations/{conversation_id}/shares', json={'title': title})
    assert response.status_code == 200
    return response.json()


def test_my_shares_filters_paging_and_account_boundary(auth_client: TestClient) -> None:
    register(auth_client, 'share-a')
    first = conversation(auth_client, 'Source 100% complete')
    shares = [share(auth_client, first['id'], f'Link {index:02d}') for index in range(23)]
    other = conversation(auth_client, 'Other source')
    extra = share(auth_client, other['id'])
    with auth_middleware.SessionLocal() as db:
        db.get(Share, UUID(shares[0]['id'])).expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    assert auth_client.post(f"/api/shares/{shares[1]['id']}/revoke").status_code == 200
    page = auth_client.get('/api/shares', params={'limit': 20}).json()
    assert page['total'] == 24 and len(page['items']) == 20 and page['has_more']
    second = auth_client.get('/api/shares', params={'limit': 20, 'offset': 20}).json()
    assert len(second['items']) == 4 and not second['has_more']
    assert len({item['id'] for item in page['items'] + second['items']}) == 24
    assert auth_client.get('/api/shares', params={'status': 'active'}).json()['total'] == 22
    assert auth_client.get('/api/shares', params={'status': 'expired'}).json()['items'][0]['id'] == shares[0]['id']
    assert auth_client.get('/api/shares', params={'status': 'revoked'}).json()['items'][0]['id'] == shares[1]['id']
    assert auth_client.get('/api/shares', params={'q': '%'}).json()['total'] == 23
    assert auth_client.get('/api/shares', params={'q': '_'}).json()['total'] == 0
    assert auth_client.get('/api/shares', params={'conversation_id': other['id']}).json()['items'][0]['id'] == extra['id']
    assert auth_client.get('/api/shares', params={'q': 'link 22'}).json()['total'] == 1
    register(auth_client, 'share-b')
    assert auth_client.get('/api/shares').json()['total'] == 0
    assert auth_client.get('/api/shares', params={'conversation_id': first['id']}).json()['total'] == 0
    assert auth_client.patch(f"/api/shares/{extra['id']}", json={'title': 'Unauthorized'}).status_code == 404
    batch = auth_client.post('/api/shares/revoke-batch', json={'share_ids': [extra['id'], str(uuid4())]}).json()
    assert [item['status'] for item in batch['results']] == ['not_found', 'not_found']
    auth_client.cookies.clear()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.get('/api/shares').json()['total'] == 0
    auth_client.cookies.clear()
    assert auth_client.get('/api/shares').status_code == 401
    assert auth_client.get(f"/api/shared/{extra['token']}").status_code == 200


def test_disabled_creation_still_allows_owned_list_and_idempotent_batch(auth_client: TestClient) -> None:
    register(auth_client, 'share-owner')
    source = conversation(auth_client, 'Source')
    first, second = share(auth_client, source['id']), share(auth_client, source['id'])
    auth_client.cookies.clear()
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put('/api/admin/features', json={'allow_share_links': False}).status_code == 200
    auth_client.cookies.clear()
    assert auth_client.post('/api/auth/login', json={'email': 'share-owner@example.test', 'password': 'synthetic share test passphrase'}).status_code == 200
    assert auth_client.get('/api/shares').json()['total'] == 2
    assert auth_client.post(f"/api/conversations/{source['id']}/shares", json={}).status_code == 403
    unknown = str(uuid4())
    for _ in range(2):
        response = auth_client.post('/api/shares/revoke-batch', json={'share_ids': [first['id'], unknown, second['id'], first['id']]})
        assert response.status_code == 200
        assert [item['status'] for item in response.json()['results']] == ['revoked', 'not_found', 'revoked']
    with auth_middleware.SessionLocal() as db:
        assert db.query(Share).filter(Share.revoked_at.is_not(None)).count() == 2
        assert db.query(ConversationEvent).filter(ConversationEvent.event_type == 'share_revoked').count() == 2
    auth_client.cookies.clear()
    # Existing policy hides all public reads; revocation must survive re-enabling it.
    assert auth_client.get(f"/api/shared/{first['token']}").status_code == 404
    assert owner_login(auth_client).status_code == 200
    assert auth_client.put('/api/admin/features', json={'allow_share_links': True}).status_code == 200
    auth_client.cookies.clear()
    assert auth_client.get(f"/api/shared/{first['token']}").status_code == 410
    assert auth_client.get(f"/api/shared/{second['token']}").status_code == 410


def test_batch_database_failure_retains_other_results_and_retry(auth_client: TestClient, monkeypatch) -> None:
    from app.api.routes import shares as routes
    register(auth_client, 'share-retry')
    source = conversation(auth_client, 'Retry source')
    first, second = share(auth_client, source['id']), share(auth_client, source['id'])
    real_revoke = routes.revoke_share

    def fail_one(db, share_id, scope):
        result = real_revoke(db, share_id, scope)
        if str(share_id) == second['id']:
            raise OperationalError('synthetic failure', {}, Exception())
        return result

    monkeypatch.setattr(routes, 'revoke_share', fail_one)
    response = auth_client.post('/api/shares/revoke-batch', json={'share_ids': [first['id'], second['id']]}).json()
    assert [item['status'] for item in response['results']] == ['revoked', 'failed']
    with auth_middleware.SessionLocal() as db:
        assert db.get(Share, UUID(first['id'])).revoked_at is not None
        assert db.get(Share, UUID(second['id'])).revoked_at is None
    monkeypatch.setattr(routes, 'revoke_share', real_revoke)
    assert auth_client.post('/api/shares/revoke-batch', json={'share_ids': [second['id']]}).json()['results'][0]['status'] == 'revoked'
    assert auth_client.post('/api/shares/revoke-batch', json={'share_ids': []}).status_code == 422
    assert auth_client.post('/api/shares/revoke-batch', json={'share_ids': [str(uuid4()) for _ in range(101)]}).status_code == 422


def test_share_edit_preserves_url_validates_scope_and_clears_nullable_fields(auth_client: TestClient) -> None:
    register(auth_client, 'share-edit')
    first, other = conversation(auth_client, 'Edit source'), conversation(auth_client, 'Other source')
    created = share(auth_client, first['id'])
    messages = auth_client.get(f"/api/conversations/{first['id']}/dialogue-index").json()['items']
    other_id = auth_client.get(f"/api/conversations/{other['id']}/dialogue-index").json()['items'][0]['message_id']
    path = f"/api/shares/{created['id']}"
    assert auth_client.patch(path, json={'scope': 'selected_messages', 'selected_message_ids': [other_id]}).status_code == 400
    assert auth_client.patch(path, json={'scope': 'selected_messages', 'selected_message_ids': []}).status_code == 400
    response = auth_client.patch(path, json={'scope': 'selected_messages', 'selected_message_ids': [messages[0]['message_id']], 'title': None, 'description': None, 'include_toc': False, 'allow_export': True})
    assert response.status_code == 200
    assert response.json()['title'] is None and response.json()['description'] is None
    assert response.json()['share_url'] == created['share_url']
    public = auth_client.get(f"/api/shared/{created['token']}").json()
    assert public['message_count'] == 1 and public['capabilities']['export'] and not public['capabilities']['toc']
    assert auth_client.get(f"/api/shared/{created['token']}/messages/{messages[1]['message_id']}/blocks").status_code == 404
    assert auth_client.patch(path, json={'scope': 'conversation'}).status_code == 200
    assert auth_client.get(f"/api/shared/{created['token']}").json()['message_count'] == 2
    assert auth_client.post(path + '/revoke').status_code == 200
    assert auth_client.patch(path, json={'title': 'Cannot revive'}).status_code == 410
