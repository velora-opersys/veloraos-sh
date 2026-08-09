from __future__ import annotations

import argparse
import json
import sys

from . import licensing
from .main import VERSION


def main() -> int:
    parser = argparse.ArgumentParser(prog="veloraos-license")
    parser.add_argument("command", choices=["status", "retry", "deactivate"])
    args = parser.parse_args()
    try:
        if args.command == "status":
            print(json.dumps(licensing.status_payload(), indent=2))
            return 0
        if args.command == "retry":
            print(json.dumps(licensing.recheck(f"VeloraOS {VERSION}"), indent=2))
            return 0
        if args.command == "deactivate":
            key = licensing.stored_key()
            device_id = licensing.stored_device_id()
            result = licensing.deactivate_key(key, device_id, licensing.stored_device_name(), f"VeloraOS {VERSION}")
            print(json.dumps(result, indent=2))
            return 0
    except licensing.LicensingError as error:
        print(error.message, file=sys.stderr)
        return 1
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
