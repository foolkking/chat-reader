"""Create isolated, synthetic-only compose inputs. Refuses an existing directory."""
import os
import re
import secrets
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("Usage: init_lab.py NEW_TASK_DIRECTORY EXISTING_LOCAL_API_IMAGE")
task = Path(sys.argv[1]).resolve()
image = sys.argv[2]
if not re.fullmatch(r"[\w./:@-]+", image):
    raise SystemExit("Invalid image identifier")
if os.name == "nt" and not any(task.is_relative_to(p) for p in (
        Path(r"E:\chat-reader-temp").resolve(), Path(r"C:\Users\86182\Desktop\wkkk").resolve())):
    raise SystemExit("Use the approved project scratch root")
task.mkdir(mode=0o700)
data = task / "disposable-postgres-beta"
data.mkdir()
vals = dict(BETA_API_IMAGE=image, BETA_EXTENSION_ID="gihbiofiiflkckcmomddkkjkoifkddfi",
            BETA_DATA=data.as_posix(), BETA_SESSION_SECRET=secrets.token_urlsafe(48),
            BETA_TEST_PASSWORD=secrets.token_urlsafe(32), BETA_PG_PASSWORD=secrets.token_urlsafe(32))
p = task / "rehearsal.env"
with p.open("x", encoding="utf-8") as f:
    f.writelines(f"{k}={v}\n" for k,v in vals.items())
p.chmod(0o600)
print("Created disposable lab settings. No credentials printed.")
