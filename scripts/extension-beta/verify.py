"""Run only inside the disposable API container. Emit counts, not data or credentials."""
import hashlib
import json
import os
import sys
import uuid
import zipfile
from app.core.database import SessionLocal
from app.models import _register_all_models
from app.models.attachment import Attachment, MessageVersionAttachment
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.source_message_ref import SourceMessageRef
from app.services.assets.asset_store import get_asset_store
from app.models.import_record import ImportRecord
from pathlib import Path

assert os.environ["APP_ENV"] == "test" and os.environ["PUBLIC_WEB_BASE_URL"] == os.environ["SYNTHETIC_ORIGIN"] in {"http://127.0.0.1:18383","http://127.0.0.1:18483"}
_register_all_models()
cid = uuid.UUID(sys.argv[1])
with SessionLocal() as db:
    c = db.get(Conversation, cid)
    assert c.display_title.startswith("Tide notebook · ") and c.message_count == 4
    rows = db.query(Message).filter_by(conversation_id=cid).order_by(Message.order_key).all()
    assert [m.role for m in rows] == ["user", "assistant", "assistant", "user"]
    files = db.query(Attachment).filter_by(conversation_id=cid).all()
    assert len(files) == 2
    for i,m in enumerate(rows):
        refs=db.query(SourceMessageRef).filter_by(message_id=m.id, source_profile="reader-chat-v1").all()
        assert len(refs)==1 and refs[0].source_message_id==f"fixture-{i}" and refs[0].raw_metadata["tree_nodes"]==[f"fixture-{i}"]
        links=db.query(MessageVersionAttachment).filter_by(message_version_id=m.current_version_id).all()
        assert len(links)==(1 if i<2 else 0)
        if links:
            asset=db.get(Attachment,links[0].attachment_id).asset_object
            assert hashlib.sha256(get_asset_store().resolve_key(asset.storage_key).read_bytes()).hexdigest()==asset.sha256==sys.argv[2+i]
    packages=0
    for imp in db.query(ImportRecord).filter_by(conversation_id=cid):
        for p in (Path(os.environ["IMPORT_STORAGE_DIR"])/str(imp.id)).glob("*.zip"):
            with zipfile.ZipFile(p) as z:
                assert all(b"synthetic-source-only" not in z.read(n) for n in z.namelist())
            packages+=1
    assert packages>=1
    print(json.dumps({"messages":4,"source_refs":4,"files":2,"verified_file_digests":2,"file_message_owners":2,
                      "secrets_absent_from_synthetic_packages":packages}))
