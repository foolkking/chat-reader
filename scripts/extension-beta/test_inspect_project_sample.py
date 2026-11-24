import json
import io
import sys
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from inspect_project_sample import SampleError, inspect, main


class ProjectSampleTests(unittest.TestCase):
    def test_counts_do_not_read_independent_files_or_identify_private_content(self):
        marker = "synthetic-never-print"
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "fixture.zip"
            with zipfile.ZipFile(p, "w") as z:
                for i, row in enumerate([
                    {"id": "first", "project_id": marker, "gizmo_id": "not-a-project"},
                    {"id": "second", "gizmo_id": "not-a-project"}, {"id": "first"},
                ]):
                    row.update(title=marker, current_node="end", mapping={"end": {
                        "message": {"content": {"parts": [{"content_type": "image_asset_pointer"}]},
                                    "metadata": {"attachments": [{"name": marker}]}}, "children": []}})
                    z.writestr(f"conversations-{i}.json", json.dumps([row]))
                z.writestr(marker + ".png", b"unread")
                z.writestr("projects.json", "not even JSON; discovery is not proof")
            read = zipfile.ZipFile.open
            def catalog_only(archive, info, *a, **kw):
                self.assertTrue(info.filename.startswith("conversations-"))
                return read(archive, info, *a, **kw)
            with patch.object(zipfile.ZipFile, "open", catalog_only):
                r = inspect(p)
            self.assertEqual((r["catalogs"], r["conversations"], r["distinct_candidate_project_fields"],
                              r["project_field_unknown"], r["duplicate_source_identities"]), (3, 3, 1, 2, 1))
            self.assertEqual((r["declared_attachment_entries"], r["image_pointer_entries"],
                              r["media_bytes_examined"], r["custom_gpt_without_project_field"]), (3, 3, 0, 1))
            self.assertNotIn(marker, json.dumps(r))
            self.assertTrue(r["manual_project_branch_and_file_verification_required"])

    def test_missing_catalog_oversize_or_ambiguous_input_is_not_success(self):
        with tempfile.TemporaryDirectory() as tmp:
            for i, (name, body, error) in enumerate([
                ("projects.json", b"[]", "no_recognized"), ("../conversations.json", b"[]", "unsafe"),
                ("conversations.json", b" " * (4*1024*1024+1), "smaller"),
                ("conversations.json", json.dumps([{}] * 17).encode(), "small_conversation"),
                ("conversations.json", b"[{}]", "unrecognized"),
            ]):
                p = Path(tmp) / f"fixture-{i}.zip"
                with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED) as z:
                    z.writestr(name, body)
                with self.subTest(i=i), self.assertRaisesRegex(SampleError, error):
                    inspect(p)

    def test_cli_does_not_print_a_private_path_or_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "never-print-this-filename.zip"
            with zipfile.ZipFile(p, "w") as z:
                z.writestr("conversations.json", "private-invalid-data")
            with patch.object(sys, "argv", ["inspect", "--dedicated-test-export", str(p)]), redirect_stdout(io.StringIO()) as out:
                self.assertEqual(main(), 2)
            self.assertEqual(json.loads(out.getvalue()), {"error": "unreadable_or_unsupported_sample"})
