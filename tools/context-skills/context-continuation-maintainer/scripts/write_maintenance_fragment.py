#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from _continuation_maintenance.fragments import write_maintenance_fragment
from _continuation_maintenance.model import MaintenanceError


def main() -> int:
    p=argparse.ArgumentParser(description="Write a source-bound Maintenance Fragment from a semantic fragment candidate.")
    p.add_argument("package")
    p.add_argument("--candidate",required=True)
    p.add_argument("--validation-report")
    p.add_argument("--output",required=True)
    p.add_argument("--pretty",action="store_true")
    a=p.parse_args()
    try:
        report=write_maintenance_fragment(a.package,candidate_path=a.candidate,validation_report_path=a.validation_report,output_path=a.output)
        code=0
    except MaintenanceError as e:
        report={
            "report_schema":"chat-reader-maintenance-fragment-write","report_version":"1.0.0",
            "tool":{"name":"write_maintenance_fragment","version":"1.0.0"},
            "status":e.code,"fragment_written":False,
            "findings":[{"severity":"error","code":e.code,"detail":str(e)}],
        }
        code=3
    except Exception as e:
        report={
            "report_schema":"chat-reader-maintenance-fragment-write","report_version":"1.0.0",
            "tool":{"name":"write_maintenance_fragment","version":"1.0.0"},
            "status":"internal_failure","fragment_written":False,
            "findings":[{"severity":"error","code":"fragment_writer_internal_failure","detail":str(e)}],
        }
        code=6
    sys.stdout.write(json.dumps(report,ensure_ascii=False,indent=2 if a.pretty else None,separators=None if a.pretty else (",",":"))+"\n")
    return code

if __name__=="__main__": raise SystemExit(main())
