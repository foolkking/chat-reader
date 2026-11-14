"""Offline fault controls; they do not establish CI-token or network acceptance."""
from __future__ import annotations

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

from test_image_only_quality_reuse import browser_summary, source_fixture, zip_fixture


spec = importlib.util.spec_from_file_location(
    "image_only_evidence_transport_gate",
    Path(__file__).with_name("image-only-quality-reuse.py"),
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class Clock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def response(code=0, stdout=b'{"verified": true}', stderr=b""):
    return subprocess.CompletedProcess([], code, stdout=stdout, stderr=stderr)


def http_error(status, *, stdout=b"", extra=b""):
    return response(1, stdout, b"gh: synthetic failure (HTTP "
                    + str(status).encode("ascii") + b") " + extra)


class EvidenceGetTransportTests(unittest.TestCase):
    def setUp(self):
        root = os.environ.get("RUNNER_TEMP") or os.environ.get("TEMP")
        self.assertTrue(root and Path(root).is_dir(), "Set an explicit task/runner TEMP.")
        self.root = Path(root).resolve()
        self.directory = tempfile.TemporaryDirectory(prefix="evidence-get-", dir=self.root)
        self.cache = Path(self.directory.name)
        self.clock = Clock()
        for name in ("monotonic", "sleep"):
            control = patch.object(time, name, getattr(self.clock, name))
            control.start()
            self.addCleanup(control.stop)
        self.stdout = io.StringIO()
        self.stderr = io.StringIO()

    def tearDown(self):
        # Check the actual recursive-cleanup target and all link boundaries first.
        self.assertEqual(self.cache.resolve(), self.cache)
        self.assertEqual(self.cache.parent, self.root)
        self.assertFalse(self.cache.is_symlink())
        for path in self.cache.rglob("*"):
            self.assertEqual(path.resolve(), path)
            self.assertFalse(path.is_symlink())
        self.directory.cleanup()

    def fetch(self, results, *, binary=False, name="source-api-quality.log"):
        with patch.object(gate.subprocess, "run", side_effect=results) as command:
            with redirect_stdout(self.stdout), redirect_stderr(self.stderr):
                value = gate.api("actions/jobs/123/logs", cache=self.cache,
                                 name=name, binary=binary)
        return value, command

    def reject(self, results, *, error=gate.GateError, name="source-api-quality.log"):
        with patch.object(gate.subprocess, "run", side_effect=results) as command:
            with redirect_stdout(self.stdout), redirect_stderr(self.stderr):
                with self.assertRaises(error) as failure:
                    gate.api("actions/jobs/123/logs", cache=self.cache, name=name, binary=True)
        return failure.exception, command

    def test_successful_json_keeps_original_bytes_and_one_get(self):
        data = b' { "verified" : true }\n'
        value, command = self.fetch([response(stdout=data)])
        self.assertEqual(value, {"verified": True})
        self.assertEqual((self.cache / "source-api-quality.log").read_bytes(), data)
        self.assertEqual(command.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])

    def test_successful_binary_is_not_decoded_or_replaced(self):
        data = b"\x00\xfforiginal binary evidence\r\n"
        value, command = self.fetch([response(stdout=data)], binary=True)
        self.assertEqual(value, data)
        self.assertEqual((self.cache / "source-api-quality.log").read_bytes(), data)
        self.assertEqual(command.call_count, 1)

    def test_transient_http_failure_repeats_the_same_get_then_keeps_exact_log(self):
        data = b"exact official API evidence\r\n"
        value, command = self.fetch([http_error(502), response(stdout=data)], binary=True)
        self.assertEqual(value, data)
        self.assertEqual(command.call_count, 2)
        self.assertEqual(self.clock.sleeps, [1])
        self.assertEqual(command.call_args_list[0].args, command.call_args_list[1].args)
        self.assertIn("http-502", self.stdout.getvalue())

    def test_only_known_transient_http_statuses_are_retried(self):
        for status in (408, 429, 500, 502, 503, 504):
            with self.subTest(status=status):
                value, command = self.fetch([http_error(status), response()])
                self.assertEqual(value, {"verified": True})
                self.assertEqual(command.call_count, 2)

    def test_two_transient_errors_have_only_two_bounded_backoffs(self):
        value, command = self.fetch([http_error(503), http_error(429), response()])
        self.assertEqual(value, {"verified": True})
        self.assertEqual(command.call_count, 3)
        self.assertEqual(self.clock.sleeps, [1, 2])

    def test_exhaustion_is_three_attempts_not_unbounded_retries(self):
        error, command = self.reject([http_error(502)] * 3)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(self.clock.sleeps, [1, 2])
        self.assertIn("http-502", str(error))
        self.assertIn("attempts=3", str(error))
        self.assertFalse((self.cache / "source-api-quality.log").exists())

    def test_auth_missing_expired_and_other_http_errors_fail_on_first_get(self):
        for status in (400, 401, 403, 404, 409, 410, 422, 451, 501):
            with self.subTest(status=status):
                error, command = self.reject([http_error(status)])
                self.assertEqual(command.call_count, 1)
                self.assertIn("http-" + str(status), str(error))
        self.assertEqual(self.clock.sleeps, [])

    def test_permission_error_is_not_retried_despite_transient_words(self):
        error, command = self.reject([http_error(403, extra=b"connection reset by peer")])
        self.assertEqual(command.call_count, 1)
        self.assertIn("http-403", str(error))
        self.assertEqual(self.clock.sleeps, [])

    def test_conflicting_http_statuses_are_not_guessed_or_retried(self):
        error, command = self.reject([
            response(1, stderr=b"gh: (HTTP 502) proxy: (HTTP 403)"),
        ])
        self.assertEqual(command.call_count, 1)
        self.assertIn("ambiguous-http-status", str(error))

    def test_known_connection_reset_eof_and_transport_timeouts_can_recover(self):
        for text in (
            b"read tcp: connection reset by peer", b"net/http: TLS handshake timeout",
            b"read tcp: i/o timeout", b"unexpected EOF", b"context deadline exceeded",
        ):
            with self.subTest(transport=text):
                value, command = self.fetch([response(1, stderr=text), response()])
                self.assertEqual(value, {"verified": True})
                self.assertEqual(command.call_count, 2)

    def test_certificate_and_unknown_errors_are_not_treated_as_network_recovery(self):
        for text in (
            b"x509: certificate signed by unknown authority",
            b"certificate has expired", b"missing credential", b"unknown CLI failure", b"",
        ):
            with self.subTest(error=text):
                error, command = self.reject([response(1, stderr=text)])
                self.assertEqual(command.call_count, 1)
                self.assertIn("unclassified", str(error))
        self.assertEqual(self.clock.sleeps, [])

    def test_failed_partial_response_is_never_persisted_as_evidence(self):
        error, command = self.reject([
            http_error(502, stdout=b"partial synthetic response") for _ in range(3)
        ])
        self.assertEqual(command.call_count, 3)
        self.assertFalse((self.cache / "source-api-quality.log").exists())
        self.assertNotIn("partial synthetic", str(error) + self.stdout.getvalue())

    def test_existing_cached_log_cannot_substitute_for_a_failed_fresh_get(self):
        path = self.cache / "source-api-quality.log"
        path.write_bytes(b"stale diagnostic evidence")
        error, command = self.reject([http_error(404)])
        self.assertEqual(command.call_count, 1)
        self.assertEqual(path.read_bytes(), b"stale diagnostic evidence")
        self.assertIn("http-404", str(error))

    def test_success_after_retry_replaces_cache_only_with_fresh_verified_input(self):
        path = self.cache / "source-api-quality.log"
        path.write_bytes(b"stale diagnostic evidence")
        data = b"fresh downloaded input, still subject to source validators"
        value, command = self.fetch([http_error(503), response(stdout=data)], binary=True)
        self.assertEqual(value, data)
        self.assertEqual(path.read_bytes(), data)
        self.assertEqual(command.call_count, 2)

    def test_safe_retry_and_final_errors_do_not_emit_body_token_cookie_or_signed_url(self):
        secret = b"synthetic-token synthetic-cookie https://example.test/?sig=synthetic-secret"
        error, command = self.reject([http_error(502, stdout=secret, extra=secret)] * 3)
        exposed = str(error) + self.stdout.getvalue() + self.stderr.getvalue()
        for marker in ("synthetic-token", "synthetic-cookie", "synthetic-secret", "example.test"):
            self.assertNotIn(marker, exposed)
        self.assertIn("http-502", exposed)
        self.assertEqual(command.call_count, 3)
        self.assertEqual(list(self.cache.iterdir()), [])

    def test_unknown_error_is_sanitized_without_dumping_subprocess_environment(self):
        secret = b"synthetic-credential-value"
        error, command = self.reject([response(1, stdout=secret, stderr=secret)])
        self.assertEqual(command.call_count, 1)
        self.assertNotIn("synthetic-credential", str(error) + self.stdout.getvalue())

    def test_subprocess_timeout_is_safe_and_does_not_extend_the_original_budget(self):
        timeout = subprocess.TimeoutExpired(["gh", "synthetic-secret"], 180,
                                            output=b"synthetic-token", stderr=b"synthetic-cookie")
        error, command = self.reject([timeout])
        self.assertEqual(command.call_count, 1)
        self.assertIn("deadline", str(error))
        for marker in ("synthetic-secret", "synthetic-token", "synthetic-cookie"):
            self.assertNotIn(marker, str(error) + self.stdout.getvalue())
        self.assertEqual(self.clock.sleeps, [])

    def test_retry_timeouts_share_one_original_180_second_deadline(self):
        def run(command, **kwargs):
            self.clock.now += 50
            return http_error(502) if self.clock.now < 120 else response()
        value, command = self.fetch(run)
        self.assertEqual(value, {"verified": True})
        self.assertEqual([call.kwargs["timeout"] for call in command.call_args_list],
                         [180, 129, 77])
        self.assertLessEqual(self.clock.now, 180)

    def test_backoff_is_not_started_when_it_would_consume_remaining_deadline(self):
        def run(command, **kwargs):
            self.clock.now = 179.5
            return http_error(503)
        error, command = self.reject(run)
        self.assertEqual(command.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])
        self.assertIn("deadline", str(error))

    def test_oversleep_cannot_start_another_request_after_the_deadline(self):
        def oversleep(seconds):
            self.clock.sleeps.append(seconds)
            self.clock.now = 181
        with patch.object(time, "sleep", side_effect=oversleep):
            error, command = self.reject([http_error(502)])
        self.assertEqual(command.call_count, 1)
        self.assertIn("deadline", str(error))

    def test_late_success_cannot_bypass_the_180_second_network_deadline(self):
        def run(command, **kwargs):
            self.clock.now = 181
            return response()
        error, command = self.reject(run)
        self.assertEqual(command.call_count, 1)
        self.assertIn("deadline", str(error))
        self.assertFalse((self.cache / "source-api-quality.log").exists())

    def test_every_attempt_is_the_exact_read_only_endpoint_without_method_or_source_fallback(self):
        value, command = self.fetch([http_error(502), http_error(503), response()])
        self.assertEqual(value, {"verified": True})
        for call in command.call_args_list:
            self.assertEqual(call.args[0], [
                "gh", "api", "repos/foolkking/chat-reader/actions/jobs/123/logs",
            ])
            self.assertEqual(call.kwargs["cwd"], gate.REPO)
            self.assertTrue(call.kwargs["capture_output"])
            self.assertLessEqual(call.kwargs["timeout"], 180)

    def test_successful_but_invalid_json_is_not_retried_as_a_transport_error(self):
        with patch.object(gate.subprocess, "run", return_value=response(stdout=b"not JSON")) as command:
            with self.assertRaises(json.JSONDecodeError):
                gate.api("actions/runs/1", cache=self.cache, name="invalid.json")
        self.assertEqual(command.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])

    def test_successful_but_corrupt_zip_still_fails_original_content_validation(self):
        data = b"not a ZIP"
        value, command = self.fetch([response(stdout=data)], binary=True)
        specification = {"kind": "settings", "size_in_bytes": len(data),
                         "digest": "sha256:" + gate.digest(data)}
        with self.assertRaises(zipfile.BadZipFile):
            gate.validate_quality_zip(value, specification)
        self.assertEqual(command.call_count, 1)
        self.assertEqual(self.clock.sleeps, [])

    def source_proof_fixture(self):
        run, jobs = source_fixture()
        packages = [
            zip_fixture("web", browser_summary("web")),
            zip_fixture("settings", browser_summary("settings")),
            zip_fixture("reading", {
                "schema_version": 2, "gate_id": "reader-capacity-candidate",
                "status": "passed", "test_count": 9, "result_counts": {
                    "passed": 9, "failed": 0, "timedOut": 0, "skipped": 0, "interrupted": 0,
                },
            }),
        ]
        specifications = [{**item, "id": index + 100} for index, (_, item) in enumerate(packages)]
        metadata = [{**item, "expired": False, "workflow_run": {
            "id": int(gate.BASE_RUN), "head_sha": gate.BASE_SHA,
        }} for item in specifications]
        log = (
            "6751 passed, 3 skipped, 5 warnings in 2176.23s\n"
            + "".join(f"tests/test_worker_supervisor.py::synthetic_case_{index} PASSED\n"
                      for index in range(17))
            + "".join(
                "tests/test_supervised_execution_postgres.py::"
                f"test_actual_supervisor_process_drains_two_jobs_without_overlapping[{poll}] PASSED\n"
                for poll in (1, 20)
            )
        ).encode()
        responses = {
            f"actions/runs/{gate.BASE_RUN}": json.dumps(run).encode(),
            f"actions/runs/{gate.BASE_RUN}/attempts/1/jobs?per_page=100": json.dumps(jobs).encode(),
            f"actions/runs/{gate.BASE_RUN}/artifacts?per_page=100":
                json.dumps({"total_count": len(metadata), "artifacts": metadata}).encode(),
            **{f"actions/artifacts/{item['id']}/zip": data
               for item, (data, _) in zip(specifications, packages)},
            "actions/jobs/1/logs": log,
        }
        return specifications, responses, log

    def test_actual_source_validators_still_run_after_api_log_transport_recovers(self):
        specifications, responses, log = self.source_proof_fixture()
        endpoints = []
        def run(command, **kwargs):
            endpoint = command[2].removeprefix("repos/foolkking/chat-reader/")
            endpoints.append(endpoint)
            if endpoint == "actions/jobs/1/logs" and endpoints.count(endpoint) == 1:
                return http_error(503, stdout=b"partial synthetic log")
            return response(stdout=responses[endpoint])
        with patch.object(gate, "ARTIFACTS", specifications), \
                patch.object(gate.subprocess, "run", side_effect=run), redirect_stdout(self.stdout):
            proof = gate.source_proof(gate.BASE_RUN, gate.BASE_SHA, 1,
                                      reuse=True, cache=self.cache)
        self.assertEqual(len(proof["quality_jobs"]), 4)
        self.assertEqual(len(proof["verified_evidence"]), 4)
        api_evidence = proof["verified_evidence"][-1]
        self.assertEqual(api_evidence["sha256"], gate.digest(log))
        self.assertEqual(api_evidence["passed"], 6751)
        self.assertEqual(api_evidence["supervisor_unit_cases_passed"], 17)
        self.assertEqual(api_evidence["real_pg_poll_cases_passed"], [1, 20])
        self.assertEqual((self.cache / "source-api-quality.log").read_bytes(), log)
        self.assertEqual(endpoints.count("actions/jobs/1/logs"), 2)
        self.assertEqual(self.clock.sleeps, [1])

    def test_source_proof_cannot_complete_without_a_fresh_api_log(self):
        specifications, responses, _ = self.source_proof_fixture()
        def run(command, **kwargs):
            endpoint = command[2].removeprefix("repos/foolkking/chat-reader/")
            return http_error(403) if endpoint == "actions/jobs/1/logs" \
                else response(stdout=responses[endpoint])
        with patch.object(gate, "ARTIFACTS", specifications), \
                patch.object(gate.subprocess, "run", side_effect=run) as command:
            with self.assertRaisesRegex(gate.GateError, "http-403"):
                gate.source_proof(gate.BASE_RUN, gate.BASE_SHA, 1,
                                  reuse=True, cache=self.cache)
        self.assertEqual(command.call_count, 7)
        self.assertFalse((self.cache / "source-api-quality.log").exists())
        self.assertEqual(self.clock.sleeps, [])

    def full_source_fixture(self):
        run, jobs = source_fixture()
        run.update(id=9001, head_sha="b" * 40, status="in_progress", conclusion=None)
        for job in jobs["jobs"]:
            job.update(run_id=9001, head_sha="b" * 40)
        jobs["jobs"][4].update(status="in_progress", conclusion=None)
        responses = {
            "actions/runs/9001": json.dumps(run).encode(),
            "actions/runs/9001/attempts/1/jobs?per_page=100": json.dumps(jobs).encode(),
        }
        return run, jobs, responses

    def test_full_mode_reads_only_the_new_run_and_its_fresh_successful_quality_jobs(self):
        _, _, responses = self.full_source_fixture()
        endpoints = []
        def run(command, **kwargs):
            endpoint = command[2].removeprefix("repos/foolkking/chat-reader/")
            endpoints.append(endpoint)
            return response(stdout=responses[endpoint])
        with patch.object(gate.subprocess, "run", side_effect=run):
            proof = gate.source_proof("9001", "b" * 40, 1, reuse=False, cache=self.cache)
        self.assertEqual(endpoints, list(responses))
        self.assertEqual(proof["workflow_run_id"], "9001")
        self.assertEqual(proof["sha"], "b" * 40)
        self.assertEqual(len(proof["quality_jobs"]), 4)
        self.assertEqual(proof["verified_evidence"], [])
        self.assertFalse(any("artifact" in endpoint or "logs" in endpoint
                             or gate.BASE_RUN in endpoint for endpoint in endpoints))

    def test_full_mode_never_falls_back_to_old_quality_when_a_fresh_job_did_not_pass(self):
        for conclusion in ("failure", "skipped", "cancelled", None):
            _, jobs, responses = self.full_source_fixture()
            jobs["jobs"][0]["conclusion"] = conclusion
            responses["actions/runs/9001/attempts/1/jobs?per_page=100"] = json.dumps(jobs).encode()
            def run(command, **kwargs):
                endpoint = command[2].removeprefix("repos/foolkking/chat-reader/")
                return response(stdout=responses[endpoint])
            with self.subTest(conclusion=conclusion), \
                    patch.object(gate.subprocess, "run", side_effect=run) as command:
                with self.assertRaisesRegex(gate.GateError, "Required source quality job"):
                    gate.source_proof("9001", "b" * 40, 1, reuse=False, cache=self.cache)
                self.assertEqual(command.call_count, 2)
        self.assertEqual(self.clock.sleeps, [])

    def test_empty_input_producer_and_independent_consumer_cli_use_full_exact_mode(self):
        _, _, responses = self.full_source_fixture()
        endpoints = []
        def run(command, **kwargs):
            endpoint = command[2].removeprefix("repos/foolkking/chat-reader/")
            endpoints.append(endpoint)
            return response(stdout=responses[endpoint])
        producer = self.cache / "producer-proof.json"
        manifest_path = self.cache / "release-manifest.json"
        consumer = self.cache / "consumer-proof.json"
        environment = {
            "CI": "true", "GITHUB_REPOSITORY": gate.REPOSITORY,
            "GITHUB_SHA": "b" * 40, "GITHUB_RUN_ID": "9001", "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_REF": "refs/heads/master", "RUNNER_TEMP": str(self.cache),
            "TEMP": str(self.cache), "TMP": str(self.cache),
            "QUALITY_JOB_RESULTS": json.dumps({
                name: {"result": "success"} for name in gate.NEEDS_NAMES
            }),
        }
        with patch.dict(os.environ, environment, clear=True), \
                patch.object(gate, "validate_checkout") as checkout, \
                patch.object(gate, "git_equivalence", side_effect=AssertionError(
                    "Full mode must not expand or reuse the old source lineage"
                )), patch.object(gate.subprocess, "run", side_effect=run), \
                redirect_stdout(self.stdout):
            with patch.object(sys, "argv", [
                "image-only-quality-reuse.py", "--head", "b" * 40, "--output", str(producer),
            ]):
                gate.main()
            report = json.loads(producer.read_bytes())
            verification = report["verification"]
            self.assertEqual(verification["mode"], "full-exact")
            self.assertEqual(verification["source"]["workflow_run_id"], "9001")
            self.assertIsNone(verification["source_equivalence"])
            self.assertFalse(verification["old_images_or_memory_results_reused"])
            manifest = {
                "schema_version": 2, "commit": "b" * 40, "workflow_run_id": "9001",
                "workflow_run_attempt": "1", "archive": "chat-reader-images.tar.gz",
                "quality_verification": report,
            }
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            with patch.object(sys, "argv", [
                "image-only-quality-reuse.py", "--head", "b" * 40,
                "--producer-attempt", "1", "--verify-report", str(producer),
                "--manifest", str(manifest_path), "--output", str(consumer),
            ]):
                gate.main()
        self.assertEqual(checkout.call_count, 2)
        self.assertEqual(json.loads(consumer.read_bytes())["verification"], verification)
        self.assertEqual(endpoints, list(responses) * 2)


if __name__ == "__main__":
    unittest.main()
