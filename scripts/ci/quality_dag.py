"""Fail-closed release scheduling edges, independent of job success prose."""
from required_web_gates import one_step

FULL = "${{ inputs.quality_source_run_id == '' }}"


def validate_dag(main):
    jobs = main["jobs"]
    families = (("api", 4, "api-quality-shard.yml"), ("web", 3, "web-quality.yml"),
                ("settings", 4, "settings-browser-shard.yml"))
    expected = {"settings-restore", "reading-performance-comparison", "image-preparation",
                "build-images", "inspect-release-artifact"}
    for family, count, filename in families:
        dependencies = []
        for index in range(1, count + 1):
            name = f"{family}-quality-shard-{index}"
            expected.add(name)
            dependencies.append(name)
            assert jobs[name] == {"if": FULL, "uses": f"./.github/workflows/{filename}",
                                  "with": {"shard": index}}, "Wrong or bypassed physical shard"
        if family == "settings":
            dependencies.append("settings-restore")
        expected.add(f"{family}-quality")
        aggregate = jobs[f"{family}-quality"]
        assert aggregate["needs"] == dependencies
        assert aggregate["if"] == (
            "${{ !cancelled() && inputs.quality_source_run_id == '' && "
            + " && ".join(f"needs.{name}.result == 'success'" for name in dependencies) + " }}"
        )
        assert "continue-on-error" not in aggregate
        required = {
            "api": ["Require full original collection and native per-case execution"],
            "web": ["Require the complete original Web gate union"],
            "settings": ["Collect original Settings selection and merge genuine Playwright blobs",
                         "Verify independent restore and complete Settings summary"],
        }[family]
        for name in required:
            step = one_step(aggregate["steps"], name)
            assert "if" not in step and "continue-on-error" not in step
            assert "|| true" not in step["run"] and "exit 0" not in step["run"]
    assert set(jobs) == expected and len(expected) == 19
    for name in ("image-preparation", "settings-restore", "reading-performance-comparison"):
        assert jobs[name]["if"] == FULL and "needs" not in jobs[name] and "continue-on-error" not in jobs[name]
    dependencies = ["api-quality", "web-quality", "settings-quality", "reading-performance-comparison", "image-preparation"]
    publisher = jobs["build-images"]
    assert publisher["needs"] == dependencies
    assert publisher["if"] == (
        "${{ !cancelled() && ((inputs.quality_source_run_id == '' && "
        + " && ".join(f"needs.{name}.result == 'success'" for name in dependencies)
        + ") || (inputs.quality_source_run_id != '' && "
        + " && ".join(f"needs.{name}.result == 'skipped'" for name in dependencies) + ")) }}"
    )
    assert "continue-on-error" not in publisher
    prepare = jobs["image-preparation"]
    upload = one_step(prepare["steps"], "Upload non-deployable image candidate only")
    assert "if" not in upload and "continue-on-error" not in upload
    assert upload["with"]["name"] == "non-deployable-image-candidate-${{ github.sha }}-${{ github.run_attempt }}"
    assert "release-manifest.json" not in upload["with"]["path"]
    promote = one_step(publisher["steps"], "Promote exact prepared candidate after every quality gate")
    assert promote["if"] == FULL and "continue-on-error" not in promote
    assert promote["env"]["CANDIDATE_ARTIFACT_ID"] == "${{ needs.image-preparation.outputs.artifact_id }}"
    assert promote["env"]["CANDIDATE_ARTIFACT_DIGEST"] == "${{ needs.image-preparation.outputs.artifact_digest }}"
    assert "|| true" not in promote["run"]
    for step in publisher["steps"]:
        if "docker build " in step.get("run", ""):
            assert step["if"] == "${{ inputs.quality_source_run_id != '' }}"
    inspector = jobs["inspect-release-artifact"]
    assert inspector["needs"] == "build-images" and inspector["if"] == "${{ needs.build-images.result == 'success' }}"
    assert "continue-on-error" not in inspector
    check = one_step(inspector["steps"], "Verify promoted candidate and resource identity independently")
    assert check["if"] == FULL and "continue-on-error" not in check
    assert check["run"] == "python3 ../scripts/ci/image_candidate.py consume"
