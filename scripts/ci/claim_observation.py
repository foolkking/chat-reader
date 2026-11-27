"""Diagnostic branch only. Do not substitute these timings for release qualification."""
from contextlib import contextmanager
import faulthandler
import gc
import json
import os
from pathlib import Path
import re
import tempfile
import threading
import time

import psycopg
from sqlalchemy import event
from sqlalchemy.engine import Engine
from app.services import worker_supervisor as worker


@contextmanager
def sample(test):
    url = os.environ["DATABASE_URL"]
    assert os.environ["APP_ENV"] == "test" and "127.0.0.1:65438/" in url
    base = time.monotonic()
    tick = lambda: round((time.monotonic() - base) * 1000, 1)
    gcs, claims, sql, server, signals = [], [], [], [], []
    current = [False]
    stop = threading.Event()

    def watch_db():
        try:
            with psycopg.connect(url.replace("postgresql+psycopg:", "postgresql:", 1),
                                 autocommit=True, connect_timeout=3,
                                 options="-c default_transaction_read_only=on -c statement_timeout=1000") as db:
                while not stop.wait(.10):
                    if current[0] and len(server) < 120:
                        rows = db.execute("""SELECT state, wait_event_type, wait_event FROM pg_stat_activity
                            WHERE datname LIKE 'settings_formats_%' AND backend_type='client backend'""").fetchall()
                        server.append([tick(), rows])
        except Exception as ex:
            signals.append(type(ex).__name__)

    def collect(phase, info):
        if phase == "start":
            starts[info["generation"]] = tick()
        else:
            first = starts.pop(info["generation"], None)
            if first is not None and tick() - first > 50:
                gcs.append([first, tick(), info["generation"], info["collected"]])

    def before(_conn, _cur, statement, _params, ctx, _many):
        if current[0]:
            ctx._claim_probe = [tick(), statement.lstrip().split(None, 1)[0].upper()]

    def after(_conn, _cur, _stmt, _params, ctx, _many):
        if hasattr(ctx, "_claim_probe"):
            begin, verb = ctx._claim_probe
            sql.append([begin, tick(), verb])

    original, main_thread = worker.claim, threading.get_ident()
    starts = {}
    observer = threading.Thread(target=watch_db, daemon=True)
    with tempfile.TemporaryFile(dir=os.environ["RUNNER_TEMP"]) as stacks:
        def timed(*args, **kwargs):
            current[0] = True
            begin, cpu = tick(), time.process_time()
            faulthandler.dump_traceback_later(.24, repeat=True, file=stacks)
            try:
                return original(*args, **kwargs)
            finally:
                faulthandler.cancel_dump_traceback_later()
                current[0] = False
                claims.append([begin, tick(), round(1000 * (time.process_time() - cpu), 1)])

        event.listen(Engine, "before_cursor_execute", before)
        event.listen(Engine, "after_cursor_execute", after)
        gc.callbacks.append(collect)
        observer.start()
        worker.claim = timed
        try:
            yield
        finally:
            worker.claim = original
            stop.set()
            gc.callbacks.remove(collect)
            event.remove(Engine, "before_cursor_execute", before)
            event.remove(Engine, "after_cursor_execute", after)
            observer.join(2)
            stacks.seek(0)
            active, frames = False, []
            for line in stacks.read(2 << 20).decode("utf8", "replace").splitlines():
                thread = re.match(r"(?:Current thread|Thread) (0x[0-9a-f]+)", line)
                if thread:
                    active = int(thread[1], 16) == main_thread
                    if active:
                        frames.append([])
                    continue
                frame = re.match(r'  File "([^"]+)", line (\d+) in (.+)', line)
                if active and frame and len(frames[-1]) < 16:
                    frames[-1].append(f"{Path(frame[1]).name}:{frame[2]}:{frame[3]}")
            print("CLAIM_OBSERVATION " + json.dumps(dict(case=test, claims=claims, sql=sql, gc=gcs,
                                                          db=server, observer=signals, frames=frames)))
