"""Destructive only inside the marked, throwaway update rehearsal. Never on a host.

Run AFTER positive UI tests. The last scenario deliberately leaves the fixture
fenced and preserves its new backup, journal, old pointer and database.
"""
import base64
import hashlib
import http.cookiejar
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import subprocess
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("fixture", Path(__file__).with_name("update-lab.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
P = m.LAB


def state():
    return json.loads((m.ROOT / "state.json").read_bytes())


def check(ok, why):
    if not ok:
        raise RuntimeError(why)


def run(*args, **kw):
    return m.run(*args, **kw)


def browser():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(agent, path, data=None):
    req = urllib.request.Request(
        m.ORIGIN + path,
        data=None if data is None else json.dumps(data).encode(),
        headers={"Origin": m.ORIGIN, "Content-Type": "application/json"},
    )
    try:
        with agent.open(req, timeout=40) as resp:
            return (
                resp.status,
                json.loads(resp.read()) if resp.headers.get_content_type() == "application/json" else {},
            )
    except urllib.error.HTTPError as exc:
        return exc.code, {}


def login(agent, credential):
    check(request(agent, "/api/auth/login", credential)[0] == 200, "fixture login refused")


def post(op, data=None, code=200):
    resp, out = request(root, "/api/admin/updates/" + op, {} if data is None else data)
    check(resp == code, op + " unexpected HTTP " + str(resp))
    return out


def job(op, duplicate=False):
    resp, s = request(root, "/api/admin/updates")
    check(resp == 200, "root state")
    n = secrets.token_hex(16)
    post("ticket", {"id": n})
    intent = dict(id=n, expected=s["revision"], target=s["target_id"])
    post(op, intent, 202)
    if duplicate:
        post(op, intent, 202)
    return n


def wait_job(n, phases, reason=None):
    until = time.monotonic() + 260
    while time.monotonic() < until:
        s = state()["Job"]
        if s and s["id"] == n:
            if s["phase"] in phases:
                if reason:
                    check(s.get("reason") == reason, "unexpected refusal category")
                return s
            if s["phase"] in {"prepared", "succeeded", "refused", "restored", "recovery_required"}:
                raise RuntimeError("unexpected outcome " + s["phase"] + " " + s.get("reason", ""))
        time.sleep(0.10)
    raise RuntimeError("phase timeout")


def restart_control():
    expected = [os.fsencode(m.LIB / "updater"), b"control", b""]
    ids = []
    for p in Path("/proc").glob("[0-9]*"):
        try:
            argv = (p / "cmdline").read_bytes().split(b"\0")
        except FileNotFoundError:
            continue
        if argv == expected:
            ids.append(int(p.name))
    check(len(ids) == 1, "unique local fixture coordinator required")
    os.kill(ids[0], signal.SIGKILL)
    subprocess.Popen(
        [str(m.LIB / "updater"), "control"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def sign(file):
    return base64.b64encode(
        run("openssl", "pkeyutl", "-sign", "-rawin", "-inkey", P / "sign.key", "-in", file)
    )


def switch_feed(folder, save):
    check(folder.parent == save.parent == P and not save.exists(), "only new fixture feeds")
    (P / "feed").rename(save)
    folder.rename(P / "feed")


def intact(baseline):
    check(not (m.PUBLIC / "maintenance").exists() and m.snapshot() == baseline, "incumbent/config changed")
    check(request(root, "/api/health")[0] == 200, "old health")


def main():
    global root
    check(
        Path("/.dockerenv").exists() and (P / "dedicated-engine").read_text() == "disposable-nested-engine",
        "disposable host required",
    )
    check(m.REPO == "fixture/chat-reader" and m.ORIGIN == "https://localhost:32481", "fixture identities")
    check(
        state()["Current"]["version"] == "v1.0.0" and state()["Job"]["phase"] == "succeeded",
        "positive rehearsal first",
    )
    baseline = m.snapshot()
    root = browser()
    root_creds = json.loads((P / "browser-login.json").read_bytes())
    login(root, root_creds)
    # Real non-root account, not a mocked guard. Never print the fixture password or cookies.
    ordinary = {"email": "update-reader@example.test", "password": secrets.token_hex(26)}
    seed = "from app.services.auth import register_user\nfrom app.core.database import SessionLocal\nimport sys,json\np=json.load(sys.stdin)\nwith SessionLocal() as db:\n register_user(db,p['email'],p['password']);db.commit()"
    run(
        "docker",
        "exec",
        "-i",
        "updatefixture-api-1",
        "python",
        "-c",
        seed,
        stdin=json.dumps(ordinary).encode(),
    )
    reader = browser()
    login(reader, ordinary)
    check(
        request(reader, "/api/admin/updates")[0] == 404
        and request(reader, "/api/admin/updates/check", {})[0] == 404,
        "non-root read/check",
    )
    check(request(reader, "/api/admin/updates/ticket", {"id": "a" * 32})[0] == 404, "non-root mutation")
    # Age only this lab's sessions (never print token digests).
    run(
        "docker",
        "exec",
        "updatefixture-postgres-1",
        "sh",
        "-ec",
        'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "update auth_sessions set created_at=now()-interval \'15 minutes\'"',
    )
    post("ticket", {"id": "b" * 32}, 403)
    login(root, root_creds)
    print("PASS: real non-root and expired root confirmation", flush=True)

    raw = P / "feed/update-v1.json"
    sig = P / "feed/update-v1.json.sig"
    good = raw.read_bytes()
    good_sig = sig.read_bytes()
    try:
        foreign = json.loads(good)
        foreign["repository"] = "fixture/another"
        raw.write_text(json.dumps(foreign))
        sig.write_bytes(sign(raw))
        post("check", code=409)
        intact(baseline)
    finally:
        raw.write_bytes(good)
        sig.write_bytes(good_sig)
    post("check")
    print("PASS: correctly signed foreign fork refused", flush=True)
    archive = P / "feed/chat-reader-images.tar.gz"
    with archive.open("r+b", buffering=0) as f:
        offset = 128
        f.seek(offset)
        original = f.read(1)
        try:
            f.seek(offset)
            f.write(bytes([original[0] ^ 1]))
            os.fsync(f.fileno())
            n = job("prepare", duplicate=True)
            wait_job(n, {"refused"}, "download_verification")
            intact(baseline)
        finally:
            f.seek(offset)
            f.write(original)
            os.fsync(f.fileno())
    check(m.sha(archive) == json.loads(good)["archive_sha256"], "restored fixture archive")
    print("PASS: damaged download and duplicate submit; no outage", flush=True)

    # Small temporary filesystem, not a fill-the-disk test. Existing job dirs
    # are hidden, NOT removed. Copy this refusal receipt back after unmount.
    jobs = m.ROOT / "jobs"
    held = P / "bounded-job-store"
    held.mkdir()
    run("mount", "-t", "tmpfs", "-o", "size=16m,nodev,nosuid,noexec", "tmpfs", held)
    try:
        run("mount", "--bind", held, jobs)
        try:
            n = job("prepare")
            wait_job(n, {"refused"}, "insufficient_space")
            intact(baseline)
        finally:
            run("umount", jobs)
        shutil.copytree(held / n, jobs / n)
    finally:
        run("umount", held)
    print("PASS: bounded disk before maintenance; existing backups retained", flush=True)
    n = job("prepare")
    wait_job(n, {"downloading", "staging"})
    restart_control()
    wait_job(n, {"refused"}, "interrupted_before_maintenance")
    intact(baseline)
    print("PASS: actual coordinator restart during preparation", flush=True)

    a = state()["Current"]["revision"]
    bad = hashlib.sha1(("bad-start" + a).encode()).hexdigest()
    m.fixture_version(a, bad, "v1.2.0", P / "bad-start", failed_start=True)
    switch_feed(P / "bad-start", P / "previous-good-feed")
    post("check")
    wait_job(job("prepare"), {"prepared"})
    wait_job(job("apply"), {"restored"}, "old_version_verified")
    intact(baseline)
    check(state()["Current"]["revision"] == a, "old pointer after startup error")
    print("PASS: signed broken startup safely restored old app; no database rollback", flush=True)

    broken = hashlib.sha1(("bad-migration" + a).encode()).hexdigest()
    m.fixture_version(a, broken, "v1.3.0", P / "bad-migration", failure_schema="20990101_9999")
    switch_feed(P / "bad-migration", P / "previous-bad-start-feed")
    post("check")
    wait_job(job("prepare"), {"prepared"})
    n = job("apply")
    wait_job(n, {"recovery_required"}, "preserve_and_recover")
    receipt = m.ROOT / "jobs" / n / "backup/receipt"
    check(
        receipt.is_file()
        and (m.PUBLIC / "maintenance").read_text() == n
        and (m.ROOT / "jobs" / n / "schema-attempted").is_file(),
        "quarantine evidence",
    )
    restart_control()
    time.sleep(1)
    check(
        state()["Job"]["phase"] == "recovery_required"
        and request(root, "/login")[0] == 503
        and request(root, "/__updates/status")[1]["phase"] == "recovery_required"
        and state()["Current"]["revision"] == a,
        "crash replay or unexpected release",
    )
    check(m.snapshot() == baseline, "config/postgres altered")
    print(
        "PASS: signed failed migration stayed quarantined across daemon restart; five-component backup and original pointer retained",
        flush=True,
    )


if __name__ == "__main__":
    main()
