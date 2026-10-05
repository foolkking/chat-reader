import { execFileSync } from "node:child_process";
import path from "node:path";

// Only the disposable PostgreSQL browser fixture. Expiry moves the real DB
// deadline; production worker code still performs all physical reclamation.
export function exportFixture(artifactId: string, expire = false, legacy = false): { exists: boolean; state: string; viewers: number; downloads: number } {
  const script = `
import json, os, sys, uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
assert os.environ.get('APP_ENV') == 'test' and os.environ.get('E2E_SETTINGS_MAILBOX') == '1'
from app.core.database import SessionLocal
from app.models.export_artifact import ExportArtifact, ExportArtifactLease
with SessionLocal() as db:
 row = db.get(ExportArtifact, uuid.UUID(sys.argv[1]))
 assert row is not None and row.scope_type != 'archive_upload'
 if sys.argv[2] == 'legacy':
  row.retention_seconds = None
  row.release_on_close = False
  db.commit()
 if sys.argv[2] == 'expire':
  row.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
  db.commit()
 leases = db.query(ExportArtifactLease).filter(ExportArtifactLease.artifact_id == row.id).all()
 print(json.dumps({'exists':Path(row.storage_uri).is_file(), 'state':row.lifecycle_state,
 'viewers':sum(item.kind == 'viewer' for item in leases), 'downloads':sum(item.kind == 'download' for item in leases)}))
`;
  return JSON.parse(execFileSync("python", ["-c", script, artifactId, expire ? "expire" : legacy ? "legacy" : "read"], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" }));
}
