"""Synthetic baseline probe. Run only in a disposable, networkless test container."""
import hashlib, io, json, os, uuid, zipfile
from pathlib import Path
from unittest.mock import patch
assert os.environ.get("APP_ENV") == "test"
assert os.environ["ASSET_STORAGE_DIR"].startswith("/tmp/")
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.core.database import Base
from app.models.user import User
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.attachment import Attachment, AssetObject, MessageVersionAttachment
from app.services.exporting.system_archive import TABLE_MODELS  # register models
from app.services.exporting.context_package import create_context_package
from app.services.assets.asset_store import get_asset_store
engine=create_engine("sqlite+pysqlite:///:memory:")
Base.metadata.create_all(engine)
results={}
with Session(engine) as db:
 user=User(normalized_email="context-probe@example.test"); db.add(user); db.flush()
 conversation=Conversation(owner_user_id=user.id,title="Synthetic context probe",display_title="Synthetic context probe",source_type="test",source_profile="test",parser_version="test")
 db.add(conversation); db.flush()
 message=Message(conversation_id=conversation.id,role="assistant",order_key="a"); db.add(message); db.flush()
 version=MessageVersion(message_id=message.id,version_number=1,plain_text="Synthetic",display_text="Synthetic",edit_type="test",content_hash=hashlib.sha256(b"Synthetic").hexdigest())
 db.add(version); db.flush(); message.current_version_id=version.id
 store=get_asset_store(); original=b"synthetic attachment"
 staged=store.stage(io.BytesIO(original),max_bytes=1024,quarantine=False)
 key=store.object_key(); physical=store.promote(staged.path,key)
 asset=AssetObject(sha256=staged.sha256,byte_size=staged.byte_size,storage_key=key,status="available",scan_status="clean",detected_mime_type="text/plain")
 db.add(asset); db.flush()
 attachment=Attachment(conversation_id=conversation.id,asset_object_id=asset.id,original_filename="synthetic.txt",display_name="Synthetic",status="available",resolution_status="resolved")
 db.add(attachment); db.flush(); db.add(MessageVersionAttachment(message_version_id=version.id,attachment_id=attachment.id))
 job=BackgroundJob(owner_user_id=user.id,job_type="conversation_export",status="processing",phase="exporting",payload={},result={}); db.add(job); db.commit()
 cid=conversation.id; uid=user.id; jid=job.id; aid=asset.id
 def export(case,record=False,progress=None):
  return create_context_package(db,conversation_id=cid,job_id=jid if record else uuid.uuid4(),scope_kind="full_conversation",start_message_id=None,subject_key=str(uid),output_directory=Path("/tmp/probe")/case,record_artifact=record,progress_callback=progress)
 physical.write_bytes(b"corrupted attachment")
 assert physical.stat().st_size==len(original)
 artifact=export("same-size")
 with zipfile.ZipFile(artifact.storage_uri) as z:
  manifest=json.loads(z.read("manifest.json")); name=next(n for n in z.namelist() if n.startswith("assets/"))
  results["same_size_corruption_published"]={"checksum_matches":hashlib.sha256(z.read(name)).hexdigest()==manifest["files"][name]["sha256"],"completeness":manifest["asset_completeness"]}
 physical.write_bytes(original)
 original_write=zipfile.ZipFile.write
 def interrupted(archive,filename,arcname=None,*args,**kwargs):
  if arcname and arcname.startswith("assets/"): raise OSError("Synthetic asset-copy interruption")
  return original_write(archive,filename,arcname,*args,**kwargs)
 with patch.object(zipfile.ZipFile,"write",interrupted):
  try: export("write-failure")
  except OSError: pass
  else: raise AssertionError("Fault was not exercised")
 results["files_after_write_failure"]=len([p for p in (Path("/tmp/probe")/"write-failure").rglob("*") if p.is_file()])
 artifact=export("rollback",record=True)
 db.rollback()
 results["rollback"]={"artifact_rows":db.query(ExportArtifact).count(),"published_file_exists":Path(artifact.storage_uri).exists()}
 def revoke(phase,*_):
  if phase=="packaging_assets": db.get(AssetObject,aid).status="deleted"; db.flush()
 artifact=export("revoked-asset",progress=revoke)
 results["revoked_asset_published"]=Path(artifact.storage_uri).exists(); db.rollback()
 def disable(phase,*_):
  if phase=="packaging_assets": db.get(User,uid).status="DISABLED"; db.flush()
 artifact=export("disabled-account",progress=disable)
 results["disabled_account_published"]=Path(artifact.storage_uri).exists(); db.rollback()
print(json.dumps({"source":"25c7f6a", "synthetic_only":True, "database":"SQLite in memory", "results":results},sort_keys=True))
