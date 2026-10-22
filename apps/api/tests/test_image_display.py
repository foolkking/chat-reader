"""Synthetic original-preserving sizing and stable dynamic capabilities."""
import io
import uuid

import pytest
from PIL import Image

from app.models.attachment import AssetObject, Attachment
from app.models.attachment_public_link import AttachmentPublicLink
from test_message_markdown_copy import client, auth_client, owner_login, database, seed, publish, upload_svg  # noqa: F401


def endpoint(case, kind="raster"):
    return f"/api/attachments/{case[kind]}/image-display"


def save(client, case, percent, expected=100, kind="raster", sha=None):
    return client.put(endpoint(case, kind), json={
        "source_sha256": sha or case[kind + "_sha"],
        "scale_percent": percent, "expected_scale_percent": expected,
    })


def size(response):
    assert response.status_code == 200, response.text
    with Image.open(io.BytesIO(response.content)) as image:
        return image.size


def test_size_follows_same_link_and_original_is_never_overwritten(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    before = client.get(f"/api/attachments/{case['raster']}/content").content
    link = publish(client, case).json()["urls"][case["raster"]]
    initial = client.get(endpoint(case))
    assert initial.status_code == 200 and initial.headers["cache-control"] == "no-store"
    assert initial.json()["original_width"] == 8 and initial.json()["original_height"] == 6
    assert save(client, case, 50).status_code == 200
    assert size(client.get(link)) == (4, 3)
    assert publish(client, case).json()["urls"][case["raster"]] == link
    assert save(client, case, 25, expected=50).status_code == 200
    assert size(client.get(link)) == (2, 2)
    assert save(client, case, 100, expected=25).status_code == 200
    assert client.get(link).content == before
    assert client.get(f"/api/attachments/{case['raster']}/content").content == before
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        assert str(row.asset_object_id) == case["raster_asset"]
        assert row.metadata_["image_display_v1"]["original_width"] == 8
        assert db.query(AttachmentPublicLink).count() == 1


def test_size_alone_does_not_publish_and_missing_derivative_is_fail_closed(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50).status_code == 200
    with database() as db:
        assert db.query(AttachmentPublicLink).count() == 0
    link = publish(client, case).json()["urls"][case["raster"]]
    assert client.get(link).headers["cache-control"] == "no-store"
    assert client.head(link).status_code == 200
    assert client.get(link, headers={"Range": "bytes=0-7"}).status_code == 206
    with database() as db:
        from app.services.assets.image_display import display_asset
        from app.services.assets.asset_store import get_asset_store
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        get_asset_store().delete_key(display_asset(db, row).storage_key)
    assert client.get(link).status_code == 404
    assert publish(client, case).status_code == 404
    assert save(client, case, 50, expected=50).status_code == 200
    assert size(client.get(link)) == (4, 3)


@pytest.mark.parametrize("value", [0, 101, 50.5, True, "50", -1])
def test_invalid_percent_rejected_without_metadata_change(client, monkeypatch, tmp_path, value):
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, value).status_code == 422
    assert client.get(endpoint(case)).json()["scale_percent"] == 100


def test_stale_source_stale_setting_and_nonimage_rejected(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50, sha="0" * 64).status_code == 409
    assert save(client, case, 50).status_code == 200
    assert save(client, case, 25).status_code == 409
    assert client.get(endpoint(case)).json()["scale_percent"] == 50
    assert save(client, case, 50, kind="file").status_code == 422


def test_svg_size_is_png_and_source_dimensions_survive(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50, kind="svg").status_code == 409
    assert upload_svg(client, case).status_code == 204
    assert save(client, case, 50, kind="svg").status_code == 200
    link = publish(client, case, [case["svg"]]).json()["urls"][case["svg"]]
    assert size(client.get(link)) == (4, 3)
    assert client.get(link).headers["content-type"] == "image/png"
    assert save(client, case, 100, expected=50, kind="svg").status_code == 200
    assert size(client.get(link)) == (8, 6)


