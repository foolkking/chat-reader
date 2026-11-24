"""Membership, prompts and opaque read-only receipts are checked against real jobs/ZIPs."""
import io
import json
from types import SimpleNamespace
import uuid
import zipfile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.routes.archive_exports import router
from app.core.config import get_settings
from app.core.database import get_db
from app.models.background_job import BackgroundJob
from app.models.project import Project
from app.models.project_conversation import ProjectConversation
from test_conversation_batch_export import state, run


@pytest.fixture
def lab(state):
    factory, _, users, sources = state
    current = [users[0]]
    with factory() as db:
        p = Project(owner_user_id=users[0], name="Synthetic scope")
        db.add(p); db.flush()
        db.add_all([ProjectConversation(project_id=p.id, conversation_id=cid, sort_order=i)
                    for i, cid in enumerate(sources[:2])])
        db.commit(); pid = str(p.id)
    app = FastAPI()
    app.include_router(router)
    @app.middleware("http")
    async def identify(request, call_next):
        request.state.auth = SimpleNamespace(user_id=current[0], principal_id="test")
        return await call_next(request)
    def database():
        with factory() as db:
            yield db
    app.dependency_overrides[get_db] = database
    with TestClient(app) as c:
        yield c, factory, users, current, pid, list(map(str, sources))


def test_selected_scope_refuses_silent_subset_and_read_back_is_private(lab):
    c, factory, users, current, pid, ids = lab
    route = "/api/conversations/batch-export"
    key = str(uuid.uuid4())
    headers = {"Idempotency-Key": "batch-export-"+key}
    body = {"conversation_ids":ids[1::-1], "project_scope":{"project_id":pid,"mode":"selected"}}
    with factory() as db:
        db.query(ProjectConversation).filter_by(conversation_id=uuid.UUID(ids[0])).delete()
        db.commit()
    conflict = c.post(route,json=body,headers=headers)
    assert conflict.status_code == 409
    proof = conflict.json()["detail"]["review"]
    assert proof["active_ids"] == [ids[1]]
    assert proof["changes"]["removed"]["count"] == 1
    assert c.get(route+"/requests/"+key).json() == {"found":False,"task":None}
    # Explicit original includes the still-owned item now outside this project.
    body["project_scope"]["reviewed"] = proof["reviewed"]
    ack = c.post(route, json=body,headers=headers)
    assert ack.status_code == 202
    identity = ack.json()["job_id"]
    assert c.get(route+"/requests/"+key).json()["task"]["job_id"] == identity
    assert c.post(route,json=body,headers=headers).json()["job_id"] == identity
    assert c.post(route,json={"conversation_ids":[ids[1]],"project_scope":body["project_scope"]},headers=headers).status_code == 409
    run(factory, uuid.UUID(identity))
    with factory() as db:
        result = db.get(BackgroundJob, uuid.UUID(identity)).result
    data = c.get(result["download_url"])
    assert "Synthetic%20scope" in data.headers["content-disposition"] or "Synthetic scope" in data.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(data.content)) as z:
        assert [json.loads(z.read(n).splitlines()[0])["conversation"]["id"] for n in z.namelist()] == ids[1::-1]
    current[0] = users[1]
    assert c.get(route+"/requests/"+key).json() == {"found":False,"task":None}
    assert c.get(f"/api/projects/{pid}/export-preview").status_code == 404
    assert c.post(route,json=body,headers=headers).status_code == 404


def test_whole_rechecks_identities_not_count_and_never_expands_the_queued_job(lab,monkeypatch):
    c, factory, _, _, pid, ids = lab
    url = f"/api/projects/{pid}/export-preview?sort=custom&direction=asc"
    def linked(cid, present):
        with factory() as db:
            if present:
                db.add(ProjectConversation(project_id=uuid.UUID(pid),conversation_id=uuid.UUID(cid)))
            else:
                db.query(ProjectConversation).filter_by(conversation_id=uuid.UUID(cid)).delete()
            db.commit()
    full = c.get(url).json()
    assert full["active_ids"] == ids[:2]
    monkeypatch.setattr(get_settings(),"bundle_max_entries",1)
    too_large = c.get(url).json()
    assert too_large["count"] == 2 and too_large["active_ids"] == [] and too_large["limit"] == 1
    linked(ids[0],False)
    r = c.get(url).json()
    assert r["active_ids"] == [ids[1]]
    linked(ids[1],False);linked(ids[0],True)
    def submit(p):
        return c.post("/api/conversations/batch-export",headers={"Idempotency-Key":"whole"},
            json={"conversation_ids":p["active_ids"],"project_scope":{"project_id":pid,"mode":"whole","reviewed":p["reviewed"]}})
    conflict=submit(r)
    assert conflict.status_code==409
    new=conflict.json()["detail"]["review"]
    assert new["count"]==r["count"] and new["active_ids"]==[ids[0]] and new["reviewed"]!=r["reviewed"]
    assert new["changes"]["added"]["count"] == new["changes"]["removed"]["count"] == 1
    assert new["changes"]["added"]["titles"] and new["changes"]["removed"]["titles"]
    ack=submit(new)
    assert ack.status_code==202
    linked(ids[0],False);linked(ids[1],True)
    assert submit(new).json()["job_id"] == ack.json()["job_id"]
    identity=uuid.UUID(ack.json()["job_id"]);run(factory,identity)
    with factory() as db:
        assert db.get(BackgroundJob,identity).payload["conversation_ids"] == [ids[0]]
        assert db.get(BackgroundJob,identity).status=="committed"
    linked(ids[1],False)
    assert c.get(url).json()["count"] == 0


