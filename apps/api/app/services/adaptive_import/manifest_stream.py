"""Selective JSON reader: exporter message bodies are validated then discarded."""
import codecs
import json

from app.services.adaptive_import.bounded_io import CHUNK_BYTES, checkpoint


class _Reader:
    def __init__(self, source):
        self.source, self.buffer, self.offset = source, "", 0
        self.decoder = codecs.getincrementaldecoder("utf-8-sig")()
        self.total = 0
        self.ended = False

    def peek(self):
        if self.offset == len(self.buffer) and not self.ended:
            raw = self.source.read(CHUNK_BYTES)
            self.total += len(raw)
            if self.total > 4 * 1024 * 1024:
                raise ValueError("Manifest is too large.")
            self.ended = not raw
            self.buffer = self.decoder.decode(raw, final=self.ended)
            self.offset = 0
            checkpoint()
            if not self.buffer and not self.ended:
                return self.peek()
        return self.buffer[self.offset:self.offset + 1]

    def take(self):
        token = self.peek()
        self.offset += bool(token)
        return token

    def whitespace(self):
        while self.peek() and self.peek() in " \t\r\n":
            self.take()

    def expect(self, token):
        self.whitespace()
        if self.take() != token:
            raise ValueError("Invalid manifest JSON.")

    def value(self, *, keep=False, depth=0, array_callback=None, object_callback=None):
        if depth > 64:
            raise ValueError("Manifest nesting exceeds its limit.")
        self.whitespace()
        token = self.peek()
        if token == "{":
            self.take()
            result = {}
            self.whitespace()
            if self.peek() == "}":
                self.take()
                return result if keep else None
            while True:
                if self.peek() != '"':
                    raise ValueError("Invalid manifest object key.")
                key = self.scalar()
                self.expect(":")
                if object_callback:
                    object_callback(key, self, depth + 1)
                else:
                    value = self.value(keep=keep, depth=depth + 1)
                    if keep:
                        result[key] = value
                self.whitespace()
                end = self.take()
                if end == "}":
                    return result if keep else None
                if end != ",":
                    raise ValueError("Invalid manifest object.")
                self.whitespace()
        if token == "[":
            self.take()
            result, count = [], 0
            self.whitespace()
            if self.peek() == "]":
                self.take()
                return result if keep else 0
            while True:
                if array_callback:
                    array_callback(self, depth + 1)
                else:
                    value = self.value(keep=keep, depth=depth + 1)
                    if keep:
                        result.append(value)
                count += 1
                self.whitespace()
                end = self.take()
                if end == "]":
                    return result if keep else count
                if end != ",":
                    raise ValueError("Invalid manifest array.")
        return self.scalar(keep=keep)

    def scalar(self, *, keep=True):
        # A manifest is at most four MiB, but individual metadata scalars are
        # capped as well so dense/nested JSON cannot consume the whole workspace.
        raw = []
        if self.peek() == '"':
            self.take()
            if keep:
                raw.append('"')
            escaped = False
            unicode_digits = 0
            while True:
                token = self.take()
                if not token:
                    raise ValueError("Unclosed manifest string.")
                if keep:
                    raw.append(token)
                if keep and len(raw) > 65536:
                    raise ValueError("Manifest scalar exceeds its limit.")
                if unicode_digits:
                    if token not in "0123456789abcdefABCDEF":
                        raise ValueError("Invalid manifest Unicode escape.")
                    unicode_digits -= 1
                    continue
                if escaped:
                    if token not in '"\\/bfnrtu':
                        raise ValueError("Invalid manifest escape.")
                    unicode_digits = 4 if token == "u" else 0
                    escaped = False
                    continue
                if ord(token) < 32:
                    raise ValueError("Invalid manifest control character.")
                if token == '"':
                    break
                escaped = token == "\\"
            return json.loads("".join(raw)) if keep else None
        else:
            while self.peek() and self.peek() not in " \t\r\n,]}":
                raw.append(self.take())
                if len(raw) > 128:
                    raise ValueError("Invalid manifest scalar.")
        def reject_constant(_value):
            raise ValueError("Non-JSON manifest number.")
        value = json.loads("".join(raw), parse_constant=reject_constant)
        return value if keep else None


def read_manifest(source, max_assets):
    reader = _Reader(source)
    result = {}

    def field(key, cursor, depth):
        cursor.whitespace()
        if key == "version":
            if cursor.peek() == '"':
                result[key] = cursor.value(keep=True, depth=depth)
            else:
                cursor.value(depth=depth)
        elif key == "messages" and cursor.peek() == "[":
            result["message_count"] = cursor.value(depth=depth)
            result["messages"] = []
        elif key == "assets" and cursor.peek() == "[":
            assets = []

            def asset(item, nesting):
                if len(assets) >= max_assets:
                    raise ValueError("Too many manifest assets.")
                projected = {}

                def asset_field(name, value_reader, field_depth):
                    value_reader.whitespace()
                    keep = name in {"path", "width", "height", "kind"} and value_reader.peek() not in {"{", "["}
                    projected_value = value_reader.value(keep=keep, depth=field_depth)
                    if keep:
                        projected[name] = projected_value

                item.whitespace()
                if item.peek() == "{":
                    item.value(depth=nesting, object_callback=asset_field)
                    assets.append(projected)
                else:
                    item.value(depth=nesting)
            cursor.value(depth=depth, array_callback=asset)
            result["assets"] = assets
        else:
            cursor.value(depth=depth)

    reader.whitespace()
    if reader.peek() != "{":
        return None
    reader.value(object_callback=field)
    reader.whitespace()
    if reader.peek():
        raise ValueError("Trailing manifest data.")
    return result
