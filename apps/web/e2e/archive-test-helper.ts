import { execFileSync } from "node:child_process";
import path from "node:path";

/** Seed only failure/expiry; all admission, retry and successful work remains real. */
export function seedArchiveFault(id: string, fault: "unavailable" | "retryable") {
  execFileSync("python", ["-B", "-c", `
import os,sys,uuid
from datetime import datetime,timedelta,timezone
assert os.environ.get('APP_ENV')=='test' and os.environ.get('E2E_SETTINGS_MAILBOX')=='1'
from app.core.database import SessionLocal
from app.models.background_job import BackgroundJob
from app.models.export_artifact import ExportArtifact
from app.models.user import User
with SessionLocal() as db:
 job=db.get(BackgroundJob,uuid.UUID(sys.argv[1]))
 assert job.job_type in ('personal_archive_preflight','system_archive_preflight')
 assert job.status in ('committed','failed')
 owner=db.get(User,job.owner_user_id)
 assert owner.normalized_email.endswith('@example.test')
 assert owner.normalized_email.startswith(('archive-state-','archive-replacement-')) or (owner.role=='ADMIN' and owner.normalized_email==os.environ['E2E_AUTH_EMAIL'])
 if sys.argv[2]=='unavailable':
  artifact=db.query(ExportArtifact).filter_by(job_id=job.id).one()
  artifact.expires_at=datetime.now(timezone.utc)-timedelta(minutes=1)
 elif sys.argv[2]=='retryable':
  job.status='failed'; job.phase='failed'; job.result={}
  job.error_message='Archive operation failed. Your current data was preserved; retry the task or upload the archive again.'
  job.completed_at=datetime.now(timezone.utc)
 else: raise AssertionError('Unknown fixture fault')
 db.commit()
`, id, fault], { cwd: path.resolve(process.cwd(), "../api"), encoding: "utf8" });
}
