"""Dependency-free memory probe, shared by admission and operator commands."""
from pathlib import PurePosixPath
import sys


def process_resident_memory_bytes() -> int | None:
    """Current RSS, not a historical peak or virtual address-space size."""
    if sys.platform.startswith("linux"):
        try:
            with open("/proc/self/status", encoding="ascii") as handle:
                for line in handle:
                    if line.startswith("VmRSS:"):
                        return int(line.split()[1]) * 1024
        except (OSError, ValueError, IndexError):
            return None
    elif sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                *[(name, ctypes.c_size_t) for name in (
                    "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage",
                    "QuotaPagedPoolUsage", "QuotaPeakNonPagedPoolUsage",
                    "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
                )],
            ]
        counters = Counters()
        counters.cb = ctypes.sizeof(counters)
        try:
            kernel = ctypes.windll.kernel32
            kernel.GetCurrentProcess.restype = wintypes.HANDLE
            probe = ctypes.windll.psapi.GetProcessMemoryInfo
            probe.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
            if probe(kernel.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
                return int(counters.WorkingSetSize)
        except (AttributeError, OSError):
            return None
    return None


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


def effective_total_memory_bytes() -> int | None:
    """Physical capacity constrained by every visible finite cgroup ancestor.

    Availability and capacity are deliberately separate. Swap and reclaimable
    cache are never added to either admission budget.
    """
    if sys.platform == "win32":
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong),
                        *[(name, ctypes.c_ulonglong) for name in (
                            "total", "available", "page_total", "page_available",
                            "virtual_total", "virtual_available", "extended")]]
        status = Status()
        status.length = ctypes.sizeof(status)
        try:
            if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
                return int(status.total)
        except (AttributeError, OSError):
            return None
        return None
    if not sys.platform.startswith("linux"):
        return None
    try:
        with open("/proc/meminfo", encoding="ascii") as handle:
            total = next(int(line.split()[1]) * 1024 for line in handle if line.startswith("MemTotal:"))
    except (OSError, ValueError, StopIteration, IndexError):
        return None
    try:
        limit = _linux_cgroup_available_bytes(capacity=True)
    except (OSError, ValueError):
        return None
    return min(total, limit) if limit is not None else total


def _linux_host_available_bytes() -> int | None:
    try:
        with open("/proc/meminfo", encoding="ascii") as handle:
            for line in handle:
                if line.startswith("MemAvailable:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        return None
    return None


def _linux_cgroup_available_bytes(*, capacity: bool = False) -> int | None:
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
        if capacity:
            raise
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
    matched_memory_mount = False
    for row in mount_rows:
        try:
            left, right = row.split(" - ", 1)
            mount_fields = left.split()
            filesystem_fields = right.split()
            filesystem = filesystem_fields[0]
            if filesystem not in {"cgroup", "cgroup2"}:
                continue
            # v1 has separate controller mounts. A CPU-only mount is not an
            # inaccessible memory controller, and must not make capacity unknown.
            if filesystem == "cgroup" and "memory" not in filesystem_fields[2].split(","):
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

        matched_memory_mount = True
        current_dir = mount_point / relative
        while True:
            try:
                if filesystem == "cgroup2":
                    with open(current_dir / "memory.max", encoding="ascii") as handle:
                        limit_text = handle.read().strip()
                    usage_text = "0"
                    if not capacity:
                        with open(current_dir / "memory.current", encoding="ascii") as handle:
                            usage_text = handle.read().strip()
                    if limit_text != "max":
                        limit = int(limit_text)
                        usage = int(usage_text)
                        # A very large value is the conventional cgroup-v1
                        # unlimited sentinel and can also occur in emulation.
                        if limit < 0 or usage < 0:
                            raise ValueError("Invalid cgroup memory counter.")
                        if limit < (1 << 60):
                            available = limit if capacity else max(0, limit - usage)
                            tightest = available if tightest is None else min(tightest, available)
                else:
                    with open(current_dir / "memory.limit_in_bytes", encoding="ascii") as handle:
                        limit_text = handle.read().strip()
                    usage_text = "0"
                    if not capacity:
                        with open(current_dir / "memory.usage_in_bytes", encoding="ascii") as handle:
                            usage_text = handle.read().strip()
                    limit = int(limit_text)
                    usage = int(usage_text)
                    if limit < 0 or usage < 0:
                        raise ValueError("Invalid cgroup memory counter.")
                    if limit < (1 << 60):
                        available = limit if capacity else max(0, limit - usage)
                        tightest = available if tightest is None else min(tightest, available)
            except FileNotFoundError:
                # The real v2 hierarchy root has no memory.max. It is only
                # unlimited when /proc actually exposes that root; a missing
                # container/descendant control file is still an unknown probe.
                if filesystem == "cgroup2" and mount_root == PurePosixPath("/") and current_dir == mount_point:
                    break
                if capacity:
                    raise
                break
            except (OSError, ValueError):
                if capacity:
                    raise
                break

            if current_dir == mount_point:
                break
            parent = current_dir.parent
            if mount_point not in parent.parents and parent != mount_point:
                break
            current_dir = parent
    if capacity and process_groups and not matched_memory_mount:
        # An advertised controller with no readable matching mount is unknown,
        # not proof that the process may use all host memory.
        raise OSError("The cgroup memory mount could not be resolved.")
    return tightest
