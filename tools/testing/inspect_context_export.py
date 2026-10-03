"""Read synthetic browser downloads with the fixed app reader and full graph parser.

No Bundle code is loaded. Output contains counts and fingerprints, never bodies.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'apps/api'))
from app.services.context_protocol.source import PackageSource
from app.services.context_protocol.canonical_v2 import select_adapter
from app.services.context_protocol.fingerprints import fingerprint_messages
from app.services.context_protocol.manifest import load_package_manifest
from app.services.import_pipeline.canjson_parser import parse_canjson_v2


def inspect(path):
    with PackageSource(path) as source:
        manifest = load_package_manifest(source)
        for name, info in manifest.files.items():
            assert source.sha256(name) == info['sha256'], 'Member digest mismatch'
            assert source.byte_size(name) == info['byte_size'], 'Member size mismatch'
        adapter = select_adapter(source, manifest.entrypoint)
        snapshot = adapter.scan()
        assert not snapshot.parse_errors, 'Canonical reader errors'
        parsed = parse_canjson_v2(source.read_bytes(manifest.entrypoint))
        return {'fingerprint': fingerprint_messages(adapter.iter_messages(), snapshot, 'prefix'),
                'message_count': len(parsed.conversation.messages),
                'attachment_refs': len(snapshot.attachment_refs)}


if __name__ == '__main__':
    print(json.dumps(inspect(sys.argv[1])))
