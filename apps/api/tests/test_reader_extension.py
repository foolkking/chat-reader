"""Synthetic only. Drives the real auth middleware, import/analyze/commit and context worker."""
import hashlib
import io
import json
import secrets
import uuid
import zipfile
from pathlib import Path

import pytest
from app.core import auth_middleware
from app.core.config import get_settings
from app.models.conversation import Conversation
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.message import Message
from app.models.source_message_ref import SourceMessageRef
from app.services.extension_access import pkce
from app.services.adaptive_import.reader_package import messages, package_header, verify_assets
from app.services.adaptive_import.contracts import AdaptiveImportError
from test_auth import auth_client, owner_login  # noqa: F401

CLIENT = "a"*32
EXT = "/api/extension/v1"


def package(rows, *, partial=False, corrupt=False, file=b"example,2\n"):
    title = "Synthetic reader"
    md = bytearray(f"# {title}\n\n".encode())
    path = "assets/report.csv"
    m = {"version":"reader-chat-v1","source_id":"synthetic-conversation","title":title,"lineage":"tree",
         "messages":[],"assets":[{"path":path,"kind":"file","root":hashlib.sha256(bytes(32)+file).hexdigest()}],
         "partial":partial}
    index = []
    for i, (role, body) in enumerate(rows):
        md.extend(f"## {role.capitalize()}\n\n".encode())
        raw = body.encode()
        index.append({"id":f"synthetic-{i}", "parent":None if not i else f"synthetic-{i-1}",
                      "source_path":[f"node-{i}"], "role":role, "bytes":len(raw), "offset":len(md), "sha256":hashlib.sha256(raw).hexdigest(),
                      "assets":[path] if path in body else [], "at":None})
        md.extend(raw+b"\n\n")
    if corrupt:
        index[-1]["offset"] += 1
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        for name,data in [("manifest.json",json.dumps(m)),("conversation.md",md),("reader/source.jsonl",
                "".join(json.dumps(r)+"\n" for r in index)),(path,file)]:
            z.writestr(name,data)
    return b.getvalue()


ROWS=[("user","A synthetic example"),("assistant","```md\n## User\n```\n\n[report](assets/report.csv)"),
      ("assistant","公式 $x^2$")]


def test_pinned_exporter_golden_fixture_is_read_without_heading_inference():
    fixture=Path(__file__).parent/"fixtures"/"reader_extension_profile_v1.zip"
    with zipfile.ZipFile(fixture) as z:
        m=package_header(z);verify_assets(z,m);data=list(messages(z,m))
        assert m["source_id"]=="synthetic-golden"
        assert [r["id"] for r,_,_ in data]==["sample-0","sample-2","sample-3"]
        assert [r["role"] for r,_,_ in data]==["user","assistant","assistant"]
        assert data[1][0]["source_path"]==["node-1","node-2"]
        assert "## User" in data[1][1] and z.read(data[1][0]["assets"][0])==b"tide,2\n"


def test_index_preserves_adjacent_roles_and_checks_bytes():
    with zipfile.ZipFile(io.BytesIO(package(ROWS))) as z:
        h=package_header(z)
        verify_assets(z,h)
        assert [r["id"] for r,_,_ in messages(z,h)] == ["synthetic-0","synthetic-1","synthetic-2"]
    with zipfile.ZipFile(io.BytesIO(package(ROWS,corrupt=True))) as z, pytest.raises(AdaptiveImportError):
        list(messages(z,package_header(z)))


