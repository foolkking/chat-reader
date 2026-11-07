"""Optional geometry is source-bound, authorized, bounded, and read-only."""
import hashlib
import io
import uuid

from PIL import Image

from app.models.attachment import AssetDerivative, Attachment
from app.models.attachment_public_link import AttachmentPublicLink
from app.services.assets.attachment_service import attachment_read
from app.services.assets.image_geometry import KEY, selected_geometry
from test_message_markdown_copy import client, database, seed  # noqa: F401
from test_auth import auth_client, owner_login  # noqa: F401


def test_legacy_detail_geometry_never_saves_publishes_or_creates_derivatives(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    response = client.get(f"/api/attachments/{case['raster']}")
    assert response.status_code == 200
    value = response.json()["metadata"][KEY]
    assert value == {"source_sha256": case["raster_sha"], "original_width": 8, "original_height": 6}
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        assert KEY not in row.metadata_
        assert "image_display_v1" not in row.metadata_
        assert db.query(AssetDerivative).count() == 0
        assert db.query(AttachmentPublicLink).count() == 0


def test_list_serializer_never_inspects_files_and_geometry_snapshot_is_allowlisted(client, monkeypatch, tmp_path):
    from app.services.assets import image_geometry
    from app.services.offline_packages import _offline_attachment_payloads
    case = seed(monkeypatch, tmp_path)
    def unexpected(*_args, **_kwargs):
        raise AssertionError("Bulk serializers must not inspect source files")
    monkeypatch.setattr(image_geometry, "inspect_geometry", unexpected)
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        assert KEY not in attachment_read(row).metadata
        value = {"source_sha256": case["raster_sha"], "original_width": 8, "original_height": 6, "unsafe": "omit"}
        row.metadata_ = {KEY: value}
        assert selected_geometry(row) == {key: value[key] for key in ("source_sha256", "original_width", "original_height")}
        rows = list(_offline_attachment_payloads(db, row.conversation_id, "all"))
        portable = next(item for item in rows if item["id"] == case["raster"])[KEY]
        assert "unsafe" not in portable
        for bad in ({**value, "source_sha256": "b" * 64}, {**value, "original_width": True},
                    {**value, "original_height": 0}, {**value, "original_width": 1_000_001}):
            row.metadata_ = {KEY: bad}
            assert selected_geometry(row) is None


def test_rejected_inspection_does_not_hide_original_or_modify_metadata(client, monkeypatch, tmp_path):
    from app.services.assets import image_display
    from app.services.assets.attachment_service import AttachmentAccessError
    case = seed(monkeypatch, tmp_path)
    def reject(_content):
        raise AttachmentAccessError("Synthetic admission denial", 413)
    monkeypatch.setattr(image_display, "dimensions", reject)
    response = client.get(f"/api/attachments/{case['raster']}")
    assert response.status_code == 200
    assert KEY not in response.json()["metadata"]
    assert response.json()["content_url"]
    assert client.get(response.json()["content_url"]).status_code == 200
    assert KEY not in client.get(f"/api/attachments/{case['file']}").json()["metadata"]


def test_geometry_is_oriented_and_unavailable_assets_are_not_inspected(client, monkeypatch, tmp_path):
    from app.services.assets.asset_store import get_asset_store
    from app.services.assets import image_display
    case = seed(monkeypatch, tmp_path)
    output = io.BytesIO()
    with Image.new("RGB", (12, 8)) as image:
        exif = image.getexif()
        exif[274] = 6
        image.save(output, format="JPEG", exif=exif)
    raw = output.getvalue()
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        asset = row.asset_object
        get_asset_store().resolve_key(asset.storage_key).write_bytes(raw)
        asset.detected_mime_type = "image/jpeg"
        asset.byte_size = len(raw)
        asset.sha256 = hashlib.sha256(raw).hexdigest()
        db.commit()
    response = client.get(f"/api/attachments/{case['raster']}")
    assert response.json()["metadata"][KEY]["original_width"] == 8
    assert response.json()["metadata"][KEY]["original_height"] == 12
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        row.asset_object.scan_status = "infected"
        db.commit()
    monkeypatch.setattr(image_display, "dimensions", lambda _content: (_ for _ in ()).throw(AssertionError("Blocked asset inspected")))
    blocked = client.get(f"/api/attachments/{case['raster']}").json()
    assert blocked["content_url"] is None and KEY not in blocked["metadata"]


def test_geometry_detail_keeps_authentication_boundary(auth_client, monkeypatch, tmp_path):
    from app.services.auth import ROOT_ADMIN_USER_ID
    from app.services.assets import image_geometry
    assert owner_login(auth_client).status_code == 200
    case = seed(monkeypatch, tmp_path, ROOT_ADMIN_USER_ID)
    assert auth_client.get(f"/api/attachments/{case['raster']}").json()["metadata"][KEY]
    auth_client.cookies.clear()
    monkeypatch.setattr(image_geometry, "inspect_geometry",
                        lambda _asset: (_ for _ in ()).throw(AssertionError("Unauthorized inspection")))
    assert auth_client.get(f"/api/attachments/{case['raster']}").status_code == 401


def test_encoded_byte_admission_precedes_header_inspection(client, monkeypatch, tmp_path):
    from app.services.assets import image_display
    case = seed(monkeypatch, tmp_path)
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        row.asset_object.byte_size = image_display.MAX_BYTES + 1
        db.commit()
    monkeypatch.setattr(image_display.Image, "open",
                        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("Oversize decode")))
    result = client.get(f"/api/attachments/{case['raster']}").json()
    assert KEY not in result["metadata"] and result["content_url"]
