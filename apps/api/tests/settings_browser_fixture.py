"""Explicit, disposable browser fixture; never imported by app.main or images."""
import os
import socketserver
import threading
from email import policy
from email.parser import BytesParser

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

if os.environ.get("APP_ENV") != "test" or os.environ.get("E2E_SETTINGS_MAILBOX") != "1":
    raise RuntimeError("Settings browser fixture requires explicit test opt-in")

from app.main import app  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.database import SessionLocal, get_db  # noqa: E402
from app.services.auth import provision_owner, root_admin_user  # noqa: E402

mailbox: list[dict[str, str]] = []


class SMTPHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(15)
        self.wfile.write(b"220 localhost test SMTP\r\n")
        while line := self.rfile.readline(8192):
            command = line.upper().split(b" ")[0].strip()
            if command in (b"EHLO", b"HELO"):
                self.wfile.write(b"250 localhost\r\n")
            elif command == b"DATA":
                self.wfile.write(b"354 End with dot\r\n")
                data = bytearray()
                while part := self.rfile.readline(8192):
                    if part == b".\r\n":
                        break
                    data.extend(part[1:] if part.startswith(b"..") else part)
                    if len(data) > 1_048_576:
                        return
                message = BytesParser(policy=policy.default).parsebytes(bytes(data))
                mailbox.append({"to": str(message["To"]), "text": str(message.get_content())})
                del mailbox[:-100]
                self.wfile.write(b"250 accepted\r\n")
            elif command == b"QUIT":
                self.wfile.write(b"221 bye\r\n")
                return
            else:
                self.wfile.write(b"250 ok\r\n")


class SMTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


smtp = SMTPServer(("127.0.0.1", int(os.environ["SMTP_PORT"])), SMTPHandler)
threading.Thread(target=smtp.serve_forever, daemon=True).start()
with SessionLocal() as db:
    principal = provision_owner(db, os.environ["E2E_AUTH_PASSWORD"], get_settings())
    principal.user.normalized_email = os.environ["E2E_AUTH_EMAIL"]
    db.commit()


@app.get("/api/settings-test/mail")
def read_mail(request: Request, db: Session = Depends(get_db)):
    if root_admin_user(db, getattr(request.state, "auth", None)) is None:
        raise HTTPException(status_code=404)
    return list(mailbox)
