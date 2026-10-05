import json
import uuid

import pytest

from app.models.message import Message
from app.models.message_version import MessageVersion
from test_continuation_candidates import client, private_objects, database  # noqa: F401


def create(client, count=105, body='Synthetic message'):
    payload = {'metadata': {'title': 'Synthetic guidance', 'powered_by': 'ChatGPT Exporter'}, 'messages': [
        {'role': 'Prompt' if i % 2 == 0 else 'Response', 'say': body} for i in range(count)]}
    response = client.post('/api/imports/preview', files={'files': ('synthetic.json', json.dumps(payload).encode(), 'application/json')})
    assert response.status_code == 200, response.text
    committed = client.post('/api/imports/' + response.json()['import_id'] + '/commit')
    assert committed.status_code == 200, committed.text
    cid = committed.json()['conversation_ids'][0]
    return cid, f'/api/conversations/{cid}/continuation'


def save_index(client, path, cid, ranges, generation=0):
    value = {'conversation_id': cid, 'coverage': {'seq_start': min(start for start, _ in ranges),
             'seq_end': max(end for _, end in ranges)},
             'segments': [{'seq_start': start, 'seq_end': end} for start, end in ranges]}
    saved = client.put(path + '/files', data={'base_generation': generation}, files={'index': ('index.json', json.dumps(value))})
    assert saved.status_code == 200, saved.text
    return saved.json()


def test_hint_counts_only_outside_index_and_current_save_does_not_reset(client):
    cid, path = create(client)
    assert client.get(path + '/guidance').json()['suggest_maintenance'] is True
    save_index(client, path, cid, [(1, 100)])
    result = client.get(path + '/guidance').json()
    assert result['coverage'] == 'declared'
    assert result['unindexed_messages'] == 5
    assert result['unindexed_characters'] == len('Synthetic message') * 5
    assert result['suggest_maintenance'] is False
    response = client.put(path + '/files', data={'base_generation': 1}, files={'current': ('current.md', '# Notes')})
    assert response.status_code == 200
    assert client.get(path + '/guidance').json()['unindexed_messages'] == 5


def test_gaps_and_overlap_are_counted_as_union(client):
    cid, path = create(client, 120)
    save_index(client, path, cid, [(1, 10), (5, 12), (20, 25)])
    result = client.get(path + '/guidance').json()
    assert result['unindexed_messages'] == 102
    assert result['suggest_maintenance'] is True


def test_short_and_unicode_character_threshold(client):
    _, small = create(client, 2)
    assert client.get(small + '/guidance').json()['suggest_maintenance'] is False
    _, long = create(client, 2, '😀中' * 15_000)
    result = client.get(long + '/guidance').json()
    assert result['unindexed_messages'] == 2
    assert result['unindexed_characters'] == 60_000
    assert result['suggest_maintenance'] is True


@pytest.mark.parametrize('kind', ['custom', 'foreign', 'out_of_bounds'])
def test_unknown_ranges_do_not_make_up_a_count_or_block_saves(client, kind):
    cid, path = create(client)
    if kind == 'custom':
        response = client.put(path + '/files', data={'base_generation': 0}, files={'index': ('index.json', '{"note":"Custom index"}')})
        assert response.status_code == 200
    else:
        save_index(client, path, str(uuid.uuid4()) if kind == 'foreign' else cid, [(1, 106 if kind == 'out_of_bounds' else 100)])
    result = client.get(path + '/guidance').json()
    assert result['coverage'] == 'unknown'
    assert result['unindexed_messages'] is None
    assert result['suggest_maintenance'] is False


def test_deleting_indexed_history_does_not_reassign_sequence_ranges(client):
    cid, path = create(client, 120)
    save_index(client, path, cid, [(1, 100)])
    with database() as db:
        first = db.query(Message).filter_by(conversation_id=uuid.UUID(cid)).order_by(Message.order_key).first()
        first.is_deleted = True
        db.commit()
    result = client.get(path + '/guidance').json()
    assert result['coverage'] == 'unknown'
    assert result['unindexed_messages'] is None
    assert result['suggest_maintenance'] is False


def test_read_only_counts_do_not_rewrite_files_or_versions(client):
    cid, path = create(client)
    saved = save_index(client, path, cid, [(1, 100)])
    url = path + '/revisions/' + saved['revision_id'] + '/members/index'
    before = client.get(url).content
    with database() as db:
        versions = db.query(MessageVersion).count()
    for _ in range(3):
        assert client.get(path + '/guidance').status_code == 200
    assert client.get(url).content == before
    assert client.get(path).json()['generation'] == 1
    with database() as db:
        assert db.query(MessageVersion).count() == versions