@pytest.fixture
def paired(auth_client, monkeypatch, tmp_path):
    monkeypatch.setenv("READER_EXTENSION_IDS",CLIENT)
    for kind in ("IMPORT","ASSET","EXPORT"):
        monkeypatch.setenv(kind+"_STORAGE_DIR", str(tmp_path/kind))
    monkeypatch.setenv("IMPORT_COMMIT_INLINE","false")
    monkeypatch.setattr("app.services.uploads.available_memory_bytes",lambda: 16*1024**3)
    get_settings.cache_clear()
    assert owner_login(auth_client).status_code == 200
    verifier=secrets.token_urlsafe(32)
    owner=auth_client.get("/api/auth/session").json()["user_id"]
    consent=auth_client.post("/api/extension-devices/authorize",json={"client":CLIENT,"challenge":pkce(verifier),"state":secrets.token_urlsafe(32),"expected_user_id":owner})
    assert consent.status_code == 200
    from urllib.parse import urlsplit, parse_qs
    code=parse_qs(urlsplit(consent.json()["redirect"]).query)["code"][0]
    origin={"Origin":"chrome-extension://"+CLIENT}
    data={"client":CLIENT,"verifier":verifier,"code":code}
    assert auth_client.post(EXT+"/token",json={**data,"verifier":"z"*43},headers=origin).status_code==401
    auth = auth_client.post(EXT+"/token",json=data,headers=origin)
    assert auth.status_code == 200
    assert auth_client.post(EXT+"/token",json=data,headers=origin).status_code==401
    return auth_client, {**origin,"Authorization":"Bearer "+auth.json()["access_token"]}, auth.json()


def test_scope_rotation_and_revocation(paired):
    c,h,grant=paired
    assert c.get(EXT+"/capabilities",headers=h).json()["account_discovery"] is False
    assert c.get(EXT+"/projects",headers=h).status_code == 200
    assert c.get(EXT+"/files",headers=h).status_code == 200
    assert c.get(EXT+"/conversations",headers=h).status_code == 200
    assert c.get(EXT+"/projects").status_code in (401,403)
    assert c.get(EXT+"/projects",headers={**h,"Origin":"https://example.invalid"}).status_code == 403
    assert c.delete("/api/extension-devices/"+grant["device_id"]).status_code == 204
    c.cookies.clear()
    assert c.get("/api/preferences",headers=h).status_code == 401
    assert c.get(EXT+"/projects",headers=h).status_code == 401
    assert c.post(EXT+"/token",json={"client":CLIENT,"refresh":grant["refresh_token"]},headers=h).status_code==401


def drive_analysis():
    from app.services.background_jobs import claim_next_job, process_background_job
    factory=auth_middleware.SessionLocal
    with factory() as db:
        jid=claim_next_job(db,job_type="adaptive_import_analysis")
        assert jid
        db.commit()
    process_background_job(jid,session_factory=factory)


def submit(c,h,rows,**opts):
    key=str(uuid.uuid4())
    r=c.post(EXT+"/imports",files={"files":("reader.zip",package(rows,**opts),"application/zip")},
             headers={**h,"Idempotency-Key":key})
    assert r.status_code==201,r.text
    iid=r.json()["id"]
    assert c.get(EXT+"/requests/"+key,headers=h).json()["id"]==iid
    drive_analysis()
    s=c.get(EXT+"/imports/"+iid,headers=h)
    assert s.status_code==200,s.text
    assert s.json()["review"],s.text
    return iid,s.json()["review"]


def commit(c,h,iid,review):
    from app.services.import_queue import process_import, claim_next_import
    p=EXT+"/imports/"+iid
    queued=c.post(p+"/commit",json={"receipt":review["receipt"]},headers=h)
    assert queued.status_code in (200,202),queued.text
    with auth_middleware.SessionLocal() as db:
        assert claim_next_import(db) == uuid.UUID(iid)
        db.commit()
    process_import(uuid.UUID(iid),session_factory=auth_middleware.SessionLocal)
    status=c.get(p,headers=h).json()
    assert status["status"]=="committed",status
    return status["conversation_id"]


