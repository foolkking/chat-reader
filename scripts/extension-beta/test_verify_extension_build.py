import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from verify_extension_build import verify


class BrowserCandidateTests(unittest.TestCase):
    origin = "http://127.0.0.1:18483"

    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.addCleanup(self.scratch.cleanup)
        self.build = Path(self.scratch.name) / "extension"
        self.build.mkdir()
        self.package = self.build.parent / "chat-reader-0.2.0.zip"
        with ZipFile(self.package, "w") as z:
            for name, data in {
                "manifest.json": json.dumps({"version": "0.2.0"}),
                "config.js": f'globalThis.READER_ORIGIN="{self.origin}";\n',
                "picker.js": "fixture",
            }.items():
                (self.build / name).write_bytes(data.encode())
                z.writestr(name, data)
        self.pin = hashlib.sha256(self.package.read_bytes()).hexdigest()

    def test_exact_candidate_and_lab_are_bound(self):
        r = verify(self.build, self.origin, self.pin)
        self.assertEqual((r["files"], r["zipBytes"], r["sha256"]), (3, self.package.stat().st_size, self.pin))
        with self.assertRaisesRegex(ValueError, "lab"):
            verify(self.build, "http://127.0.0.1:18383", self.pin)

    def test_old_build_or_patched_same_size_file_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "pinned"):
            verify(self.build, self.origin, "0" * 64)
        (self.build / "picker.js").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "bytes"):
            verify(self.build, self.origin, self.pin)

    def test_extra_unpacked_file_is_not_an_installable_match(self):
        (self.build / "unshipped.js").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "file set"):
            verify(self.build, self.origin, self.pin)
