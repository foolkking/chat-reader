import signal

from app.workers.shutdown import WorkerShutdown


def main() -> None:
    shutdown = WorkerShutdown()
    previous = {}
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, shutdown.request)
        # Install handlers before importing the ORM/services so a stop received
        # during startup is remembered rather than ignored by Linux PID 1.
        from app.services.task_worker import run_task_worker_forever

        run_task_worker_forever(shutdown=shutdown)
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    main()