def test_three_messages_duplicate_append_conflict_and_context(paired):
    c,h,_=paired
    c.cookies.clear()  # No Reader tab or browser cookie from here onward.
    iid,review=submit(c,h,ROWS)
    assert review["action"]=="new" and review["messages"]==3
    cid=commit(c,h,iid,review)
    iid,review=submit(c,h,ROWS)
    assert review["action"]=="unchanged"
    assert commit(c,h,iid,review)==cid
    iid,review=submit(c,h,[*ROWS,("user","Continue")])
    assert review["action"]=="append"
    assert commit(c,h,iid,review)==cid
    iid,review=submit(c,h,[("user","Different branch"),*ROWS[1:]])
    assert review["action"]=="conflict"
    assert c.post(EXT+"/imports/"+iid+"/commit",json={"receipt":review["receipt"]},headers=h).status_code==409
    with auth_middleware.SessionLocal() as db:
        assert db.query(Conversation).count()==1
        assert db.query(Message).count()==4
        assert db.query(SourceMessageRef).filter_by(source_profile="reader-chat-v1").count()==4
        assert db.query(Attachment).count()==db.query(MessageVersionAttachment).count()==1
    key=str(uuid.uuid4())
    e=c.post(f"{EXT}/conversations/{cid}/context",headers={**h,"Idempotency-Key":key})
    assert e.status_code==202,e.text
    from app.services.background_jobs import claim_next_job, process_background_job
    with auth_middleware.SessionLocal() as db:
        job=claim_next_job(db,job_type="conversation_export");db.commit()
    assert str(job)==e.json()["id"]
    process_background_job(job,session_factory=auth_middleware.SessionLocal)
    a=c.get(EXT+"/exports/"+str(job),headers=h).json()
    assert a["status"]=="committed",a
    p=EXT+"/artifacts/"+a["artifact_id"]
    claim=c.post(p+"/claim",json={"session_id":str(uuid.uuid4())},headers=h).json()["claim"]
    with zipfile.ZipFile(io.BytesIO(c.get(p+"/download",params={"claim":claim},headers=h).content)) as z:
        assert {"manifest.json","conversation.canjsonl","annotations.md"}<=set(z.namelist())


def test_refresh_rotates_and_instance_secret_rotation_invalidates_grants(paired, monkeypatch):
    c,h,grant=paired
    value={"client":CLIENT,"refresh":grant["refresh_token"]}
    result=c.post(EXT+"/token",json=value,headers=h)
    assert result.status_code==200
    assert c.post(EXT+"/token",json=value,headers=h).status_code==401
    assert c.get(EXT+"/projects",headers=h).status_code==401
    h={**h,"Authorization":"Bearer "+result.json()["access_token"]}
    assert c.get(EXT+"/projects",headers=h).status_code==200
    monkeypatch.setenv("AUTH_SESSION_SECRET",secrets.token_urlsafe(48))
    get_settings.cache_clear()
    assert c.get(EXT+"/projects",headers=h).status_code==401