@pytest.mark.parametrize("change", ["detach", "conversation", "quarantine", "source", "missing"])
def test_scaled_links_still_recheck_source_availability(client, monkeypatch, tmp_path, change):
    from app.models.conversation import Conversation
    from app.models.import_record import utc_now
    from app.services.assets.asset_store import get_asset_store
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50).status_code == 200
    link = publish(client, case).json()["urls"][case["raster"]]
    with database() as db:
        row = db.get(Attachment, uuid.UUID(case["raster"]))
        if change == "detach": row.deleted_at = utc_now()
        if change == "conversation": db.get(Conversation, row.conversation_id).deleted_at = utc_now()
        if change == "quarantine": row.asset_object.scan_status = "infected"
        if change == "source": row.asset_object_id = uuid.UUID(case["svg_asset"])
        if change == "missing": get_asset_store().delete_key(row.asset_object.storage_key)
        db.commit()
    assert client.get(link).status_code == 404


def test_resize_slot_is_bounded_and_released(client, monkeypatch, tmp_path):
    from app.api.routes.markdown_copy import _preview_slot
    case = seed(monkeypatch, tmp_path)
    assert _preview_slot.acquire(blocking=False)
    try:
        assert save(client, case, 50).status_code == 429
    finally:
        _preview_slot.release()
    assert save(client, case, 50).status_code == 200


def test_anonymous_and_other_owner_cannot_read_or_resize(auth_client, monkeypatch, tmp_path):
    assert owner_login(auth_client).status_code == 200
    from app.services.auth import ROOT_ADMIN_USER_ID
    case = seed(monkeypatch, tmp_path, owner=ROOT_ADMIN_USER_ID)
    assert save(auth_client, case, 50).status_code == 200
    auth_client.post("/api/auth/logout")
    assert auth_client.get(endpoint(case)).status_code == 401
    assert save(auth_client, case, 25, expected=50).status_code == 401


def test_owner_scope_hides_other_accounts_attachment(client, monkeypatch, tmp_path):
    from app.services.assets.image_display import display_state, save_display
    from app.services.assets.attachment_service import AttachmentAccessError
    from app.services.ownership import OwnershipScope
    case = seed(monkeypatch, tmp_path)
    with database() as db:
        scope = OwnershipScope(uuid.uuid4())
        with pytest.raises(AttachmentAccessError, match="not found"):
            display_state(db, uuid.UUID(case["raster"]), scope)
        with pytest.raises(AttachmentAccessError, match="not found"):
            save_display(db, uuid.UUID(case["raster"]), scope, case["raster_sha"], 50, 100)


def test_unavailable_attachment_cannot_read_or_change_size(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    with database() as db:
        db.get(Attachment, uuid.UUID(case["raster"])).status = "failed"
        db.commit()
    assert client.get(endpoint(case)).status_code == 404
    assert save(client, case, 50).status_code == 404


def test_animation_is_not_silently_flattened(client, monkeypatch, tmp_path):
    from app.services.assets.asset_store import get_asset_store
    case = seed(monkeypatch, tmp_path)
    out = io.BytesIO()
    Image.new("RGB", (8, 6), "red").save(out, format="GIF", save_all=True,
        append_images=[Image.new("RGB", (8, 6), "blue")], duration=100, loop=0)
    with database() as db:
        store = get_asset_store()
        staged = store.stage(io.BytesIO(out.getvalue()), max_bytes=1024 * 1024, quarantine=False)
        key = store.object_key(); store.promote(staged.path, key)
        asset = db.get(AssetObject, uuid.UUID(case["raster_asset"]))
        asset.sha256, asset.byte_size = staged.sha256, staged.byte_size
        asset.storage_key, asset.detected_mime_type = key, "image/gif"
        case["raster_sha"] = staged.sha256
        db.commit()
    assert save(client, case, 50).status_code == 422
    assert client.get(endpoint(case)).json()["scale_percent"] == 100
    link = publish(client, case).json()["urls"][case["raster"]]
    assert client.get(link).content == out.getvalue()


def replace_raster(case, raw, mime="image/png"):
    from app.services.assets.asset_store import get_asset_store
    with database() as db:
        store = get_asset_store()
        staged = store.stage(io.BytesIO(raw), max_bytes=20 * 1024 * 1024, quarantine=False)
        key = store.object_key()
        store.promote(staged.path, key)
        asset = db.get(AssetObject, uuid.UUID(case["raster_asset"]))
        asset.sha256, asset.byte_size = staged.sha256, staged.byte_size
        asset.storage_key, asset.detected_mime_type = key, mime
        case["raster_sha"] = staged.sha256
        db.commit()


def test_derivative_drops_metadata_and_preserves_unrelated_attachment_metadata(client, monkeypatch, tmp_path):
    from test_message_markdown_copy import png
    case = seed(monkeypatch, tmp_path)
    original = png(metadata=True)
    replace_raster(case, original)
    with database() as db:
        db.get(Attachment, uuid.UUID(case["raster"])).metadata_ = {"retained": "synthetic"}
        db.commit()
    assert save(client, case, 50).status_code == 200
    link = publish(client, case).json()["urls"][case["raster"]]
    with Image.open(io.BytesIO(client.get(link).content)) as image:
        assert image.info == {}
    assert client.get(f"/api/attachments/{case['raster']}/content").content == original
    with database() as db:
        assert db.get(Attachment, uuid.UUID(case["raster"])).metadata_["retained"] == "synthetic"


def test_exif_orientation_is_applied_once_from_original(client, monkeypatch, tmp_path):
    case = seed(monkeypatch, tmp_path)
    out = io.BytesIO()
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (12, 8), "green").save(out, "JPEG", exif=exif)
    replace_raster(case, out.getvalue(), "image/jpeg")
    state = client.get(endpoint(case)).json()
    assert (state["original_width"], state["original_height"]) == (8, 12)
    assert save(client, case, 50).status_code == 200
    link = publish(client, case).json()["urls"][case["raster"]]
    assert size(client.get(link)) == (4, 6)
    assert save(client, case, 25, expected=50).status_code == 200
    assert size(client.get(link)) == (2, 3)
    assert client.get(f"/api/attachments/{case['raster']}/content").content == out.getvalue()