@pytest.mark.parametrize("name", ["语"*80, "📚"*120])
def test_multibyte_project_name_publishes_reopenable_zip(lab,name):
    c,factory,_,_,pid,ids=lab
    with factory() as db:
        db.get(Project,uuid.UUID(pid)).name=name
        db.commit()
    body={"conversation_ids":ids[:1], "project_scope":{"project_id":pid,"mode":"selected"}}
    ack=c.post("/api/conversations/batch-export",json=body,headers={"Idempotency-Key":str(uuid.uuid4())})
    assert ack.status_code==202
    jid=uuid.UUID(ack.json()["job_id"]); run(factory,jid)
    with factory() as db:
        job=db.get(BackgroundJob,jid)
        assert job.status=="committed"
        response=c.get(job.result["download_url"])
    assert response.status_code==200
    with zipfile.ZipFile(io.BytesIO(response.content)) as z:
        assert z.testzip() is None and len(z.namelist())==1


def test_archived_project_subset_is_one_explicit_decision_and_remains_owned(lab):
    c,dbs,_,_,pid,ids=lab
    with dbs() as db:
        db.get(Project,uuid.UUID(pid)).is_archived=True
        db.query(ProjectConversation).filter_by(conversation_id=uuid.UUID(ids[0])).delete()
        db.commit()
    route="/api/conversations/batch-export"
    scope={"project_id":pid,"mode":"selected"}
    h={"Idempotency-Key":str(uuid.uuid4())}
    def post(members,proof=None):
        return c.post(route,json={"conversation_ids":members,"project_scope":{**scope,**({"reviewed":proof} if proof else {})}},headers=h)
    conflict=post(ids[:2])
    assert conflict.status_code==409
    r=conflict.json()["detail"]["review"]
    assert r["archived"] and r["active_ids"]==[ids[1]]
    assert post(ids[:2],r["remaining_reviewed"]).status_code==409
    admitted=post(r["active_ids"],r["remaining_reviewed"])
    assert admitted.status_code==202 and admitted.json()["total_items"]==1


def test_unavailable_selected_item_can_only_be_explicitly_omitted_without_disclosing_it(lab):
    from datetime import datetime, timezone
    from app.models.conversation import Conversation
    c, factory, _, _, pid, ids = lab
    with factory() as db:
        db.get(Conversation, uuid.UUID(ids[0])).deleted_at = datetime.now(timezone.utc)
        db.commit()
    route = "/api/conversations/batch-export"
    headers = {"Idempotency-Key": str(uuid.uuid4())}
    def post(items, stamp=None):
        scope = {"project_id": pid, "mode": "selected"}
        if stamp:
            scope["reviewed"] = stamp
        return c.post(route, headers=headers, json={"conversation_ids": items, "project_scope": scope})
    # A deleted row, a foreign row and an unknown ID must have the same public behavior.
    for gone in (ids[0], ids[2], str(uuid.uuid4())):
        response = post([gone, ids[1]])
        assert response.status_code == 409
        review = response.json()["detail"]["review"]
        assert review["can_export_original"] is False and review["active_ids"] == [ids[1]]
        assert review["changes"]["removed"] == {"count": 1, "titles": []}
        assert gone not in response.text
        assert post([gone, ids[1]], review["reviewed"]).status_code == 409
    with factory() as db:
        assert db.query(BackgroundJob).count() == 0
    submitted = post([ids[1]], review["remaining_reviewed"])
    assert submitted.status_code == 202
    jid = uuid.UUID(submitted.json()["job_id"])
    run(factory, jid)
    with factory() as db:
        result = db.get(BackgroundJob, jid).result
    with zipfile.ZipFile(io.BytesIO(c.get(result["download_url"]).content)) as z:
        assert [json.loads(z.read(f).splitlines()[0])["conversation"]["id"] for f in z.namelist()] == [ids[1]]
