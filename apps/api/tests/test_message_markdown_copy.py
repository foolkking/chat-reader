"""Synthetic copy/public-image regression. No real user content or credentials."""
import hashlib
import io
import uuid
from contextlib import contextmanager

import pytest
from PIL import Image, PngImagePlugin

from app.core.config import get_settings
from app.core.database import get_db
from app.main import app
from app.models.attachment import AssetDerivative, AssetObject, Attachment
from app.models.attachment_public_link import AttachmentPublicLink
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_version import MessageVersion
from app.services.assets.asset_store import get_asset_store
from app.services.assets.public_images import MAX_PREVIEW_BYTES, publish_images
from app.services.assets.attachment_service import AttachmentAccessError
from app.services.ownership import OwnershipScope
from test_import_preview_api import client  # noqa: F401
from test_auth import auth_client, owner_login  # noqa: F401


@contextmanager
def database():
    generator = app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        yield db
    finally:
        db.close()
        generator.close()


def png(size=(8, 6), metadata=False, color=(20, 140, 100, 255)):
    output = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    if metadata:
        info.add_text("untrusted", "<script>must not survive</script>")
    Image.new("RGBA", size, color).save(output, "PNG", pnginfo=info)
    return output.getvalue()


def seed(monkeypatch, tmp_path, owner=None):
    monkeypatch.setenv("ASSET_STORAGE_DIR", str(tmp_path / "copy-assets"))
    monkeypatch.setenv("ALLOW_UNSCANNED_ATTACHMENTS", "true")
    get_settings.cache_clear()
    with database() as db:
        conv = Conversation(title="Synthetic copy", display_title="Synthetic copy", source_type="manual",
                            source_profile="manual", parser_version="test", owner_user_id=owner)
        db.add(conv)
        db.flush()
        message = Message(conversation_id=conv.id, role="assistant", order_key="a")
        db.add(message)
        db.flush()
        ids = {}
        for name, mime, payload in [
            ("raster", "image/png", png()),
            ("svg", "image/svg+xml", b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="6"><rect width="8" height="6"/></svg>'),
            ("file", "application/pdf", b"%PDF synthetic unavailable copy file"),
        ]:
            store = get_asset_store()
            staged = store.stage(io.BytesIO(payload), max_bytes=1024 * 1024, quarantine=False)
            key = store.object_key()
            store.promote(staged.path, key)
            asset = AssetObject(sha256=staged.sha256, byte_size=staged.byte_size, detected_mime_type=mime,
                                storage_key=key, status="available", scan_status="scanner_disabled")
            db.add(asset)
            db.flush()
            attachment = Attachment(conversation_id=conv.id, asset_object_id=asset.id, original_filename=name,
                                    display_name=name, detected_mime_type=mime, status="available")
            db.add(attachment)
            db.flush()
            ids[name] = str(attachment.id)
            ids[name + "_asset"] = str(asset.id)
            ids[name + "_sha"] = asset.sha256
        text = f"# Synthetic\n\n![image](cr-asset://{ids['raster']})\n\n![vector](cr-asset://{ids['svg']})\n\n[file](cr-asset://{ids['file']})\n\n**Tail retained**"
        version = MessageVersion(message_id=message.id, version_number=1, plain_text=text, display_text=text,
                                 content_hash=hashlib.sha256(text.encode()).hexdigest(), edit_type="import")
        db.add(version)
        db.flush()
        message.current_version_id = version.id
        ids.update(message=str(message.id), version=str(version.id), conversation=str(conv.id))
        db.commit()
    return ids


def publish(client, case, ids=None, version=None):
    return client.post(f"/api/messages/{case['message']}/markdown-copy", json={
        "base_version_id": version or case["version"], "attachment_ids": ids if ids is not None else [case["raster"]],
    })


def upload_svg(client, case, payload=None):
    return client.put(f"/api/attachments/{case['svg']}/markdown-copy-preview",
                      params={"source_sha256": case["svg_sha"]}, content=png(metadata=True) if payload is None else payload,
                      headers={"Content-Type": "image/png"})


def test_plan_is_complete_private_source_without_publishing(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    result = client.get(f"/api/messages/{case['message']}/markdown-copy")
    assert result.status_code == 200, result.text
    assert result.json()["markdown"].endswith("**Tail retained**")
    assert len(result.json()["attachments"]) == 3
    assert result.json()["version_id"] == case["version"]
    assert result.headers["cache-control"] == "no-store"
    with database() as db:
        assert db.query(AttachmentPublicLink).count() == 0


def test_repeated_copy_is_stable_and_original_stays_private(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    first = publish(client, case)
    assert first.status_code == 200, first.text
    path = first.json()["urls"][case["raster"]]
    assert path == publish(client, case).json()["urls"][case["raster"]]
    result = client.get(path)
    assert result.status_code == 200, result.text
    assert result.content == png()
    assert result.headers["content-type"] == "image/png"
    assert result.headers["cache-control"] == "no-store"
    assert result.headers["x-content-type-options"] == "nosniff"
    assert result.headers["referrer-policy"] == "no-referrer"
    assert client.head(path).content == b""
    assert client.head(path).headers["content-length"] == str(len(png()))
    assert client.get(path, headers={"Range": "bytes=0-7"}).status_code == 206
    with database() as db:
        assert db.query(AttachmentPublicLink).count() == 1


def test_svg_requires_validated_inert_png_not_original_xml(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert publish(client, case, [case["svg"]]).status_code == 409
    assert upload_svg(client, case).status_code == 204
    result = publish(client, case, [case["svg"]])
    assert result.status_code == 200, result.text
    response = client.get(result.json()["urls"][case["svg"]])
    assert response.headers["content-type"] == "image/png"
    assert response.content.startswith(b"\x89PNG")
    assert b"script" not in response.content and b"svg" not in response.content
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.size == (8, 6)
        assert image.info == {}


def test_avif_capability_serves_original_supported_image_bytes(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    output = io.BytesIO()
    Image.new("RGB", (8, 6), (20, 140, 100)).save(output, format="AVIF")
    payload = output.getvalue()
    with database() as db:
        store = get_asset_store()
        staged = store.stage(io.BytesIO(payload), max_bytes=1024 * 1024, quarantine=False)
        key = store.object_key()
        store.promote(staged.path, key)
        asset = db.get(AssetObject, uuid.UUID(case["raster_asset"]))
        asset.sha256, asset.byte_size = staged.sha256, staged.byte_size
        asset.storage_key, asset.detected_mime_type = key, "image/avif"
        db.commit()
    result = publish(client, case)
    assert result.status_code == 200
    image = client.get(result.json()["urls"][case["raster"]])
    assert image.headers["content-type"] == "image/avif"
    assert image.content == payload


@pytest.mark.parametrize("payload", [b"<svg/>", b"not a PNG", png((1601, 1)), b"x" * (MAX_PREVIEW_BYTES + 1)],
                         ids=["svg-not-png", "corrupt", "dimensions", "byte-limit"])
def test_invalid_or_oversized_png_never_creates_preview(client, monkeypatch, tmp_path, payload):
    case = seed(monkeypatch, tmp_path)
    assert upload_svg(client, case, payload).status_code in {413, 422}
    with database() as db:
        assert db.query(AssetDerivative).count() == 0
        assert db.query(AttachmentPublicLink).count() == 0


def test_other_files_foreign_attachment_and_stale_version_rejected_atomically(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert publish(client, case, [case["raster"], case["file"]]).status_code == 422
    assert publish(client, case, [str(uuid.uuid4())]).status_code == 404
    assert publish(client, case, version=str(uuid.uuid4())).status_code == 409
    with database() as db:
        assert db.query(AttachmentPublicLink).count() == 0
        with pytest.raises(AttachmentAccessError):
            publish_images(db, uuid.UUID(case["message"]), OwnershipScope(uuid.uuid4()),
                           uuid.UUID(case["version"]), [uuid.UUID(case["raster"])])


@pytest.mark.parametrize("change", ["detach", "attachment_delete", "conversation_delete", "asset_delete", "blocked", "replace", "file_missing"])
def test_public_capability_fails_after_live_resource_change(client, monkeypatch, tmp_path, change):
    case = seed(monkeypatch, tmp_path)
    path = publish(client, case).json()["urls"][case["raster"]]
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        asset = row.asset_object
        if change == "detach": row.status = "detached"
        if change == "attachment_delete": row.deleted_at = row.created_at
        if change == "conversation_delete":
            conv = db.get(Conversation, uuid.UUID(case["conversation"]))
            conv.deleted_at = conv.imported_at
        if change == "asset_delete": asset.deleted_at = asset.created_at
        if change == "blocked": asset.scan_status = "infected"
        if change == "replace": row.asset_object_id = uuid.UUID(case["svg_asset"])
        if change == "file_missing": get_asset_store().delete_key(asset.storage_key)
        db.commit()
    assert client.get(path).status_code == 404
    assert client.head(path).status_code == 404
    assert client.get(path).headers["cache-control"] == "no-store"


def test_wrong_hash_and_raster_preview_upload_fail_closed(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    path = f"/api/attachments/{case['svg']}/markdown-copy-preview"
    assert client.put(path, params={"source_sha256": "0" * 64}, content=png()).status_code == 409
    assert client.put(f"/api/attachments/{case['raster']}/markdown-copy-preview",
                      params={"source_sha256": case["raster_sha"]}, content=png()).status_code == 422


def test_anonymous_only_exact_capability_reads_bypass_auth(auth_client, monkeypatch, tmp_path):
    assert owner_login(auth_client).status_code == 200
    from app.services.auth import ROOT_ADMIN_USER_ID
    case = seed(monkeypatch, tmp_path, ROOT_ADMIN_USER_ID)
    result = publish(auth_client, case)
    assert result.status_code == 200, result.text
    path = result.json()["urls"][case["raster"]]
    auth_client.cookies.clear()
    assert auth_client.get(path).status_code == 200
    assert auth_client.head(path).status_code == 200
    assert auth_client.get(f"/api/attachments/{case['raster']}/content").status_code == 401
    assert auth_client.get(f"/api/messages/{case['message']}/markdown-copy").status_code == 401
    assert publish(auth_client, case).status_code == 401
    assert auth_client.post(path).status_code == 401
    assert auth_client.get(path + "/anything").status_code == 401
    assert auth_client.get("/api/public-images/" + "x" * 43).status_code == 404


def test_attachment_removal_revokes_old_link_even_if_readded(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    path = publish(client, case).json()["urls"][case["raster"]]
    deleted = client.delete(f"/api/conversations/{case['conversation']}/attachments/{case['raster']}")
    assert deleted.status_code == 204, deleted.text
    with database() as db:
        db.get(Attachment, uuid.UUID(case["raster"])).status = "available"
        db.commit()
    assert client.get(path).status_code == 404
    assert publish(client, case).json()["urls"][case["raster"]] != path


def test_svg_preview_is_scoped_to_attachment_not_deduplicated_source(client, monkeypatch, tmp_path):
    from app.services.assets.public_images import save_svg_preview, public_image_content
    case = seed(monkeypatch, tmp_path)
    assert upload_svg(client, case).status_code == 204
    original = publish(client, case, [case["svg"]]).json()["urls"][case["svg"]]
    other_owner = uuid.uuid4()
    with database() as db:
        conversation = Conversation(title="Other synthetic owner", display_title="Other synthetic owner", source_type="manual", source_profile="manual",
                                    parser_version="test", owner_user_id=other_owner)
        db.add(conversation)
        db.flush()
        attachment = Attachment(conversation_id=conversation.id, asset_object_id=uuid.UUID(case["svg_asset"]),
                                original_filename="other.svg", display_name="other.svg", status="available")
        db.add(attachment)
        db.flush()
        message = Message(conversation_id=conversation.id, role="assistant", order_key="a")
        db.add(message)
        db.flush()
        text = f"![other](cr-asset://{attachment.id})"
        version = MessageVersion(message_id=message.id, version_number=1, display_text=text,
                                 plain_text=text, edit_type="import", content_hash=hashlib.sha256(text.encode()).hexdigest())
        db.add(version)
        db.flush()
        message.current_version_id = version.id
        db.flush()
        scope = OwnershipScope(other_owner)
        with pytest.raises(AttachmentAccessError, match="safe PNG preview"):
            publish_images(db, message.id, scope, version.id, [attachment.id])
        save_svg_preview(db, attachment.id, scope, case["svg_sha"], png(color=(200, 20, 10, 255)))
        result = publish_images(db, message.id, scope, version.id, [attachment.id])
        db.commit()
        token = result["urls"][str(attachment.id)].rsplit("/", 1)[1]
        path, _ = public_image_content(db, token)
        with Image.open(path) as image:
            assert image.getpixel((0, 0)) == (200, 20, 10, 255)
        assert db.query(AssetDerivative).count() == 2
    with Image.open(io.BytesIO(client.get(original).content)) as image:
        assert image.getpixel((0, 0)) == (20, 140, 100, 255)


def test_missing_preview_object_can_be_repaired_without_duplicate_mapping(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert upload_svg(client, case).status_code == 204
    path = publish(client, case, [case["svg"]]).json()["urls"][case["svg"]]
    with database() as db:
        derivative = db.query(AssetDerivative).one()
        asset = db.get(AssetObject, derivative.derivative_asset_object_id)
        get_asset_store().delete_key(asset.storage_key)
    assert client.get(path).status_code == 404
    assert upload_svg(client, case).status_code == 204
    assert client.get(path).status_code == 200
    with database() as db:
        assert db.query(AssetDerivative).count() == 1


def test_preview_single_conversion_slot_and_integrity_retry_release(client, monkeypatch, tmp_path):
    from app.api.routes.markdown_copy import _preview_slot
    from app.services.assets import public_images
    from sqlalchemy.exc import IntegrityError
    case = seed(monkeypatch, tmp_path)
    assert _preview_slot.acquire(blocking=False)
    try:
        response = upload_svg(client, case)
        assert response.status_code == 429 and response.headers["retry-after"] == "3"
    finally:
        _preview_slot.release()
    with monkeypatch.context() as patch:
        def conflict(*args):
            raise IntegrityError("synthetic conflict", {}, Exception("synthetic conflict"))
        patch.setattr(public_images, "save_svg_preview", conflict)
        assert upload_svg(client, case).status_code == 503
    assert upload_svg(client, case).status_code == 204
