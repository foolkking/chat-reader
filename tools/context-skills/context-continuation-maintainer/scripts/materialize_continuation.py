#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from _continuation_maintenance.materialize import materialize_continuation
from _continuation_maintenance.model import MaintenanceError


def main() -> int:
    p=argparse.ArgumentParser(description="Atomically materialize a reconciled Continuation Candidate into a new validated Context Package revision.")
    p.add_argument("package")
    p.add_argument("--previous-package", help="Use Continuation from this package and Raw/assets from PACKAGE")
    p.add_argument("--candidate",required=True)
    p.add_argument("--maintenance-trace",required=True)
    p.add_argument("--validation-report")
    p.add_argument("--fragment",action="append",dest="fragments",default=[])
    p.add_argument("--output",required=True)
    p.add_argument("--pretty",action="store_true")
    a=p.parse_args()
    try:
        writer = materialize_continuation
        if a.previous_package:
            from _continuation_maintenance.dual_materialize import materialize_package_update
            writer = lambda package, **kwargs: materialize_package_update(a.previous_package, package, **kwargs)
        report=writer(
            a.package,candidate_path=a.candidate,maintenance_trace_path=a.maintenance_trace,
            validation_report_path=a.validation_report,fragment_paths=a.fragments,output_path=a.output,
        )
        code=0
    except MaintenanceError as e:
        report={
            "report_schema":"chat-reader-continuation-materialization","report_version":"1.0.0",
            "tool":{"name":"materialize_continuation","version":"1.1.0"},
            "status":e.code,"published":False,
            "findings":[{"severity":"error","code":e.code,"detail":str(e)}],
        }
        code=3
    except Exception as e:
        report={
            "report_schema":"chat-reader-continuation-materialization","report_version":"1.0.0",
            "tool":{"name":"materialize_continuation","version":"1.1.0"},
            "status":"internal_failure","published":False,
            "findings":[{"severity":"error","code":"materializer_internal_failure","detail":str(e)}],
        }
        code=6
    sys.stdout.write(json.dumps(report,ensure_ascii=False,indent=2 if a.pretty else None,separators=None if a.pretty else (",",":"))+"\n")
    return code

if __name__=="__main__": raise SystemExit(main())
