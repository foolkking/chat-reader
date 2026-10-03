"""Exercise the shipped Nginx upload locations on isolated loopback listeners.

Transport evidence only: the synthetic upstream hashes bytes and checks forwarded
headers. Application authorization, ZIP safety and persistence have separate gates.
No production configuration or data is used. Requires nginx on PATH.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class Receiver(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass

    def do_POST(self):
        remaining = int(self.headers["Content-Length"])
        digest = hashlib.sha256()
        count = 0
        while remaining:
            chunk = self.rfile.read(min(remaining, 64 * 1024))
            if not chunk:
                break
            digest.update(chunk)
            count += len(chunk)
            remaining -= len(chunk)
        payload = json.dumps({"bytes": count, "digest": digest.hexdigest(),
                              "origin": self.headers.get("Origin"),
                              "cookie": self.headers.get("Cookie"),
                              "protocol": self.headers.get("X-Forwarded-Proto")}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    nginx = shutil.which("nginx")
    if not nginx:
        raise SystemExit("nginx is required; this transport gate has not run")
    source = (Path(__file__).resolve().parents[1] / "deploy/nginx-chat-reader.conf").read_text()
    block = source.split("# BEGIN CONTEXT BUNDLE UPLOADS\n", 1)[1].split("# END CONTEXT BUNDLE UPLOADS", 1)[0]
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    threading.Thread(target=upstream.serve_forever, daemon=True).start()
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="context-upload-proxy-") as directory:
        root = Path(directory)
        config = root / "nginx.conf"
        block = block.replace("127.0.0.1:8000", f"127.0.0.1:{upstream.server_port}")
        user = "user root;\n" if hasattr(os, "geteuid") and os.geteuid() == 0 else ""
        config.write_text(user + f"""worker_processes 1;
pid {root}/nginx.pid;
error_log {root}/error.log warn;
events {{ worker_connections 32; }}
http {{
    access_log off;
    client_body_temp_path {root}/body;
    proxy_temp_path {root}/proxy;
    server {{
        listen 127.0.0.1:{port};
        client_max_body_size 60m;
        {block}
        location / {{ return 418; }}
    }}
}}
""")
        subprocess.run([nginx, "-t", "-p", str(root), "-c", str(config)], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        process = subprocess.Popen([nginx, "-p", str(root), "-c", str(config), "-g", "daemon off;"])
        try:
            for _ in range(100):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.1):
                        break
                except OSError:
                    if process.poll() is not None:
                        raise RuntimeError("Isolated Nginx did not start")
                    time.sleep(0.05)
            else:
                raise RuntimeError("Isolated Nginx readiness timeout")
            fixture_id = "00000000-0000-4000-8000-000000000001"
            paths = [f"/api/conversations/{fixture_id}/continuation/returns",
                     "/api/skills", f"/api/skills/{fixture_id}/revisions",
                     "/api/admin/system-skills/bundle",
                     f"/api/admin/system-skills/{fixture_id}/revisions"]
            body = b"synthetic-upload" * (12 * 1024 * 1024 // 16)
            expected = hashlib.sha256(body).hexdigest()
            headers = {"Origin": f"http://127.0.0.1:{port}", "Cookie": "synthetic=fixture-only",
                       "Content-Type": "application/octet-stream"}
            for path in paths:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
                connection.request("POST", path, body, headers)
                response = connection.getresponse()
                assert response.status == 200, (path, response.status)
                actual = json.loads(response.read())
                assert actual == {"bytes": len(body), "digest": expected,
                                  "origin": headers["Origin"], "cookie": headers["Cookie"],
                                  "protocol": "http"}
                connection.close()
            for path, size in [(paths[0], 521 * 1024 * 1024), (paths[1], 21 * 1024 * 1024)]:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                connection.request("POST", path, headers={"Content-Length": str(size)})
                response = connection.getresponse()
                assert response.status == 413, response.status
                response.read()
                connection.close()
            for path in ["/api/shares", paths[0] + "/other", "/api/admin/runtime-status",
                         f"/api/conversations/{fixture_id}/continuation/files"]:
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                connection.request("GET", path)
                response = connection.getresponse()
                assert response.status == 418, (path, response.status)
                response.read()
                connection.close()
            print("PASS: 5 large-body routes preserve bytes/auth headers; 2 size limits; 4 unrelated paths unchanged")
        finally:
            process.terminate()
            process.wait(timeout=10)
            upstream.shutdown()
            upstream.server_close()


if __name__ == "__main__":
    main()
