import json

from app.services.import_pipeline.exporter_json_parser import parse_exporter_json


def _payload(powered_by: str) -> bytes:
    return json.dumps(
        {
            "metadata": {"powered_by": powered_by},
            "messages": [{"role": "Prompt", "say": "Hello", "time": "2026-07-01 10:00:00"}],
        }
    ).encode()


def test_current_exporter_powered_by_url_is_supported() -> None:
    result = parse_exporter_json(_payload("ChatGPT Exporter (https://www.chatgptexporter.com)"))

    assert not any("powered_by" in warning for warning in result.warnings)


def test_unknown_powered_by_still_warns() -> None:
    result = parse_exporter_json(_payload("Unknown Exporter"))

    assert any("powered_by" in warning for warning in result.warnings)
