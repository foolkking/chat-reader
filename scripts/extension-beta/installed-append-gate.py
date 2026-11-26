"""Extend (do not replace) the 1001-row PostgreSQL gate with the candidate's exact 251-row capture.

Synthetic data only. See the dated delivery report for the fixture generator and invocation.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import uuid

spec = importlib.util.spec_from_file_location("range_backend", Path(__file__).with_name("append-backend-gate.py"))
ranges = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ranges)
base = ranges.base


class Gate(ranges.Gate):
    def http_gate(self):
        super().http_gate()
        base.approved(self.evidence)
        meta = json.loads(self.evidence.read_bytes())
        base.require(meta["syntheticOnly"] is True and meta["count"] == 251 and
                     meta["fixture"] == "installed-append-251.zip", "installed-append-fixture")
        fixture = self.evidence.with_name(meta["fixture"])
        base.approved(fixture)
        raw = fixture.read_bytes()
        base.require(base.sha(raw) == meta["zipSHA256"] and len(meta["bodyHashes"]) == 251, "installed-fixture-hash")
        client, web = self.device_client, self.web
        cid = self.request(web, "POST", "/api/conversations", expected=201, json={
            "title": "Synthetic candidate append",
            "messages": [{"role": "user", "content_markdown": "Synthetic original question"},
                         {"role": "assistant", "content_markdown": "Synthetic original answer remains unchanged"}]
        }).json()["conversation"]["id"]
        original = self.canonical_rows(cid)
        base.require(len(original) == 2, "synthetic-original-pair")
        device_fields = {"id", "state", "status", "mode", "failure", "phase", "progress", "wait", "result"}
        for added, skipped in [(251, 0), (0, 251)]:
            key = str(uuid.uuid4())
            transfer = "/api/extension/v1/transfers/" + key
            binding = {"size": len(raw), "sha256": base.sha(raw), "excerpt": True}
            start = self.request(client, "POST", transfer, json=binding).json()
            base.require(start["offset"] == 0 and 0 < len(raw) <= start["chunk_bytes"], "single-synthetic-chunk")
            accepted = self.request(client, "POST", transfer + "/chunks",
                                    data={"offset": "0", "sha256": base.sha(raw)},
                                    files={"chunk": ("chunk", raw, "application/octet-stream")}).json()
            base.require(accepted["offset"] == len(raw), "installed-wire-durable-offset")
            iid = self.request(client, "POST", transfer + "/finish").json()["id"]
            base.require(self.request(client, "GET", "/api/extension/v1/requests/" + key).json()["id"] == iid,
                         "same-device-receipt")
            state = self.status(iid, "previewed")
            device_path, owner_path = "/api/extension/v1/imports/" + iid, "/api/append-imports/" + iid
            receipt = self.request(client, "GET", device_path).json()
            base.require(set(receipt) == device_fields and receipt["mode"] == "selective_append" and receipt["result"] is None
                         and state["sources"][0]["count"] == 251, "readonly-append-preview")
            chosen = {"target": cid, "edition": state["edition"], "volume": 0, "ranges": [[0, 251]], "selected_count": 251}
            review = self.request(web, "POST", owner_path + "/review", json=chosen).json()
            base.require((review["add"], review["skip"]) == (added, skipped), "installed-append-review-counts")
            self.request(client, "POST", device_path + "/commit", expected=409, json={"receipt": review["receipt"]})
            approved = {**chosen, "receipt": review["receipt"]}
            self.request(web, "POST", owner_path + "/confirm", expected=202, json=approved)
            self.request(web, "POST", owner_path + "/confirm", expected=(200, 202), json=approved)
            self.status(iid, "committed")
            final = self.request(client, "GET", device_path).json()
            base.require(set(final) == device_fields and final["result"] == {"added": added, "skipped": skipped, "partial": False},
                         "exact-device-result-without-destination")
            rows = self.canonical_rows(cid)
            base.require(rows[:2] == original and len(rows) == 253, "original-not-overwritten")
            base.require([{"role": r["role"], "sha256": base.sha(r["current_version"]["display_text"].encode())}
                          for r in rows[2:]] == meta["bodyHashes"], "installed-append-canonical-roles-bytes-order")
            self.step("installed-251-append" if added else "installed-251-duplicate", added=added, skipped=skipped,
                      original_unchanged=True, same_order_roles_body_hashes=True, device_commit=409, duplicate_confirm=True)
        self.report["installed_append"] = {"installer_sha256": meta["installerSHA256"], "fixture_sha256": base.sha(raw),
                                           "evidence_sha256": base.sha(self.evidence.read_bytes()),
                                           "harness_sha256": base.sha(Path(__file__).read_bytes())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("parent", "fork", "evidence"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    gate = Gate(args.parent, args.fork)
    gate.evidence = args.evidence
    gate.report["scope"] = "Synthetic installed-module capture, real loopback Reader device and Web session HTTP; no live browser."
    sys.exit(gate.run())
