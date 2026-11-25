"""Exercise the Windows ABI with fake system calls, including on Linux CI."""
import ctypes
from types import SimpleNamespace

import pytest

from app.core import memory


def _probe(monkeypatch, *, failure=False):
    counter_types, status_types = set(), set()

    def process_info(handle, pointer, length):
        assert handle == 42
        counter = pointer._obj
        assert length == ctypes.sizeof(counter) == counter.cb
        counter_types.add(type(counter))
        counter.WorkingSetSize = 123 * 1024**2
        return not failure

    def status_info(pointer):
        status = pointer._obj
        assert ctypes.sizeof(status) == status.length == 64
        status_types.add(type(status))
        status.available_physical = 234 * 1024**2
        status.total_physical = 1024**3
        return not failure

    monkeypatch.setattr(memory, "sys", SimpleNamespace(platform="win32"))
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(
        kernel32=SimpleNamespace(GetCurrentProcess=lambda: 42, GlobalMemoryStatusEx=status_info),
        psapi=SimpleNamespace(GetProcessMemoryInfo=process_info),
    ), raising=False)
    return counter_types, status_types


def test_repeated_windows_probes_reuse_types_instead_of_leaking_pointer_classes(monkeypatch):
    counter_types, status_types = _probe(monkeypatch)
    pointer_types = set()
    for _ in range(20000):
        assert memory.process_resident_memory_bytes() == 123 * 1024**2
        assert memory.available_memory_bytes() == 234 * 1024**2
        assert memory.effective_total_memory_bytes() == 1024**3
        pointer_types.add(ctypes.windll.psapi.GetProcessMemoryInfo.argtypes[1])
    assert len(counter_types) == len(status_types) == len(pointer_types) == 1


@pytest.mark.parametrize("probe", [
    memory.process_resident_memory_bytes,
    memory.available_memory_bytes,
    memory.effective_total_memory_bytes,
])
def test_windows_probe_failure_is_unknown_not_zero(monkeypatch, probe):
    _probe(monkeypatch, failure=True)
    assert probe() is None


def test_windows_library_unavailable_is_unknown(monkeypatch):
    _probe(monkeypatch)
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace())
    assert memory.process_resident_memory_bytes() is None
    assert memory.available_memory_bytes() is None
    assert memory.effective_total_memory_bytes() is None
