"""Bind Docker engine IDs separately from actual config IDs in saved OCI images."""
import hashlib
import json
from pathlib import PurePosixPath
import re
import tarfile


def identities(path, source):
    documents, files, names = {}, {}, set()
    with tarfile.open(path, "r|gz") as archive:
        for member in archive:
            name = member.name.removeprefix("./")
            assert not PurePosixPath(name).is_absolute() and ".." not in PurePosixPath(name).parts
            assert name not in names and (member.isdir() or member.isfile())
            names.add(name)
            if member.isdir():
                continue
            digest, data = hashlib.sha256(), bytearray()
            stream = archive.extractfile(member)
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
                if member.size <= 2 * 1024**2:
                    data.extend(block)
            files[name] = {"sha256": digest.hexdigest(), "bytes": member.size}
            if name.startswith("blobs/sha256/"):
                assert name == "blobs/sha256/" + digest.hexdigest()
            if data:
                try:
                    documents[name] = json.loads(data)
                except (ValueError, UnicodeError):
                    pass
    entries = documents["manifest.json"]
    assert isinstance(entries, list) and entries
    result = {}
    expected_tags = {f"chat-reader-{role}:{source}": role for role in ("api", "import-worker", "migrate", "web")}
    oci = "index.json" in documents
    if oci:
        assert documents["oci-layout"] == {"imageLayoutVersion": "1.0.0"}
        root = documents["index.json"]
        assert root["schemaVersion"] == 2
        descriptors = root["manifests"]
        assert len(descriptors) == 4
        assert {item["annotations"]["io.containerd.image.name"] for item in descriptors} == {
            "docker.io/library/" + tag for tag in expected_tags}

    def descriptor(value):
        assert re.fullmatch(r"sha256:[a-f0-9]{64}", value["digest"])
        name = "blobs/sha256/" + value["digest"].split(":")[1]
        assert files[name] == {"sha256": value["digest"].split(":")[1], "bytes": value["size"]}
        return name

    for entry in entries:
        config = documents[entry["Config"]]
        config_id = "sha256:" + files[entry["Config"]]["sha256"]
        assert config["architecture"] == "amd64" and config["os"] == "linux"
        assert config["config"]["Labels"]["org.opencontainers.image.revision"] == source
        layers = config["rootfs"]["diff_ids"]
        assert config["rootfs"]["type"] == "layers" and len(layers) == len(entry["Layers"]) > 0
        assert all(re.fullmatch(r"sha256:[a-f0-9]{64}", item) for item in layers)
        assert all(name in files for name in entry["Layers"])
        for tag in entry["RepoTags"]:
            assert tag in expected_tags and expected_tags[tag] not in result
            engine_ids = [config_id]
            if oci:
                roots = [item for item in descriptors if item["annotations"]["io.containerd.image.name"] == "docker.io/library/" + tag]
                assert len(roots) == 1
                index = documents[descriptor(roots[0])]
                assert index["schemaVersion"] == 2
                platforms = [item for item in index["manifests"] if item.get("platform") == {"os": "linux", "architecture": "amd64"}]
                assert len(platforms) == 1
                image = documents[descriptor(platforms[0])]
                assert image["schemaVersion"] == 2 and descriptor(image["config"]) == entry["Config"]
                assert image["config"]["digest"] == config_id
                assert [descriptor(layer) for layer in image["layers"]] == entry["Layers"]
                for extra in index["manifests"]:
                    descriptor(extra)
                engine_ids.append(roots[0]["digest"])
            result[expected_tags[tag]] = {
                "config_id": config_id, "platform": "linux/amd64", "rootfs": layers,
                "accepted_engine_ids": sorted(set(engine_ids)),
            }
    assert set(result) == set(expected_tags.values())
    assert result["api"]["config_id"] == result["import-worker"]["config_id"] == result["migrate"]["config_id"]
    return result
