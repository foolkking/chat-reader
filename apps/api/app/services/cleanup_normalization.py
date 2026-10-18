"""Full normalization keys with provenance; never normalize canonical source."""
from array import array
from collections.abc import Iterable, Iterator, Sequence
import unicodedata


class _CompactSpans(Sequence[tuple[int, int]]):
    """Operation-local provenance without one Python tuple/int pair per character."""
    def __init__(self):
        self._values = array("Q")

    def __len__(self) -> int:
        return len(self._values) // 2

    def __getitem__(self, index):
        if isinstance(index, slice):
            return [self[item] for item in range(*index.indices(len(self)))]
        if index < 0:
            index += len(self)
        if not 0 <= index < len(self):
            raise IndexError(index)
        return self._values[index * 2], self._values[index * 2 + 1]

    def __setitem__(self, index: int, span: tuple[int, int]) -> None:
        if index < 0:
            index += len(self)
        if not 0 <= index < len(self):
            raise IndexError(index)
        self._values[index * 2], self._values[index * 2 + 1] = span

    def append(self, span: tuple[int, int]) -> None:
        self._values.extend(span)


def _ordered_decomposition(text: str, form: str) -> Iterator[tuple[str, int]]:
    # Bucket non-starters by canonical combining class, preserving equal-class
    # order. Classes are bounded to 0..255: no quadratic insertion ordering of
    # an arbitrarily long, adversarial combining sequence.
    pending: dict[int, list[tuple[str, int]]] = {}
    for origin, char in enumerate(text):
        for part in char if char.isascii() else unicodedata.normalize(form, char):
            combining_class = unicodedata.combining(part)
            if combining_class:
                pending.setdefault(combining_class, []).append((part, origin))
            else:
                for key in sorted(pending):
                    yield from pending[key]
                pending.clear()
                yield part, origin
    for key in sorted(pending):
        yield from pending[key]


def _nfkc_with_spans(text: str) -> tuple[str, Iterable[tuple[int, int]]]:
    if text.isascii() or unicodedata.is_normalized("NFKC", text):
        return text, ((index, index + 1) for index in range(len(text)))
    # NFC is given already canonically ordered NFKD, not unordered input.
    # Let the standard library own composition (including Hangul and CCC=0).
    origins = array("Q")

    def atoms() -> Iterator[str]:
        for char, origin in _ordered_decomposition(text, "NFKD"):
            origins.append(origin)
            yield char

    decomposed = "".join(atoms())
    normalized = unicodedata.normalize("NFC", decomposed)
    spans = [(len(text), 0)] * len(normalized)
    # NFKD(input) == NFD(NFKC(input)). Align their ordered decomposition atoms
    # rather than assuming a composed character consumes consecutive atoms:
    # composition can span a lower-class, uncomposed mark. Retain compact raw
    # origins from the first pass, not a second full decomposition/tuple stream.
    for original_char, origin, (normalized_char, target) in zip(
        decomposed, origins,
        _ordered_decomposition(normalized, "NFD"),
        strict=True,
    ):
        if original_char != normalized_char:
            raise ValueError("Unicode cleanup normalization provenance is inconsistent.")
        left, right = spans[target]
        spans[target] = (min(left, origin), max(right, origin + 1))
    return normalized, spans


def normalized_shadow(
    text: str, *, case_sensitive: bool, compact: bool = False,
) -> tuple[str, Sequence[tuple[int, int]]]:
    normalized, spans = _nfkc_with_spans(text)
    output: list[str] = []
    mapping = _CompactSpans() if compact else []
    for char, span in zip(normalized, spans, strict=True):
        for item in char if case_sensitive else char.casefold():
            if item.isspace():
                item = " "
            if item == " " and output and output[-1] == " ":
                previous = mapping[-1]
                mapping[-1] = (min(previous[0], span[0]), max(previous[1], span[1]))
            else:
                output.append(item)
                mapping.append(span)
    return "".join(output), mapping


def source_span(mapping: Sequence[tuple[int, int]], start: int, end: int) -> tuple[int, int]:
    """Smallest contiguous raw envelope; reordered atoms need not be monotonic."""
    if not 0 <= start < end <= len(mapping):
        raise ValueError("Unicode cleanup match range is invalid.")
    left, right = mapping[start]
    for index in range(start + 1, end):
        span = mapping[index]
        left, right = min(left, span[0]), max(right, span[1])
    return left, right
