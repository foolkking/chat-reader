#!/usr/bin/env python3
"""Compare an old maintained package with a new Raw export; never writes either."""
import argparse
import json
from _continuation_maintenance.package_update import compare_packages
from _continuation_maintenance.model import MaintenanceError
from _context_package.source import PackageError


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('previous_package')
    parser.add_argument('new_raw_package')
    args = parser.parse_args()
    try:
        result = compare_packages(args.previous_package, args.new_raw_package)
    except (MaintenanceError, PackageError) as error:
        print(json.dumps({'status': getattr(error, 'code', 'package_invalid'), 'error': str(error)}))
        return 3
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
