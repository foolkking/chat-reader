"""Non-deployable preparation and exact-artifact promotion, never a second build."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import zipfile

from quality_schedule import SCHEDULE_SHA256, load_schedule
from image_archive_identity import identities as archive_identities

REPOSITORY = "foolkking/chat-reader"
ROLES = ("api", "import-worker", "migrate", "web")
FILES = ("chat-reader-images.tar.gz", "image-inspection.json", "small-zip-memory.json",
         "bounded-zip-memory.json", "deploy/nginx-internal-diagnostics.location.conf")


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf8") as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def read(path):
    path = Path(path)
    assert path.is_file() and not path.is_symlink() and path.stat().st_size < 32 * 1024 * 1024
    return json.loads(path.read_text("utf8"))


def command(*args):
    result = subprocess.run(args, capture_output=True, check=False)
    assert result.returncode == 0, "Candidate control command failed: " + args[0]
    return result.stdout


def context():
    assert os.environ.get("CI") == "true" and os.environ.get("GITHUB_REPOSITORY") == REPOSITORY
    source, run, attempt = (os.environ[name] for name in ("GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"))
    assert re.fullmatch("[a-f0-9]{40}", source)
    assert re.fullmatch("[1-9][0-9]*", run) and re.fullmatch("[1-9][0-9]*", attempt)
    load_schedule()
    return source, run, attempt


def image_identity(source, archived):
    result = {}
    for role in ROLES:
        images = json.loads(command("docker", "image", "inspect", f"chat-reader-{role}:{source}"))
        assert len(images) == 1
        image = images[0]
        assert re.fullmatch(r"sha256:[a-f0-9]{64}", image["Id"])
        assert image["Config"]["Labels"]["org.opencontainers.image.revision"] == source
        assert (image["Os"], image["Architecture"]) == ("linux", "amd64")
        identity = archived[role]
        assert image["Id"] in identity["accepted_engine_ids"]
        assert image["RootFS"]["Layers"] == identity["rootfs"]
        result[role] = {**identity, "engine_id": image["Id"]}
    assert result["api"] == result["import-worker"] == result["migrate"]
    return result


def validate_memory(original, bounded, images, source, run, attempt):
    assert bounded["revision"] == source and bounded["passed"] is True and bounded["real_sensor"] is True
    cases = bounded["cases"]
    assert len(cases) == 4 and sorted(case["case"] for case in cases) == ["assets100", "assets500", "long", "small"]
    for report in [original, *cases]:
        case = report.get("case")
        assert case in (None, "small", "assets100", "assets500", "long")
        assert report["revision"] == source and report["passed"] is True and report["real_sensor"] is True
        assert (report["run_id"], report["run_attempt"], report["image_engine_id"]) == (
            run, attempt, images["api"]["engine_id"]), "Resource gate tested a different image/attempt"
        assert report["worker_image_id"] in images["api"]["accepted_engine_ids"], "Measured worker uses a different config graph"
        limit = (640 if case == "assets500" else 320) * 1024**2
        assert report["memory_limit_bytes"] == report["memory_swap_limit_bytes"] == limit
        assert 0 <= report["workspace_peak_delta_bytes"] <= 64 * 1024**2
        assert all(report[name] == 0 for name in ("oom", "oom_kill", "failcnt_delta", "restarts"))
        assert report["conversation_count"] == 1
        assert report["attachment_count"] == report["verified_asset_hashes"]
        if case is not None:
            assert report["draft_format"] == 2
        if case in (None, "small"):
            assert (report["message_count"], report["attachment_count"], report["reference_count"]) == (4, 14, 13)
        else:
            assert report["message_count"] == 36 and report["block_count"] >= 6000
        if case == "assets100":
            assert 102760448 <= report["archive_bytes"] <= 104857600
        if case == "assets500":
            assert 522190848 <= report["archive_bytes"] <= 524288000
        if case in ("assets100", "assets500"):
            assert report["attachment_count"] == report["reference_count"] == 4
        if case == "long":
            assert report["archive_bytes"] > 1048576 and report["attachment_count"] == 0


def validate_candidate(candidate, root, source, run, attempt, actual=None):
    assert candidate["schema_version"] == 1 and candidate["purpose"] == "non-deployable-image-candidate"
    assert candidate["deployable"] is False and candidate["producer_job"] == "image-preparation"
    assert (candidate["source_sha"], candidate["run_id"], candidate["run_attempt"]) == (source, run, attempt)
    assert candidate["schedule_sha256"] == SCHEDULE_SHA256
    assert set(candidate["files"]) == set(FILES)
    for name, expected in candidate["files"].items():
        file = root / name
        assert file.is_file() and not file.is_symlink()
        assert expected == {"sha256": sha(file), "bytes": file.stat().st_size}, "Candidate bytes changed"
    images = candidate["images"]
    assert set(images) == set(ROLES)
    for item in images.values():
        assert re.fullmatch(r"sha256:[a-f0-9]{64}", item["config_id"]) and item["platform"] == "linux/amd64"
        assert item["rootfs"] and all(re.fullmatch(r"sha256:[a-f0-9]{64}", value) for value in item["rootfs"])
        assert item["engine_id"] in item["accepted_engine_ids"] and item["config_id"] in item["accepted_engine_ids"]
    assert images["api"] == images["import-worker"] == images["migrate"]
    if actual is not None:
        for role in ROLES:
            assert actual[role]["engine_id"] in images[role]["accepted_engine_ids"]
            assert {k: v for k, v in images[role].items() if k != "engine_id"} == {
                k: v for k, v in actual[role].items() if k != "engine_id"
            }, "Labels do not substitute for exact config ID / complete RootFS"
    inspection = read(root / "image-inspection.json")
    assert inspection["revision"] == source and inspection["forbidden_paths_present"] is False
    assert len(inspection["images"]) == 4
    assert {item["name"]: item["id"] for item in inspection["images"]} == {
        f"chat-reader-{role}:{source}": images[role]["engine_id"] for role in ROLES}
    validate_memory(read(root / "small-zip-memory.json"), read(root / "bounded-zip-memory.json"),
                    images, source, run, attempt)


def validate_artifact(metadata, artifact_id, digest, source, run, attempt):
    assert re.fullmatch("[1-9][0-9]*", artifact_id) and re.fullmatch(r"sha256:[a-f0-9]{64}", digest)
    assert metadata["id"] == int(artifact_id) and metadata["digest"] == digest and metadata["expired"] is False
    assert metadata["name"] == f"non-deployable-image-candidate-{source}-{attempt}"
    assert metadata["workflow_run"]["id"] == int(run) and metadata["workflow_run"]["head_sha"] == source
    assert 0 < metadata["size_in_bytes"] < 2 * 1024**3


def validate_quality(quality, source, run, attempt):
    proof = quality["verification"]
    assert quality["schema_version"] == 1 and proof["mode"] == "full-exact" and proof["quality_passed"] is True
    assert proof["candidate"] == {"sha": source, "workflow_run_id": run, "workflow_run_attempt": int(attempt)}
    # The provenance verifier has already fetched all official jobs, including every shard.
    assert proof["source"]["sha"] == source and proof["source"]["workflow_run_id"] == run
    import importlib.util
    spec = importlib.util.spec_from_file_location("candidate_quality_policy", Path(__file__).with_name("image-only-quality-reuse.py"))
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    jobs = proof["source"]["quality_jobs"]
    assert len(jobs) == len(policy.FULL_QUALITY_NAMES)
    assert {job["name"] for job in jobs} == set(policy.FULL_QUALITY_NAMES)
    assert all(job["conclusion"] == "success" and job["status"] == "completed"
               and job["source_attempt"] == int(attempt) for job in jobs), "Quality did not pass"


def fetch(root, artifact_id, digest, source, run, attempt):
    # upload-artifact emits bare hex; the official REST metadata prefixes sha256.
    if re.fullmatch(r"[a-f0-9]{64}", digest):
        digest = "sha256:" + digest
    metadata = json.loads(command("gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}"))
    validate_artifact(metadata, artifact_id, digest, source, run, attempt)
    assert not root.exists(), "No candidate overwrite"
    root.mkdir(parents=True)
    archive = root / "transport.zip"
    with archive.open("xb") as stream:
        result = subprocess.run(["gh", "api", f"repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip"],
                                stdout=stream, stderr=subprocess.PIPE)
    assert result.returncode == 0, "Candidate transport failed"
    assert archive.stat().st_size == metadata["size_in_bytes"] and "sha256:" + sha(archive) == digest
    expected = set(FILES) | {"image-candidate.json"}
    with zipfile.ZipFile(archive) as packed:
        entries = [info for info in packed.infolist() if not info.is_dir()]
        assert len(entries) == len(expected) and {info.filename for info in entries} == expected
        assert packed.testzip() is None
        for info in entries:
            assert not stat.S_ISLNK(info.external_attr >> 16)
            assert 0 < info.file_size < 2 * 1024**3
            target = root / info.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with packed.open(info) as source_stream, target.open("xb") as destination:
                shutil.copyfileobj(source_stream, destination, 1024 * 1024)
    return {"id": metadata["id"], "digest": digest, "size_in_bytes": metadata["size_in_bytes"],
            "name": metadata["name"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("preflight", "prepare", "promote", "consume"))
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--quality", type=Path)
    parser.add_argument("--artifact-id")
    parser.add_argument("--artifact-digest")
    args = parser.parse_args()
    source, run, current_attempt = context()
    attempt = os.environ.get("ARTIFACT_PRODUCER_ATTEMPT", current_attempt) if args.mode == "consume" else current_attempt
    assert re.fullmatch("[1-9][0-9]*", attempt) and int(attempt) <= int(current_attempt)
    root = args.root
    if args.mode == "preflight":
        assert command("git", "rev-parse", "HEAD").decode().strip() == source
        assert not command("git", "status", "--porcelain", "--untracked-files=all").strip()
    elif args.mode == "prepare":
        assert not (root / "release-manifest.json").exists(), "Early candidate cannot be deployable"
        candidate = {
            "schema_version": 1, "purpose": "non-deployable-image-candidate", "deployable": False,
            "producer_job": "image-preparation", "source_sha": source, "run_id": run, "run_attempt": attempt,
            "schedule_sha256": SCHEDULE_SHA256, "built_at": os.environ["IMAGE_BUILD_TIME"],
            "images": image_identity(source, archive_identities(root / "chat-reader-images.tar.gz", source)),
            "files": {name: {"sha256": sha(root / name), "bytes": (root / name).stat().st_size} for name in FILES},
        }
        validate_candidate(candidate, root, source, run, attempt)
        write(root / "image-candidate.json", candidate)
    elif args.mode == "promote":
        quality = read(args.quality)
        validate_quality(quality, source, run, attempt)
        metadata = fetch(root, args.artifact_id, args.artifact_digest, source, run, attempt)
        candidate = read(root / "image-candidate.json")
        validate_candidate(candidate, root, source, run, attempt)
        command("docker", "load", "--input", str(root / "chat-reader-images.tar.gz"))
        validate_candidate(candidate, root, source, run, attempt,
                           image_identity(source, archive_identities(root / "chat-reader-images.tar.gz", source)))
        for name in (*FILES, "image-candidate.json"):
            destination = Path(name)
            if name.startswith("deploy/"):
                assert sha(destination) == sha(root / name), "Diagnostics source changed"
            else:
                with (root / name).open("rb") as src, destination.open("xb") as dest:
                    shutil.copyfileobj(src, dest, 1024 * 1024)
        write("quality-verification.json", quality)
        write("release-manifest.json", {
            "schema_version": 2, "commit": source, "workflow_run_id": run,
            "workflow_run_attempt": attempt, "built_at": candidate["built_at"],
            "archive": "chat-reader-images.tar.gz",
            "images": {"api": candidate["images"]["api"]["engine_id"], "web": candidate["images"]["web"]["engine_id"]},
            "quality_verification": quality, "image_candidate": {
                "artifact": metadata, "manifest_sha256": sha(root / "image-candidate.json"),
            },
            "diagnostics_gateway": {"path": "deploy/nginx-internal-diagnostics.location.conf"},
        })
    else:
        manifest = read(root / "release-manifest.json")
        candidate = read(root / "image-candidate.json")
        proof = manifest["image_candidate"]
        artifact = proof["artifact"]
        original_root = Path(os.environ["RUNNER_TEMP"]) / "independent-original-image-candidate"
        original = fetch(original_root, str(artifact["id"]), artifact["digest"], source, run, attempt)
        assert original == artifact
        assert proof["manifest_sha256"] == sha(root / "image-candidate.json")
        assert sha(original_root / "image-candidate.json") == sha(root / "image-candidate.json")
        for name in FILES:
            assert sha(original_root / name) == sha(root / name), "Release differs from original tested candidate artifact"
        validate_candidate(candidate, root, source, run, attempt,
                           image_identity(source, archive_identities(root / "chat-reader-images.tar.gz", source)))
        validate_quality(read(root / "quality-verification.json"), source, run, attempt)
    print("Exact non-deployable candidate identity verified; no rebuild or deployment.")


if __name__ == "__main__":
    main()
