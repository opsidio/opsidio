"""Bound event simulation to one disposable child and finite JSON IPC."""

import json
import logging
import multiprocessing
import select
import socket
import time

from .engine import ComputationTimeout

MAX_RESULT_BYTES = 16 * 1024 * 1024


def _worker(sender, document_json: str, settings_json: str, deadline: float) -> None:
    try:
        from .event_engine import simulate_event
        result = simulate_event(json.loads(document_json), json.loads(settings_json), deadline=deadline)
        message = {"result": result}
    except ComputationTimeout:
        message = {"error": "computation_timeout"}
    except BaseException:
        logging.getLogger(__name__).exception("Event simulation child failed")
        message = {"error": "computation_failed"}
    try:
        payload = json.dumps(message, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
        if len(payload) > MAX_RESULT_BYTES:
            payload = b'{"error":"result_too_large"}'
        sender.sendall(payload)
    finally:
        sender.close()


def compute_event(document: dict, resolved_settings: dict, *, deadline: float) -> dict:
    if deadline <= time.monotonic():
        raise ComputationTimeout()
    document_json = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    settings_json = json.dumps(resolved_settings, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    context = multiprocessing.get_context("spawn")
    receiver, sender = socket.socketpair()
    receiver.setblocking(False)
    process = context.Process(target=_worker, args=(sender, document_json, settings_json, deadline), daemon=True)
    started = False
    try:
        process.start()
        started = True
        sender.close()
        payload = bytearray()
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise ComputationTimeout()
            ready, _, _ = select.select([receiver], [], [], min(remaining, .02))
            if ready:
                chunk = receiver.recv(65536)
                if not chunk:
                    break
                payload.extend(chunk)
                if len(payload) > MAX_RESULT_BYTES:
                    raise RuntimeError("Event simulation child response exceeds size limit")
            elif not process.is_alive():
                raise RuntimeError("Event simulation child exited without a result")
        try:
            message = json.loads(payload)
        except (ValueError, UnicodeError) as exc:
            raise RuntimeError("Invalid event simulation child response") from exc
        if not isinstance(message, dict):
            raise RuntimeError("Invalid event simulation child response")
        if time.monotonic() >= deadline or message.get("error") == "computation_timeout":
            raise ComputationTimeout()
        if "error" in message or not isinstance(message.get("result"), dict):
            raise RuntimeError("Event simulation child failed")
        process.join(timeout=max(0, deadline - time.monotonic()))
        if process.is_alive():
            raise ComputationTimeout()
        if process.exitcode != 0:
            raise RuntimeError("Event simulation child exited unsuccessfully")
        return message["result"]
    finally:
        if started:
            if process.is_alive():
                process.terminate()
                process.join(timeout=.2)
            if process.is_alive():
                process.kill()
            process.join()
            process.close()
        receiver.close()
        sender.close()
