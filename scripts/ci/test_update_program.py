import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import program_proof as proof

ROOT = Path(__file__).resolve().parents[2]


def load(name, rel):
    spec = importlib.util.spec_from_file_location(name, ROOT / rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


stream = load("stream", "deploy/backup_stream.py")
host = load("adapter", "deploy/updater/host.py")
restore = load("isolated_restore", "deploy/updater/prove_recovery.py")


class Bundle(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.body = {
            "format": 1,
            "version": "v1.1.0",
            "revision": "b" * 40,
            "repository": "demo/source",
            "repository_id": 5,
            "archive_sha256": "b" * 64,
            "images": {r: {"config": "sha256:" + "b" * 64} for r in proof.PARTS},
        }
        self.p = {k: v for k, v in self.body.items() if k != "images"}
        self.p.update(
            release_run=123,
            release_attempt=2,
            verification_key_sha256=proof.digest(b"x" * 32),
            mode="program",
            from_version="v1.0.0",
            from_revision="a" * 40,
            from_archive_sha256="a" * 64,
            roles=["api"],
            checks=proof.TESTS,
            from_config={r: "sha256:" + "a" * 64 for r in proof.PARTS},
            target_config={r: i["config"] for r, i in self.body["images"].items()},
        )

    def signed_input(self, p):
        path = self.root / "kit.tar.gz"
        member = tarfile.TarInfo("deploy/updater/program-evidence.json")
        b = proof.packed(p)
        member.size = len(b)
        with tarfile.open(path, "w:gz") as t:
            t.addfile(member, io.BytesIO(b))
        return proof.for_signer(path, self.body, proof.packed(self.body), 123, 2, b"x" * 32)

    def test_detached_receipt_covers_exact_rehearsal_and_manifest(self):
        raw, pair = self.signed_input(self.p)
        data = json.loads(pair)
        self.assertEqual(data["evidence_sha256"], proof.digest(raw))
        self.assertEqual(data["target_manifest_sha256"], proof.digest(proof.packed(self.body)))
        self.assertEqual(data["from_config"], self.p["from_config"])

    def test_unproven_version_has_no_signed_fast_path(self):
        for reason in ("unproven_changes", "runtime_drift"):
            _, pair = self.signed_input(dict(self.p, mode="full", reason=reason))
            self.assertIsNone(pair)
        for change in (
            {"checks": []},
            {"roles": ["import-worker"]},
            {"repository_id": 6},
            {"revision": "a" * 40},
            {"target_config": {}},
            {"release_run": 124},
            {"release_attempt": 1},
            {"verification_key_sha256": "0" * 64},
            {"from_revision": "b" * 40},
            {"from_version": "v1.2.0"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.signed_input(dict(self.p, **change))

    def test_only_reviewed_pure_changes(self):
        s = (ROOT / proof.API).read_text(encoding="utf8")
        self.assertTrue(proof.pure(s, s.replace("match_start - 80", "match_start - 72", 1)))
        self.assertFalse(proof.pure(s, s.replace("match_start - 80", "open(text)", 1)))
        self.assertFalse(
            proof.pure(
                s,
                s.replace(
                    "normalized_query = query.strip()", "db.commit()\n    normalized_query = query.strip()", 1
                ),
            )
        )
        self.assertTrue(proof.css("  gap: 3px;", "  gap: 4px;"))
        self.assertFalse(proof.css("  color: red;", "  color: url(elsewhere);"))
        self.assertFalse(proof.css(".first {", ".different {"))


class Backup(unittest.TestCase):
    def test_failed_producer_or_writer_cannot_publish_a_partial_backup(self):
        env = dict(
            os.environ, SCRIPT_DIR=(ROOT / "deploy").as_posix(), PYTHON=Path(sys.executable).as_posix()
        )
        for failure in ("producer", "writer", "none"):
            w = self.d / failure
            w.mkdir()
            cmd = (
                "partial() { printf bytes; " + ("return 7" if failure == "producer" else "return 0") + "; };"
            )
            if failure == "writer":
                (w / "postgres.dump").write_bytes(b"do not replace")
            r = subprocess.run(
                [
                    "sh",
                    "-c",
                    '. "$SCRIPT_DIR/backup_volume_reader.sh";'
                    + cmd
                    + "if backup_stream_to postgres.dump partial; then exit 0; else exit 1; fi",
                ],
                env=dict(env, work_dir=w.as_posix()),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self.assertEqual(r.returncode == 0, failure == "none")
            if failure == "writer":
                self.assertEqual((w / "postgres.dump").read_bytes(), b"do not replace")

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.d = Path(self.tmp.name)
        b = io.BytesIO()
        with tarfile.open(fileobj=b, mode="w:gz") as t:
            m = tarfile.TarInfo("file")
            m.size = 4
            t.addfile(m, io.BytesIO(b"data"))
        self.archive = b.getvalue()
        for name in stream.PARTS:
            stream.write(
                self.d / name, io.BytesIO(self.archive if name.endswith(".gz") else b"synthetic pg component")
            )
        self.resign()

    def resign(self):
        sums = [hashlib.sha256((self.d / n).read_bytes()).hexdigest() + "  " + n for n in stream.PARTS]
        text = "\n".join(sums) + "\n"
        (self.d / "SHA256SUMS").write_text(text)
        (self.d / "MANIFEST").write_text(
            "schema_version=1\ncreated_at=20261121T102354Z\nsource_sha=fixture\npostgres_tool=pg_dump\nsource=postgres-and-business-volumes\ncomponents=postgres,imports,exports,offline,assets\n"
            + text
        )

    def test_independent_read_detects_changed_disk_bytes(self):
        (self.d / "postgres.dump").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            stream.check_files(self.d)

    def test_incomplete_components_and_manifest_rejected_before_streaming(self):
        (self.d / "SHA256SUMS").write_text((self.d / "SHA256SUMS").read_text().splitlines()[0] + "\n")
        with self.assertRaises(ValueError):
            stream.check_files(self.d)
        self.resign()
        (self.d / "MANIFEST").write_text(
            (self.d / "MANIFEST").read_text().replace("schema_version=1", "schema_version=2")
        )
        with self.assertRaises(ValueError):
            stream.check_files(self.d)

    def test_valid_and_damaged_tar_even_when_checksum_matches(self):
        # Same host Linux tools as shipping. Windows uses its MSYS equivalents
        # when invoked locally, CI always runs this full path under GNU/Linux.
        stream.check_files(self.d)
        for bad in (self.archive[:-6], gzip.compress(b"not a tar archive\n")):
            (self.d / "assets.tar.gz").write_bytes(bad)
            self.resign()
            with self.assertRaises((ValueError, BrokenPipeError)):
                stream.check_files(self.d)

    def test_isolated_restore_never_follows_links_or_parent_paths(self):
        for member in ("../outside", "/outside", "link"):
            p = self.d / "bad.tgz"
            with tarfile.open(p, "w:gz") as t:
                m = tarfile.TarInfo(member)
                if member == "link":
                    m.type = tarfile.SYMTYPE
                    m.linkname = "outside"
                t.addfile(m)
            with self.assertRaises(ValueError):
                restore.restore_files(p, self.d)


class ProtectedHost(unittest.TestCase):
    def test_writable_code_loader_or_changed_workdir_is_not_stock(self):
        normal = {"Env": ["PATH=/usr/bin", "PYTHONUNBUFFERED=1"], "WorkingDir": "/app"}
        self.assertTrue(
            host.Host.stock_runtime(dict(normal, Env=normal["Env"] + ["AUTH_ENABLED=true"]), normal)
        )
        for changed in (
            dict(normal, WorkingDir="/tmp"),
            dict(normal, Env=normal["Env"] + ["PYTHONPATH=/data/assets"]),
        ):
            self.assertFalse(host.Host.stock_runtime(changed, normal))

    def test_program_profile_never_replaces_a_writable_or_privileged_core(self):
        node = {
            "Id": "a" * 64,
            "HostConfig": {
                "ReadonlyRootfs": True,
                "Privileged": False,
                "CapDrop": ["ALL"],
                "SecurityOpt": ["no-new-privileges:true"],
            },
            "Config": {"Labels": {"com.docker.compose.service": "api"}},
            "Mounts": [
                {
                    "Destination": "/tmp",
                    "Type": "bind",
                    "Source": str(host.SCRATCH / "api"),
                    "RW": True,
                    "Propagation": "rprivate",
                }
            ],
        }
        adapter = object.__new__(host.Host)
        with patch.object(host, "PROFILE", Path(__file__)), patch.object(adapter, "scratch_safe"):
            adapter.check_core(node)
            for edits in (
                {"ReadonlyRootfs": False},
                {"Tmpfs": {"/app": "rw"}},
                {"Devices": [{}]},
                {"CapAdd": ["SYS_ADMIN"]},
            ):
                with self.subTest(edits=edits), self.assertRaises(ValueError):
                    adapter.check_core(dict(node, HostConfig=dict(node["HostConfig"], **edits)))
            with self.assertRaises(ValueError):
                adapter.check_core(dict(node, Mounts=[{"Destination": "/usr"}]))


if __name__ == "__main__":
    unittest.main()
