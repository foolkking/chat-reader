"""Runs from stdin in each exact image with NO host mounts or release credentials."""

import hashlib
import json
import os
from pathlib import Path
import sys


def runtime():
    # Match the API/worker interpreter, dependencies and source outside the
    # narrowly reviewed functions. Ignore non-executed timestamps; do not
    # ignore a different executable, source-free module, link target or mode.
    import stat

    h = hashlib.sha256()
    for top in ("/app", "/usr", "/lib", "/bin", "/sbin", "/opt"):
        for base, dirs, files in os.walk(top):
            dirs.sort()
            for n in sorted(files + [d for d in dirs if os.path.islink(os.path.join(base, d))]):
                p = Path(base) / n
                if p.name == "build_metadata.json" and p.parent.name == "app":
                    continue
                # The reviewed file itself is compared to the Git blobs below.
                if str(p).endswith("/app/services/search/search_service.py"):
                    continue
                if p.suffix == ".pyc" and p.parent.name == "__pycache__":
                    source = p.parent.parent / (p.name.split(".")[0] + ".py")
                    if source.is_file():
                        continue
                s = p.lstat()
                h.update(str(p).encode() + b"\0" + str(s.st_mode).encode() + b"\0")
                if p.is_symlink():
                    h.update(os.readlink(p).encode())
                elif stat.S_ISREG(s.st_mode):
                    with p.open("rb") as f:
                        for piece in iter(lambda: f.read(1 << 20), b""):
                            h.update(piece)
    from app.services.search import search_service

    print(
        json.dumps(
            [
                h.hexdigest(),
                hashlib.sha256(Path(search_service.__file__).read_bytes()).hexdigest(),
            ]
        )
    )


def exercise(op, label):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.core.database import SessionLocal
    from sqlalchemy import text

    client = TestClient(app)
    if op == "write":
        blob = json.dumps(
            {
                "metadata": {
                    "title": "Pair " + label,
                    "powered_by": "ChatGPT Exporter",
                },
                "messages": [
                    {"role": "Prompt", "say": "pair_token_" + label + " 潮汐"},
                    {"role": "Response", "say": "verified program fixture"},
                ],
            }
        ).encode()
        result = client.post(
            "/api/imports/preview",
            files={"files": (label + ".json", blob, "application/json")},
        )
        result.raise_for_status()
        committed = client.post("/api/imports/" + result.json()["import_id"] + "/commit")
        committed.raise_for_status()
        if committed.status_code == 202:
            from app.services.import_queue import claim_next_import, process_import

            with SessionLocal() as db:
                import_id = claim_next_import(db)
                assert str(import_id) == result.json()["import_id"]
                db.commit()
            process_import(import_id, SessionLocal)
            committed = client.get("/api/imports/" + str(import_id) + "/status")
            committed.raise_for_status()
        assert len(committed.json()["conversation_ids"]) == 1
        return
    with SessionLocal() as db:
        assert db.scalar(text("show transaction_read_only")) == "on"
        assert not db.scalar(
            text("select has_table_privilege(current_user,'conversations','INSERT,UPDATE,DELETE')")
        )
    import errno

    for name in ("imports", "exports", "offline", "assets"):
        try:
            with open("/data/" + name + "/must-not-write", "xb"):
                pass
        except OSError as e:
            assert e.errno == errno.EROFS
        else:
            raise AssertionError("writable business volume")
    for writer in ("old", "new"):
        q = "pair_token_" + writer
        r = client.get("/api/search", params={"q": q, "document_type": "message"})
        r.raise_for_status()
        items = r.json()["items"]
        assert len(items) == 1 and q in items[0]["snippet"]
        cid = items[0]["conversation_id"]
        r = client.get(
            "/api/search",
            params={"q": "潮汐", "conversation_id": cid, "reader_find": "true"},
        )
        r.raise_for_status()
        assert any(x["matches"] and x["matches"][0]["quote"] == "潮汐" for x in r.json()["items"])
    assert sum(1 for p in Path("/data/imports").rglob("*") if p.is_file()) >= 2


if sys.argv[1] == "runtime":
    runtime()
else:
    exercise(*sys.argv[1:3])
