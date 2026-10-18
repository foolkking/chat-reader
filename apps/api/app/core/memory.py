"""Dependency-free memory probe, shared by admission and operator commands."""
from pathlib import PurePosixPath
import sys


def available_memory_bytes() -> int | None:
    if sys.platform.startswith("linux"):
        host_available = _linux_host_available_bytes()
        cgroup_available = _linux_cgroup_available_bytes()
        if host_available is None:
            return cgroup_available
        if cgroup_available is None:
            return host_available
        return min(host_available, cgroup_available)
    if sys.platform == "win32":
        import ctypes

        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong), ("memory_load", ctypes.c_ulong),
                ("total_physical", ctypes.c_ulonglong), ("available_physical", ctypes.c_ulonglong),
                ("total_page_file", ctypes.c_ulonglong), ("available_page_file", ctypes.c_ulonglong),
                ("total_virtual", ctypes.c_ulonglong), ("available_virtual", ctypes.c_ulonglong),
                ("available_extended_virtual", ctypes.c_ulonglong),
            ]
        status = MemoryStatus()
        status.length = ctypes.sizeof(MemoryStatus)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.available_physical)
        except (AttributeError, OSError):
            return None
    return None


def _linux_host_available_bytes() -> int | None:
    try:
        with open("/proc/meminfo", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _linux_cgroup_available_bytes() -> int | None:
    """Return the tightest visible cgroup memory headroom, when limited.

    `/proc/meminfo` reports host memory inside many containers. Prefer the
    smaller cgroup headroom so an import cannot be admitted based on memory
    the process is not allowed to use. Walk ancestors as a parent slice may
    impose a tighter limit than the process leaf.
    """
    try:
        with open("/proc/self/cgroup", encoding="ascii") as handle:
            cgroup_rows = handle.read().splitlines()
        with open("/proc/self/mountinfo", encoding="ascii") as handle:
            mount_rows = handle.read().splitlines()
    except OSError:
        return None

    process_groups: list[tuple[str, str]] = []
    for row in cgroup_rows:
        parts = row.split(":", 2)
        if len(parts) != 3:
            continue
        controllers, group_path = parts[1], parts[2]
        if not controllers:
            process_groups.append(("cgroup2", group_path))
        elif "memory" in controllers.split(","):
            process_groups.append(("cgroup", group_path))

    tightest: int | None = None
    for row in mount_rows:
        try:
            left, right = row.split(" - ", 1)
            mount_fields = left.split()
            filesystem_fields = right.split()
            filesystem = filesystem_fields[0]
            if filesystem not in {"cgroup", "cgroup2"}:
                continue
            mount_root = PurePosixPath(mount_fields[3])
            mount_point = PurePosixPath(mount_fields[4])
            group_path = next(
                path for kind, path in process_groups if kind == filesystem
            )
            process_path = PurePosixPath(group_path)
            relative = process_path.relative_to(mount_root)
        except (IndexError, StopIteration, ValueError):
            continue

        current_dir = mount_point / relative
        while True:
            try:
                if filesystem == "cgroup2":
                    with open(current_dir / "memory.max", encoding="ascii") as handle:
                        limit_text = handle.read().strip()
                    with open(current_dir / "memory.current", encoding="ascii") as handle:
                        usage_text = handle.read().strip()
                    if limit_text != "max":
                        limit = int(limit_text)
                        usage = int(usage_text)
                        # A very large value is the conventional cgroup-v1
                        # unlimited sentinel and can also occur in emulation.
                        if 0 < limit < (1 << 60):
                            available = max(0, limit - usage)
                            tightest = available if tightest is None else min(tightest, available)
                else:
                    with open(current_dir / "memory.limit_in_bytes", encoding="ascii") as handle:
                        limit_text = handle.read().strip()
                    with open(current_dir / "memory.usage_in_bytes", encoding="ascii") as handle:
                        usage_text = handle.read().strip()
                    limit = int(limit_text)
                    usage = int(usage_text)
                    if 0 < limit < (1 << 60):
                        available = max(0, limit - usage)
                        tightest = available if tightest is None else min(tightest, available)
            except (OSError, ValueError):
                break

            if current_dir == mount_point:
                break
            parent = current_dir.parent
            if mount_point not in parent.parents and parent != mount_point:
                break
            current_dir = parent
    return tightest