@pytest.mark.parametrize("boundary", ["source_pixels", "result_pixels", "result_edge", "bytes"])
def test_resize_limits_preserve_last_saved_setting(client, monkeypatch, tmp_path, boundary):
    import app.services.assets.image_display as service
    byte_limit = service.MAX_BYTES
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50).status_code == 200
    if boundary == "source_pixels":
        monkeypatch.setattr(service, "MAX_SOURCE_PIXELS", 47)
    elif boundary == "result_pixels":
        monkeypatch.setattr(service, "MAX_RESULT_PIXELS", 3)
    elif boundary == "result_edge":
        out = io.BytesIO()
        Image.new("RGB", (6000, 1), "green").save(out, "PNG")
        replace_raster(case, out.getvalue())
    else:
        monkeypatch.setattr(service, "MAX_BYTES", 1)
    # A source replacement invalidates the old setting rather than applying it
    # to different bytes. Other failures leave the previous 50% selection intact.
    expected = 100 if boundary == "result_edge" else 50
    assert save(client, case, 90, expected=expected).status_code == 413
    monkeypatch.setattr(service, "MAX_BYTES", byte_limit)
    assert client.get(endpoint(case)).json()["scale_percent"] == expected


@pytest.mark.parametrize("boundary", ["recorded", "actual"])
def test_header_inspection_checks_bytes_before_pillow(client, monkeypatch, tmp_path, boundary):
    import app.services.assets.image_display as service
    from app.services.assets.asset_store import get_asset_store
    case = seed(monkeypatch, tmp_path)
    assert save(client, case, 50).status_code == 200
    with database() as db:
        asset = db.get(AssetObject, uuid.UUID(case["raster_asset"]))
        if boundary == "recorded":
            asset.byte_size = service.MAX_BYTES + 1
            db.commit()
        else:
            # Synthetic task storage only. A sparse extension also proves the
            # actual file bound is independent of potentially stale metadata.
            with get_asset_store().resolve_key(asset.storage_key).open("r+b") as stream:
                stream.truncate(service.MAX_BYTES + 1)
    def forbidden_decode(*args, **kwargs):
        raise AssertionError("Pillow must not inspect an over-limit file")
    monkeypatch.setattr(service.Image, "open", forbidden_decode)
    assert client.get(endpoint(case)).status_code == 413
    assert save(client, case, 100, expected=50).status_code == 413
    with database() as db:
        assert db.get(Attachment, uuid.UUID(case["raster"])).metadata_["image_display_v1"]["scale_percent"] == 50
