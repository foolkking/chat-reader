"""Run independent real browser samples. Keep every result, including overruns."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    p = argparse.ArgumentParser()
    p.add_argument("directory", type=Path)
    p.add_argument("--count", type=int, choices=(1, 5), default=5)
    a = p.parse_args()
    a.directory.mkdir(exist_ok=False)
    records = []
    for n in range(1, a.count + 1):
        for thermal in ("cold", "warm"):
            for scope in ("web", "api", "api+web"):
                name = f"{n}-{scope}-{thermal}"
                out = a.directory / (name + ".json")
                env = dict(
                    os.environ,
                    UPDATE_LAB_PROGRAM=scope,
                    UPDATE_LAB_CACHE=thermal,
                    UPDATE_LAB_METRICS=str(out),
                )
                with (a.directory / (name + ".log")).open("x") as log:
                    result = subprocess.run(
                        [
                            "node",
                            str(Path(__file__).with_name("update-lab-browser.cjs")),
                        ],
                        env=env,
                        stdout=log,
                        stderr=subprocess.STDOUT,
                    )
                record = dict(
                    sample=n,
                    scope=scope,
                    cache=thermal,
                    exit=result.returncode,
                    at_unix=int(time.time()),
                )
                if result.returncode == 0:
                    x = json.loads(out.read_bytes())
                    assert [j["action"] for j in x] == ["prepare", "apply", "rollback"]
                    record.update(
                        transfer_ms=x[0]["download_ms"],
                        prepare_ms=x[0]["ready_host_ms"],
                        apply=x[1],
                        rollback=x[2],
                    )
                records.append(record)
                (a.directory / "samples.json").write_text(json.dumps(records, indent=2))
                print(
                    name,
                    "failed"
                    if result.returncode
                    else f"confirmed {record['apply']['click_to_confirmed_ms']} ms",
                    flush=True,
                )
                if result.returncode:
                    return 1  # Never continue mutating an unexplained instance.
    return int(
        any(
            r["transfer_ms"] > 30000
            or max(r[k]["click_to_confirmed_ms"] for k in ("apply", "rollback")) > 15000
            for r in records
        )
    )


if __name__ == "__main__":
    sys.exit(main())
