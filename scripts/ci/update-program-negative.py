"""Faults only in the explicitly marked disposable program acceptance host."""

import concurrent.futures
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import ssl
import threading
import time
import urllib.request


def module(alias, name):
    spec = importlib.util.spec_from_file_location(alias, Path(__file__).with_name(name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


p = module("program", "update-program-lab.py")
n = module("negative", "update-lab-negative.py")
m = p.lab


def submit(action, double=False):
    s = n.request(n.root, "/api/admin/updates")[1]
    token = secrets.token_hex(16)
    n.post("ticket", {"id": token})
    body = {
        "id": token,
        "expected": s["revision"],
        "target": s["previous_id"] if action == "rollback" else s["target_id"],
    }
    if action == "apply":
        body["preparation"] = s["preparation"]
    n.post(action, body, 202)
    if double:
        n.post(action, body, 202)
    return token


def prepare():
    n.post("check")
    n.wait_job(submit("prepare"), {"prepared"})
    assert n.request(n.root, "/api/admin/updates")[1]["plan"]["mode"] == "program"


def upload(release, entered):
    # Real slow multipart upload through canonical HTTPS. Send headers and all
    # but the last multipart boundary; release the same request during SIGTERM.
    boundary = "----cr-program-proof"
    payload = json.dumps(
        {
            "metadata": {"title": "Slow program upload", "powered_by": "ChatGPT Exporter"},
            "messages": [{"role": "Prompt", "say": "upload-kept"}, {"role": "Response", "say": "intact"}],
        }
    ).encode()
    start = (
        f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="pair.json"\r\n'
        "Content-Type: application/json\r\n\r\n"
    ).encode() + payload
    start += b" " * (256 << 10)  # Above the real multipart spool rollover threshold.
    end = f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(m.ORIGIN + "/api/imports/preview")
    for h in n.root.handlers:
        if hasattr(h, "cookiejar"):
            h.cookiejar.add_cookie_header(req)
    conn = http.client.HTTPSConnection("localhost", m.PORT, timeout=60, context=ssl.create_default_context())
    try:
        conn.putrequest("POST", "/api/imports/preview")
        for k, v in {
            "Origin": m.ORIGIN,
            "Content-Type": "multipart/form-data; boundary=" + boundary,
            "Content-Length": str(len(start) + len(end)),
            "Cookie": req.get_header("Cookie"),
        }.items():
            conn.putheader(k, v)
        conn.endheaders(start)
        entered.set()
        assert release.wait(35)
        conn.send(end)
        r = conn.getresponse()
        assert r.status == 200, r.status
        return json.loads(r.read())["import_id"], hashlib.sha256(payload + b" " * (256 << 10)).hexdigest()
    finally:
        conn.close()


def intact(baseline):
    assert n.state()["Current"]["version"] == "v1.0.0" and p.backups() == baseline
    assert not (m.PUBLIC / "maintenance").exists() and n.request(n.root, "/api/health")[0] == 200


def commit_upload(imp):
    status, reply = n.request(n.root, "/api/imports/" + imp + "/commit", {})
    assert status in (200, 202)
    for _ in range(200):
        if reply.get("conversation_ids"):
            return reply["conversation_ids"][0], None
        if reply.get("status") == "failed":
            # Never log user data, IDs or an arbitrary error string.
            return None, "UPLOAD_MEMORY_PRESSURE" if reply.get(
                "error_message"
            ) == "UPLOAD_MEMORY_PRESSURE" else "import_failed"
        time.sleep(0.3)
        status, reply = n.request(n.root, "/api/imports/" + imp + "/status")
        assert status == 200
    return None, "commit_not_finished"


def assert_bytes(imp, digest):
    code, artifacts = n.request(n.root, "/api/imports/" + imp + "/source-artifacts")
    assert code == 200 and any(a["sha256"] == digest and a["byte_size"] > 256 << 10 for a in artifacts)


def main():
    p.guard()
    n.root = n.browser()
    n.login(n.root, json.loads((m.LAB / "browser-login.json").read_bytes()))
    baseline = p.backups()
    no_delay = threading.Event()
    no_delay.set()
    control_id, control_sha = upload(no_delay, threading.Event())
    assert_bytes(control_id, control_sha)
    control_cid, control_error = commit_upload(control_id)
    print("Control (no update) exporter commit: " + (control_error or "succeeded"), flush=True)
    p.cert("api")
    prepare()
    release = threading.Event()
    entered = threading.Event()
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        f = pool.submit(upload, release, entered)
        try:
            assert entered.wait(5)
            time.sleep(0.8)
            job = submit("apply", True)
            n.wait_job(job, {"program-switch"})
            time.sleep(1.5)
            assert not f.done()
        finally:
            release.set()
        imp, digest = f.result()
    n.wait_job(job, {"succeeded"})
    assert_bytes(imp, digest)
    committed, error = commit_upload(imp)
    code, created = n.request(
        n.root,
        "/api/conversations",
        dict(
            title="Isolated concurrent write",
            messages=[
                {"role": "user", "content_markdown": "kept"},
                {"role": "assistant", "content_markdown": "verified"},
            ],
        ),
    )
    assert code == 201
    cid = created["conversation"]["id"]
    n.wait_job(submit("rollback"), {"succeeded"})
    assert_bytes(imp, digest)
    assert n.request(n.root, "/api/conversations/" + cid)[0] == 200
    if committed:
        assert n.request(n.root, "/api/conversations/" + committed)[0] == 200
    if control_cid:
        assert n.request(n.root, "/api/conversations/" + control_cid)[0] == 200
    intact(baseline)
    print(
        "PASS: active upload and exact bytes survived program rollback; no backup or fence. Exporter commit: "
        + (error or "succeeded"),
        flush=True,
    )

    p.cert("web")
    prepare()
    job = submit("apply")
    n.wait_job(job, {"program-health"})
    n.restart_control()
    n.wait_job(job, {"restored"})
    intact(baseline)
    print("PASS: coordinator restarted mid-cutover; reconciled actual old programs", flush=True)

    # Deliberately unbootable signed candidate, generated only by the lab key.
    a = n.state()["Current"]["revision"]
    bad = hashlib.sha1(("program-bad" + a).encode()).hexdigest()
    m.fixture_version(a, bad, "v1.2.0", m.LAB / "bad-program", failed_start=True)
    n.switch_feed(m.LAB / "bad-program", m.LAB / "before-bad-program")
    p.cert("web")
    prepare()
    n.wait_job(submit("apply"), {"restored"})
    assert n.request(n.root, "/api/conversations/" + cid)[0] == 200
    intact(baseline)
    print("PASS: broken Web startup restored program only; newer data survived", flush=True)

    n.switch_feed(m.LAB / "before-bad-program", m.LAB / "failed-program-feed")
    p.cert("web")
    signature = m.LAB / "feed/program-transition-v1.json.sig"
    trusted = signature.read_bytes()
    try:
        signature.write_bytes(b"invalid")
        n.post("check", code=409)
        intact(baseline)
    finally:
        signature.write_bytes(trusted)
    n.post("check")
    small = m.LAB / "program-scratch/space-test"
    small.mkdir()
    jobs = m.ROOT / "jobs"
    m.run("mount", "-t", "tmpfs", "-o", "size=16m,noexec,nodev,nosuid", "tmpfs", small)
    try:
        m.run("mount", "--bind", small, jobs)
        try:
            denied = submit("prepare")
            n.wait_job(denied, {"refused"}, "insufficient_space")
            intact(baseline)
        finally:
            m.run("umount", jobs)
        shutil.copytree(small / denied, jobs / denied)
    finally:
        m.run("umount", small)
    print("PASS: invalid pair signature and bounded fast staging disk refused without fencing", flush=True)
    prepare()
    proof = json.loads((m.ETC / "program-recovery.json").read_text())
    # Never corrupt even the lab's only verified recovery point. Substitute a
    # separate damaged copy at its old filename while keeping the valid inode.
    archive = m.LAB / "backups" / proof["backup"] / "imports.tar.gz"
    saved = m.LAB / "program-scratch" / "intact-recovery.tar.gz"
    assert not saved.exists()
    archive.rename(saved)
    try:
        archive.write_bytes(b"damaged fixture copy")
        n.wait_job(submit("apply"), {"refused"}, "recovery_or_profile")
        intact(baseline)
        print("PASS: changed recovery point refused before stop; no slow fallback", flush=True)
    finally:
        os.replace(saved, archive)
    # Verify every byte of the large post-backup data after all mutations.
    seed = json.loads((m.LAB / "program-scratch/baseline.json").read_text())["mib"]
    b = b"".join(hashlib.sha256(str(i).encode()).digest() for i in range(32768))
    h = hashlib.sha256()
    for _ in range(seed // 4):
        h.update(b)
    for k in ("imports", "exports", "offline", "assets"):
        assert (
            m.run("docker", "exec", "updatefixture-api-1", "sha256sum", "/data/" + k + "/program-load.bin")
            .split()[0]
            .decode()
            == h.hexdigest()
        )
    print("PASS: all four post-restore-point volumes reread and matched", flush=True)
    # Independent fault scenarios above still execute. A failed control or
    # mid-update import remains a HARD release failure, never a skip/xfail.
    if control_error or error:
        raise RuntimeError("exporter commit gate: control=%s cutover=%s" % (control_error, error))


if __name__ == "__main__":
    main()
