#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys

from _context_package.extraction import ExtractionError, extract_context


def main() -> int:
    p = argparse.ArgumentParser(description="Deliver exact Context Package material without claiming semantic acquisition.")
    p.add_argument("package")
    p.add_argument("--validation-report")
    p.add_argument("--current", action="store_true")
    p.add_argument("--index-catalog", action="store_true", dest="index_catalog_requested")
    p.add_argument("--all-messages", action="store_true")
    p.add_argument("--tail", action="store_true")
    p.add_argument("--range", action="append", dest="ranges", default=[])
    p.add_argument("--message", action="append", type=int, dest="messages", default=[])
    p.add_argument("--segment", action="append", dest="segments", default=[])
    p.add_argument("--key-refs", action="append", dest="key_refs", default=[])
    p.add_argument("--around", action="append", type=int, dest="around", default=[])
    p.add_argument("--neighbors", type=int, default=0)
    p.add_argument("--attachment", action="append", dest="attachments", default=[])
    p.add_argument("--output-dir")
    p.add_argument("--chunk-max-bytes", type=int, default=512 * 1024)
    p.add_argument("--inline-body-max-bytes", type=int, default=128 * 1024)
    p.add_argument("--body-part-max-bytes", type=int, default=128 * 1024)
    p.add_argument("--pretty", action="store_true")
    args = p.parse_args()
    try:
        receipt = extract_context(
            args.package,
            validation_report=args.validation_report,
            current=args.current,
            index_catalog_requested=args.index_catalog_requested,
            all_messages=args.all_messages,
            tail=args.tail,
            ranges=args.ranges,
            messages=args.messages,
            segments=args.segments,
            key_refs=args.key_refs,
            around=args.around,
            neighbors=args.neighbors,
            attachments=args.attachments,
            output_dir=args.output_dir,
            chunk_max_bytes=args.chunk_max_bytes,
            inline_body_max_bytes=args.inline_body_max_bytes,
            body_part_max_bytes=args.body_part_max_bytes,
        )
    except ExtractionError as e:
        receipt = {
            "report_schema": "chat-reader-context-extraction",
            "report_version": "1.0.0",
            "tool": {"name": "extract_context_ranges", "version": "1.0.0"},
            "status": "selector_or_binding_failure",
            "semantic_read_performed": False,
            "findings": [{"severity": "error", "code": "extraction_request_failed", "detail": str(e)}],
        }
        code = 3
    except Exception as e:
        receipt = {
            "report_schema": "chat-reader-context-extraction",
            "report_version": "1.0.0",
            "tool": {"name": "extract_context_ranges", "version": "1.0.0"},
            "status": "internal_failure",
            "semantic_read_performed": False,
            "findings": [{"severity": "error", "code": "extractor_internal_failure", "detail": str(e)}],
        }
        code = 6
    else:
        code = 0
    sys.stdout.write(json.dumps(receipt, ensure_ascii=False, indent=2 if args.pretty else None, separators=None if args.pretty else (",", ":")) + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
