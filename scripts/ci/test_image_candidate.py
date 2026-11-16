import copy
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import tarfile
import unittest

import image_candidate as gate
from image_archive_identity import identities

SOURCE, RUN, ATTEMPT = "b" * 40, "17", "1"


def memory(images):
    base = {
        "revision": SOURCE, "passed": True, "real_sensor": True, "run_id": RUN, "run_attempt": ATTEMPT,
        "image_engine_id": images["api"]["engine_id"], "memory_limit_bytes": 335544320,
        "worker_image_id": images["api"]["config_id"],
        "memory_swap_limit_bytes": 335544320, "workspace_peak_delta_bytes": 1024, "oom": 0,
        "oom_kill": 0, "failcnt_delta": 0, "restarts": 0, "conversation_count": 1,
        "message_count": 4, "attachment_count": 14, "reference_count": 13, "verified_asset_hashes": 14,
    }
    cases = []
    for name in ("small", "assets100", "assets500", "long"):
        case = {**base, "case": name, "draft_format": 2}
        if name != "small":
            case.update(message_count=36, block_count=6000, attachment_count=4, verified_asset_hashes=4, reference_count=4)
        if name == "assets100":
            case["archive_bytes"] = 104857600
        if name == "assets500":
            case.update(archive_bytes=524288000, memory_limit_bytes=671088640, memory_swap_limit_bytes=671088640)
        if name == "long":
            case.update(archive_bytes=2097152, attachment_count=0, verified_asset_hashes=0, reference_count=0)
        cases.append(case)
    return base, {"revision": SOURCE, "passed": True, "real_sensor": True, "cases": cases}


class ImageCandidateTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="image-candidate-control-", dir=os.environ["TEMP"]))
        self.images = {role: {"config_id": "sha256:" + ("a" if role != "web" else "b") * 64,
                              "platform": "linux/amd64", "rootfs": ["sha256:" + "d" * 64]}
                       for role in gate.ROLES}
        for item in self.images.values():
            item["engine_id"] = item["config_id"]
            item["accepted_engine_ids"] = [item["config_id"]]
        original, bounded = memory(self.images)
        for name in gate.FILES:
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b"synthetic controlled bytes")
        gate_path = self.root / "image-inspection.json"
        gate_path.write_text(json.dumps({"revision": SOURCE, "forbidden_paths_present": False,
                                        "images": [{"name": f"chat-reader-{role}:{SOURCE}", "id": data["config_id"]}
                                                   for role, data in self.images.items()]}))
        (self.root / "small-zip-memory.json").write_text(json.dumps(original))
        (self.root / "bounded-zip-memory.json").write_text(json.dumps(bounded))
        self.candidate = {
            "schema_version": 1, "purpose": "non-deployable-image-candidate", "deployable": False,
            "source_sha": SOURCE, "run_id": RUN, "run_attempt": ATTEMPT,
            "schedule_sha256": gate.SCHEDULE_SHA256, "producer_job": "image-preparation", "images": self.images,
            "files": {name: {"sha256": gate.sha(self.root / name), "bytes": (self.root / name).stat().st_size}
                      for name in gate.FILES},
        }

    def check(self, actual=None):
        gate.validate_candidate(self.candidate, self.root, SOURCE, RUN, ATTEMPT, actual or self.images)

    def test_exact_candidate_and_all_five_real_gate_proofs(self):
        self.check()

    def test_wrong_source_attempt_images_platform_or_deployable_rejected(self):
        baseline = copy.deepcopy(self.candidate)
        for key, value in (("source_sha", "a" * 40), ("run_attempt", "2"), ("run_id", "18"),
                           ("deployable", True), ("producer_job", "build-images"),
                           ("schedule_sha256", "0" * 64)):
            with self.subTest(key=key):
                self.candidate = {**copy.deepcopy(baseline), key: value}
                with self.assertRaises(AssertionError):
                    self.check()
        self.candidate = baseline
        for field, value in (("config_id", "sha256:" + "f" * 64), ("platform", "linux/arm64"),
                             ("rootfs", ["sha256:" + "e" * 64])):
            actual = copy.deepcopy(self.images)
            actual["web"][field] = value
            with self.assertRaises(AssertionError):
                self.check(actual)

    def test_same_revision_label_does_not_hide_different_measured_image_or_missing_resource(self):
        original, bounded = memory(self.images)
        for name, mutate in (
            ("missing", lambda a, b: b["cases"].pop()),
            ("duplicate", lambda a, b: b["cases"].__setitem__(0, copy.deepcopy(b["cases"][1]))),
                ("different image", lambda a, b: a.update(image_engine_id="sha256:" + "f" * 64)),
                ("different measured worker", lambda a, b: a.update(worker_image_id="sha256:" + "f" * 64)),
            ("wrong attempt", lambda a, b: b["cases"][0].update(run_attempt="2")),
            ("swap", lambda a, b: a.update(memory_swap_limit_bytes=671088640)),
            ("oom", lambda a, b: b["cases"][2].update(oom_kill=1)),
            ("failed", lambda a, b: a.update(passed=False)),
            ("workspace", lambda a, b: b["cases"][1].update(workspace_peak_delta_bytes=67108865)),
        ):
            with self.subTest(name=name):
                a, b = copy.deepcopy(original), copy.deepcopy(bounded)
                mutate(a, b)
                with self.assertRaises(AssertionError):
                    gate.validate_memory(a, b, self.images, SOURCE, RUN, ATTEMPT)

    def test_archive_report_hash_and_missing_files_fail_closed(self):
        (self.root / "chat-reader-images.tar.gz").write_bytes(b"replacement build")
        with self.assertRaises(AssertionError):
            self.check()
        self.candidate["files"].pop("small-zip-memory.json")
        with self.assertRaises(AssertionError):
            self.check()

    def test_candidate_artifact_source_digest_attempt_and_id_are_exact(self):
        digest = "sha256:" + "a" * 64
        metadata = {"id": 123, "digest": digest, "expired": False, "size_in_bytes": 300,
                    "name": f"non-deployable-image-candidate-{SOURCE}-{ATTEMPT}",
                    "workflow_run": {"id": int(RUN), "head_sha": SOURCE}}
        gate.validate_artifact(metadata, "123", digest, SOURCE, RUN, ATTEMPT)
        for key, value in (("id", 124), ("digest", "sha256:" + "b" * 64), ("expired", True),
                           ("name", f"chat-reader-images-{SOURCE}-{ATTEMPT}"),
                           ("workflow_run", {"id": int(RUN), "head_sha": "a" * 40})):
            with self.subTest(key=key), self.assertRaises(AssertionError):
                gate.validate_artifact({**metadata, key: value}, "123", digest, SOURCE, RUN, ATTEMPT)

    def test_any_quality_failure_skip_missing_or_other_attempt_prevents_promotion(self):
        spec = importlib.util.spec_from_file_location("candidate_test_policy", Path(gate.__file__).with_name("image-only-quality-reuse.py"))
        policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(policy)
        proof = {"schema_version": 1, "verification": {
            "mode": "full-exact", "quality_passed": True,
            "candidate": {"sha": SOURCE, "workflow_run_id": RUN, "workflow_run_attempt": int(ATTEMPT)},
            "source": {"sha": SOURCE, "workflow_run_id": RUN, "quality_jobs": [
                {"name": name, "status": "completed", "conclusion": "success", "source_attempt": 1}
                for name in policy.FULL_QUALITY_NAMES]},
        }}
        gate.validate_quality(proof, SOURCE, RUN, ATTEMPT)
        for index in range(len(policy.FULL_QUALITY_NAMES)):
            for result in ("failure", "skipped", "cancelled"):
                bad = copy.deepcopy(proof)
                bad["verification"]["source"]["quality_jobs"][index]["conclusion"] = result
                with self.assertRaises(AssertionError):
                    gate.validate_quality(bad, SOURCE, RUN, ATTEMPT)
        bad = copy.deepcopy(proof)
        bad["verification"]["source"]["quality_jobs"].pop()
        with self.assertRaises(AssertionError):
            gate.validate_quality(bad, SOURCE, RUN, ATTEMPT)