def test_foreign_library_file_organize_and_context_are_not_capabilities(paired):
    c,h,grant=paired
    assert c.put("/api/admin/access/registration",json={"mode":"OPEN","require_admin_approval":False}).status_code==200
    c.cookies.clear()
    pw=secrets.token_urlsafe(24)
    other=c.post("/api/auth/register",json={"email":"separate@example.test","password":pw,"confirm_password":pw,"display_name":"Other"})
    assert other.status_code==201
    made=c.post("/api/conversations",json={"title":"Separate private tide","messages":[
        {"role":"user","content_markdown":"distinctive synthetic phrase"},{"role":"assistant","content_markdown":"test response"}]})
    assert made.status_code==201
    cid=made.json()["conversation"]["id"]
    project=c.post("/api/projects",json={"name":"Separate private project"})
    assert project.status_code==201
    pid=project.json()["id"]
    assert c.get(EXT+"/conversations?q=distinctive",headers=h).json()["items"]==[]
    assert all(p["id"]!=pid for p in c.get(EXT+"/projects",headers=h).json())
    assert c.get(f"{EXT}/conversations?project_id={pid}",headers=h).status_code==404
    assert c.patch(f"{EXT}/conversations/{cid}/pin",json={"is_pinned":True},headers=h).status_code==404
    assert c.put(f"{EXT}/conversations/{cid}/project",json={"project_id":pid},headers=h).status_code in (404,422)
    assert c.post(f"{EXT}/conversations/{cid}/context",headers={**h,"Idempotency-Key":str(uuid.uuid4())}).status_code==404
    assert c.delete("/api/extension-devices/"+grant["device_id"]).status_code==204
    assert c.get(EXT+"/projects",headers=h).status_code==200  # Other browser session could not revoke owner's device.
    other_task=c.post(f"/api/conversations/{cid}/quick-context",headers={"Idempotency-Key":str(uuid.uuid4())})
    assert other_task.status_code==202
    from app.services.background_jobs import claim_next_job,process_background_job
    with auth_middleware.SessionLocal() as db:
        jid=claim_next_job(db,job_type="conversation_export");db.commit()
    process_background_job(jid,session_factory=auth_middleware.SessionLocal)
    assert c.get(f"{EXT}/exports/{jid}",headers=h).status_code==404
    from app.models.background_job import BackgroundJob
    with auth_middleware.SessionLocal() as db:
        aid=db.get(BackgroundJob,jid).result["artifact_id"]
    assert c.post(f"{EXT}/artifacts/{aid}/claim",json={"session_id":str(uuid.uuid4())},headers=h).status_code==404
    assert c.get(f"{EXT}/artifacts/{aid}/download?claim={uuid.uuid4()}",headers=h).status_code==404
    # The second user's legitimate extension also cannot see/rename a real file belonging to the first.
    iid,info=submit(c,h,ROWS)
    first_cid=commit(c,h,iid,info)
    fid=c.get(EXT+"/files",headers=h).json()["items"][0]["id"]
    v=secrets.token_urlsafe(32)
    authz=c.post("/api/extension-devices/authorize",json={"client":CLIENT,"challenge":pkce(v),
        "state":secrets.token_urlsafe(32),"expected_user_id":other.json()["user_id"]})
    assert authz.status_code==200
    from urllib.parse import urlsplit, parse_qs
    code=parse_qs(urlsplit(authz.json()["redirect"]).query)["code"][0]
    other_token=c.post(EXT+"/token",json={"client":CLIENT,"code":code,"verifier":v},headers={"Origin":h["Origin"]})
    assert other_token.status_code==200
    other_headers={"Origin":h["Origin"],"Authorization":"Bearer "+other_token.json()["access_token"]}
    assert c.get(EXT+"/files",headers=other_headers).json()["items"]==[]
    assert c.patch(f"{EXT}/conversations/{first_cid}/files/{fid}",headers=other_headers,json={"display_name":"not mine"}).status_code==404
    c.cookies.clear()
    assert c.get("/api/admin/access/registration",headers=h).status_code==401


def test_capture_kill_switch_is_independent_of_catalog_and_default_preset(paired,monkeypatch):
    c,h,_=paired
    monkeypatch.setenv("READER_EXTENSION_CAPTURE","false");get_settings.cache_clear()
    assert c.get(EXT+"/capabilities",headers=h).json()["capture"] is False
    assert c.get(EXT+"/conversations",headers=h).status_code==200
    bad=c.put("/api/preferences/context-quick-preset",json={"preset_id":str(uuid.uuid4())})
    assert bad.status_code==409
    assert c.post(EXT+"/imports",files={"files":("reader.zip",package(ROWS),"application/zip")},
                  headers={**h,"Idempotency-Key":str(uuid.uuid4())}).status_code==403


