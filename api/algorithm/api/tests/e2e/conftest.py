"""Start the real ASGI service with isolated persistent storage."""
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def service(tmp_path):
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = {"PATH": os.environ.get("PATH", ""), "DATABASE_PATH": str(tmp_path / "test.sqlite3"), "API_KEY": "test-key", "PYTHONPATH": str(ROOT / "src")}
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "algorithm_api.app:app", "--host", "127.0.0.1", "--port", str(port)], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10)
    try:
        for _ in range(100):
            if proc.poll() is not None:
                pytest.fail("uvicorn exited during startup")
            try:
                if client.get("/health").status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(.05)
        else:
            pytest.fail("uvicorn did not start")
        yield client, env, port
    finally:
        client.close()
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
