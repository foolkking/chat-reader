import json

import pytest

from app.services.import_pipeline.exporter_json_parser import ExporterJsonParseError, parse_exporter_json


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


@pytest.mark.parametrize("value", [{"text": "Synthetic nested body"}, ["Synthetic nested body"], 0, False, 1.5])
def test_non_string_say_is_rejected_without_leaking_source(value) -> None:
    payload = {"metadata": {"powered_by": "ChatGPT Exporter"}, "messages": [{"role": "Response", "say": value}]}
    with pytest.raises(ExporterJsonParseError, match=r"message 0\.say must be a string") as error:
        parse_exporter_json(json.dumps(payload))
    assert "Synthetic nested body" not in str(error.value)


@pytest.mark.parametrize("message", [{"role": "Response"}, {"role": "Response", "say": None}])
def test_legacy_missing_or_null_say_stays_empty_with_explicit_warning(message) -> None:
    result = parse_exporter_json(json.dumps({"metadata": {"powered_by": "ChatGPT Exporter"}, "messages": [message]}))
    assert result.messages[0].text == ""
    assert result.messages[0].is_empty
    assert any("message 0.say" in warning for warning in result.warnings)


def test_string_say_is_preserved_exactly() -> None:
    source = "  Synthetic 中文\r\n`<script>literal</script>`\n"
    result = parse_exporter_json(json.dumps({"metadata": {"powered_by": "ChatGPT Exporter"}, "messages": [{"role": "Response", "say": source}]}))
    assert result.messages[0].text == source
    assert result.warnings == []
