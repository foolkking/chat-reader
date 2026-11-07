import { execFileSync } from "node:child_process";
import path from "node:path";

/** CI-only legacy fixture: remove ingestion geometry, never erase a saved size. */
export function legacyImageMetadata(conversationId: string, attachmentId: string, operation: "prepare" | "read") {
  return JSON.parse(execFileSync("python", ["-B", "-c", `
import json,os,sys,uuid
from sqlalchemy.engine import make_url
assert os.environ.get('CI')=='true' and os.environ.get('APP_ENV')=='test'
assert os.environ.get('E2E_READING_STABILITY')=='1'
url=make_url(os.environ['DATABASE_URL'])
assert url.host=='127.0.0.1' and url.database=='chat_reader'
from app.core.database import SessionLocal
from app.models.attachment import Attachment
from app.models.conversation import Conversation
with SessionLocal() as db:
 conversation=db.get(Conversation,uuid.UUID(sys.argv[1]))
 row=db.get(Attachment,uuid.UUID(sys.argv[2]))
 assert conversation.title=='Synthetic image flow'
 assert row.conversation_id==conversation.id and row.display_name=='synthetic-flow-5.png'
 metadata=dict(row.metadata_ or {})
 if sys.argv[3]=='prepare':
  assert 'image_display_v1' not in metadata, 'The old image must never have been configured'
  metadata.pop('image_geometry_v1',None)
  row.metadata_=metadata
  db.commit()
 elif sys.argv[3]!='read': raise AssertionError('Unknown fixture operation')
 print(json.dumps({key:metadata[key] for key in ('image_display_v1','image_geometry_v1') if key in metadata}))
`, conversationId, attachmentId, operation], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" })) as Record<string, unknown>;
}