def run_queued(iid):
    from app.services.import_queue import process_import,claim_next_import
    with auth_middleware.SessionLocal() as db:
        assert claim_next_import(db)==uuid.UUID(iid)
        db.commit()
    process_import(uuid.UUID(iid),session_factory=auth_middleware.SessionLocal)


def test_partial_and_live_share_require_current_consent_even_after_queue(paired):
    from app.models.share import Share
    c,h,_=paired
    iid,info=submit(c,h,ROWS,partial=True)
    def confirm(i,body):return c.post(f"{EXT}/imports/{i}/commit",json=body,headers=h).status_code
    assert info["partial"] and confirm(iid,{"receipt":info["receipt"]})==409
    assert confirm(iid,{"receipt":info["receipt"],"accept_partial":True})==202
    run_queued(iid)
    cid=c.get(f"{EXT}/imports/{iid}",headers=h).json()["conversation_id"]
    def add_share(mode):
        with auth_middleware.SessionLocal() as db:
            db.add(Share(conversation_id=uuid.UUID(cid),title="Test share",scope="conversation",content_mode=mode,
                         token_hash=secrets.token_hex(32),token_prefix="synthetic"));db.commit()
    add_share("snapshot")
    extended=[*ROWS,("user","An explicitly reviewed tail")]
    jid,r=submit(c,h,extended)
    assert not r["live_share"] and confirm(jid,{"receipt":r["receipt"]})==202
    add_share("live")  # the public audience changed AFTER review, BEFORE the worker ran
    run_queued(jid)
    with auth_middleware.SessionLocal() as db:assert db.query(Message).count()==3
    jid,r=submit(c,h,extended)
    assert r["live_share"] and confirm(jid,{"receipt":r["receipt"]})==409
    assert confirm(jid,{"receipt":r["receipt"],"accept_share":True})==202
    run_queued(jid)
    with auth_middleware.SessionLocal() as db:assert db.query(Message).count()==4


def test_concurrent_approval_is_noop_and_revoked_queued_append_cannot_write(paired):
    c,h,grant=paired
    first,r1=submit(c,h,ROWS);second,r2=submit(c,h,ROWS)
    assert r1["action"]==r2["action"]=="new"
    for iid,r in [(first,r1),(second,r2)]:
        assert c.post(f"{EXT}/imports/{iid}/commit",json={"receipt":r["receipt"]},headers=h).status_code==202
    run_queued(first);run_queued(second)
    first_result=c.get(f"{EXT}/imports/{first}",headers=h).json()
    assert first_result["conversation_id"] and first_result["conversation_id"]==c.get(f"{EXT}/imports/{second}",headers=h).json()["conversation_id"]
    iid,r=submit(c,h,[*ROWS,("user","Do not append after revocation")])
    assert c.post(f"{EXT}/imports/{iid}/commit",json={"receipt":r["receipt"]},headers=h).status_code==202
    assert c.delete("/api/extension-devices/"+grant["device_id"]).status_code==204
    run_queued(iid)
    with auth_middleware.SessionLocal() as db:assert db.query(Message).count()==3 and db.query(Conversation).count()==1


@pytest.mark.parametrize("mode",["asset-bytes","omitted-member","duplicate-node"])
def test_reject_damaged_resource_or_false_tree(mode):
    with zipfile.ZipFile(io.BytesIO(package(ROWS))) as original:
        parts={n:original.read(n) for n in original.namelist()}
    if mode=="asset-bytes":parts["assets/report.csv"]+=b"altered"
    if mode=="omitted-member":del parts["assets/report.csv"]
    if mode=="duplicate-node":parts["reader/source.jsonl"]=parts["reader/source.jsonl"].replace(b"node-2",b"node-0")
    out=io.BytesIO()
    with zipfile.ZipFile(out,"w") as z:
        for n,b in parts.items():z.writestr(n,b)
    with zipfile.ZipFile(out) as z,pytest.raises(AdaptiveImportError):
        header=package_header(z);verify_assets(z,header);list(messages(z,header))