class ImageArchiveTests(unittest.TestCase):
    def fixture(self, mutation=None):
        root = Path(tempfile.mkdtemp(prefix="image-archive-control-", dir=os.environ["TEMP"]))
        entries, members = [], {}
        for role in ("api", "web"):
            config = {"architecture": "amd64", "os": "linux",
                      "config": {"Labels": {"org.opencontainers.image.revision": SOURCE}},
                      "rootfs": {"type": "layers", "diff_ids": ["sha256:" + ("1" if role == "api" else "2") * 64]}}
            raw = json.dumps(config).encode()
            name = hashlib.sha256(raw).hexdigest() + ".json"
            members[name] = raw
            layer = role + "/layer.tar"
            members[layer] = b"synthetic layer bytes for identity controls only"
            entries.append({"Config": name, "Layers": [layer], "RepoTags": [
                f"chat-reader-{part}:{SOURCE}" for part in (("api", "import-worker", "migrate") if role == "api" else ("web",))
            ]})
        members["manifest.json"] = json.dumps(entries).encode()
        if mutation:
            mutation(members, entries)
            members["manifest.json"] = json.dumps(entries).encode()
        target = root / "images.tar.gz"
        with tarfile.open(target, "w:gz") as archive:
            for name, raw in members.items():
                item = tarfile.TarInfo(name)
                item.size = len(raw)
                archive.addfile(item, io.BytesIO(raw))
        return target

    def test_classic_engine_identity_is_config_digest_not_an_unverified_label(self):
        result = identities(self.fixture(), SOURCE)
        self.assertEqual(set(result), set(gate.ROLES))
        for role, value in result.items():
            self.assertEqual(value["accepted_engine_ids"], [value["config_id"]])
            self.assertEqual(value["platform"], "linux/amd64")

    def test_bad_tag_duplicate_missing_config_layer_or_escaping_member_rejected(self):
        for mutation in (
            lambda m, e: e[0]["RepoTags"].append(e[0]["RepoTags"][0]),
            lambda m, e: e[1]["RepoTags"].__setitem__(0, "chat-reader-web:" + "a" * 40),
            lambda m, e: m.pop(e[0]["Config"]),
            lambda m, e: m.pop(e[0]["Layers"][0]),
            lambda m, e: m.update({"../escaped": b"not allowed"}),
            lambda m, e: m.update({"blobs/sha256/" + "a" * 64: b"wrong hash"}),
        ):
            with self.assertRaises((AssertionError, KeyError)):
                identities(self.fixture(mutation), SOURCE)


if __name__ == "__main__":
    unittest.main()
