import hashlib
import json
from pathlib import Path
import uuid
import zipfile

from test_import_preview_api import client  # noqa: F401
from test_message_editing_api import commit_edit_sample
from app.core.database import get_db
from app.main import app
from app.services.exporting.context_package import create_context_package


def test_actual_context_export_is_readable_by_acquisition(client):
    sample = commit_edit_sample(client)
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        artifact = create_context_package(db, conversation_id=uuid.UUID(sample['conversation_id']),
                                          job_id=uuid.uuid4(), scope_kind='full_conversation', start_message_id=None)
        path = Path(artifact.storage_uri)
        with zipfile.ZipFile(path) as z:
            manifest = json.loads(z.read('manifest.json'))
            assert manifest['conversation']['id'] == sample['conversation_id']
            for member, info in manifest['files'].items():
                data = z.read(member)
                assert hashlib.sha256(data).hexdigest() == info['sha256']
                assert len(data) == info['byte_size']
        from app.services.context_protocol.source import PackageSource
        from app.services.context_protocol.manifest import load_package_manifest
        from app.services.context_protocol.canonical_v2 import select_adapter
        with PackageSource(path) as source:
            parsed = load_package_manifest(source)
            adapter = select_adapter(source, parsed.entrypoint)
            messages = list(adapter.iter_messages())
            assert len(messages) == manifest['conversation']['message_count']
            assert all(m.descriptor.body_available for m in messages)
            assert any('Original user question' in (m.body_text or '') for m in messages)
    finally:
        db.rollback()
        generator.close()
