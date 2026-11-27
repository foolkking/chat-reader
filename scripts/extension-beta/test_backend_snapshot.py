"""Offline-only source snapshot regressions. No Gate initialization or services."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), Path(__file__).with_name(name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


g1 = load("backend-gate")
g4 = load("append-backend-gate")


class BackendSnapshotTests(unittest.TestCase):
    def setUp(self):
        parent = Path(os.environ["TEMP"]).resolve()
        self.assertTrue(parent.is_dir())
        self.root = Path(tempfile.mkdtemp(prefix="snapshot-unit-", dir=parent)).resolve()
        self.repo = self.root / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "--quiet", self.repo], check=True, capture_output=True)
        self.write(".gitignore", "ignored.py\n.env\n")
        self.write("apps/api/app/main.py", "# synthetic tracked source\n")
        subprocess.run(["git", "-C", self.repo, "add", ".gitignore", "apps/api/app/main.py"],
                       check=True, capture_output=True)
        self.write("apps/api/app/services/adaptive_import/append_scratch.py", "# synthetic new module\n")
        self.write("apps/api/app/ignored.py", "# synthetic ignored input\n")
        self.write("apps/api/app/.env", "synthetic-never-copy")
        self.write("apps/api/storage/imports/synthetic-private.json", "synthetic-never-copy")
        self.write("unrelated.py", "# outside explicit API scope\n")

    def write(self, name, value):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf8")

    def gate(self, cls, label):
        # Do not call __init__: no random ports, credentials, HTTP or Docker.
        instance = cls.__new__(cls)
        instance.root = self.root / label
        instance.root.mkdir()
        instance.report = {}
        instance.env = dict(os.environ)
        def command(args, **_kwargs):
            self.assertEqual(args[0], "git")
            if args[1:] == ["rev-parse", "HEAD"]:
                return b"0" * 40  # The synthetic index deliberately has no commit.
            return subprocess.run(args, cwd=self.repo, check=True, capture_output=True).stdout
        instance.command = command
        return instance

    def test_both_gates_include_untracked_api_source_and_exclude_ignored_or_private_paths(self):
        source = "apps/api/app/services/adaptive_import/append_scratch.py"
        # These are only auxiliary G4 fingerprints; none are copied as API code.
        for name in (
            "scripts/extension-beta/append-backend-gate.py", "scripts/extension-beta/append-package.cjs",
            "apps/api/tests/test_selective_append_postgres.py", "apps/api/tests/test_append_ranges_postgres.py",
            "apps/api/tests/test_append_selection_ranges.py", "apps/web/lib/append-selection.ts",
            "apps/web/features/import/append-import-workspace.tsx", "apps/web/lib/api.ts",
        ):
            self.write(name, "# synthetic gate input\n")
        for module, cls, label in ((g1, g1.Gate, "g1"), (g4.base, g4.Gate, "g4")):
            with self.subTest(gate=label), patch.object(module, "REPO", self.repo):
                gate = self.gate(cls, label)
                gate.snapshot()
                hashes = json.loads((gate.root / "source-hashes.json").read_text())
                self.assertEqual(set(hashes), {"apps/api/app/main.py", source})
                self.assertEqual(gate.report["source_files"], 2)
                self.assertEqual(gate.report["source_manifest_sha256"],
                                 module.sha(json.dumps(hashes, sort_keys=True).encode()))
                for name, digest in hashes.items():
                    copied = gate.root / "source" / Path(name).relative_to("apps/api")
                    self.assertEqual(copied.read_bytes(), (self.repo / name).read_bytes())
                    self.assertEqual(module.sha(copied.read_bytes()), digest)
                gate.verify_snapshot()

    def test_snapshot_verification_rejects_new_or_changed_inputs_and_changed_copy(self):
        with patch.object(g1, "REPO", self.repo):
            for kind in ("new", "changed", "copied"):
                with self.subTest(kind=kind):
                    gate = self.gate(g1.Gate, kind)
                    gate.snapshot()
                    if kind == "new":
                        self.write("apps/api/app/new_after_snapshot.py", "# late source\n")
                    elif kind == "changed":
                        self.write("apps/api/app/main.py", "# changed source\n")
                    else:
                        (gate.root / "source/app/main.py").write_text("# changed copy\n")
                    with self.assertRaisesRegex(AssertionError, "snapshot"):
                        gate.verify_snapshot()

    def test_unreviewed_untracked_non_source_is_rejected_before_any_copy(self):
        self.write("apps/api/app/unknown.json", "synthetic-never-copy")
        with patch.object(g1, "REPO", self.repo):
            gate = self.gate(g1.Gate, "unsafe")
            with self.assertRaisesRegex(AssertionError, "unreviewed-untracked-snapshot-input"):
                gate.snapshot()
            self.assertFalse((gate.root / "source").exists())


if __name__ == "__main__":
    unittest.main()
