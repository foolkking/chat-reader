import time


class WorkerShutdown:
    """Cooperative drain flag; signal handlers must not take locks or do I/O."""

    def __init__(self) -> None:
        self.requested = False

    def request(self, _signum: int, _frame: object | None) -> None:
        self.requested = True

    def wait(self, seconds: float) -> None:
        # Preserve the database polling deadline while observing a signal even
        # when Python restarts a sleep. Event.set() from a signal handler could
        # re-enter a lock held by the interrupted main thread.
        deadline = time.monotonic() + seconds
        while not self.requested:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(0.25, remaining))
