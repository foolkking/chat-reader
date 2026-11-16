"""Semantic companion to the retained mounted-gate source assertions."""


def one_step(steps, name):
    matches = [step for step in steps if step.get("name") == name]
    assert len(matches) == 1, "Exactly one required step: " + name
    return matches[0]


def validate_required_web_gate(main, web, contract, name):
    assignment = contract["web_assignment"]
    shard = assignment[name]
    count = len(contract["web_gate_groups"])
    assert type(shard) is int and 1 <= shard <= count
    assert set(web["jobs"]) == {"gates"}
    runner = web["jobs"]["gates"]
    assert runner["runs-on"] == "ubuntu-latest"
    assert "if" not in runner and "continue-on-error" not in runner
    original = one_step(contract["web_steps"], name)
    step = one_step(runner["steps"], name)
    assert step == {**original, "if": "${{ inputs.shard == " + str(shard) + " }}"}
    upload = one_step(runner["steps"], "Upload non-deployable quality evidence")
    assert upload["if"] == "always()"
    assert upload["with"]["path"] == contract["web_original_artifact_paths"]
    assert "continue-on-error" not in upload
    dependencies = [f"web-quality-shard-{index}" for index in range(1, count + 1)]
    for index, dependency in enumerate(dependencies, 1):
        assert main["jobs"][dependency] == {
            "if": "${{ inputs.quality_source_run_id == '' }}",
            "uses": "./.github/workflows/web-quality.yml",
            "with": {"shard": index},
        }
    aggregate = main["jobs"]["web-quality"]
    assert aggregate["needs"] == dependencies
    assert aggregate["if"] == (
        "${{ !cancelled() && inputs.quality_source_run_id == '' && "
        + " && ".join(f"needs.{dependency}.result == 'success'" for dependency in dependencies)
        + " }}"
    )
    assert "continue-on-error" not in aggregate
    publisher = main["jobs"]["build-images"]
    assert "web-quality" in publisher["needs"]
    assert "needs.web-quality.result == 'success'" in publisher["if"]
    assert "continue-on-error" not in publisher
