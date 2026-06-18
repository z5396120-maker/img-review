#!/usr/bin/env python3
"""Start or reuse an Img Review session and print its browser URL."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_PORT = 54451


def plugin_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_session_dir() -> Path:
    return Path.cwd().resolve() / ".img-review" / "inbox"


def request_json(url: str, payload: dict | None = None, timeout: float = 0.7) -> dict | None:
    try:
        data = None
        headers = {}
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
        return json.loads(body)
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def is_img_review(url: str) -> bool:
    data = request_json(f"{url}/api/session")
    return isinstance(data, dict) and "assets" in data


def port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex((host, port)) != 0


def choose_port(host: str, preferred: int) -> int:
    if preferred and port_available(host, preferred):
        return preferred
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def wait_for_server(url: str, timeout: float = 5.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if is_img_review(url):
            return True
        time.sleep(0.12)
    return False


def candidate_urls(host: str, port: int) -> list[str]:
    hosts = [host]
    if host == "127.0.0.1":
        hosts.append("localhost")
    elif host == "localhost":
        hosts.append("127.0.0.1")
    return [f"http://{item}:{port}" for item in hosts]


def upload_image(url: str, image: Path) -> None:
    mime_type = mimetypes.guess_type(image.name)[0] or "image/png"
    encoded = base64.b64encode(image.read_bytes()).decode("ascii")
    payload = {
        "name": image.name,
        "dataUrl": f"data:{mime_type};base64,{encoded}",
    }
    result = request_json(f"{url}/api/assets", payload=payload, timeout=5)
    if not result or not result.get("id"):
        raise RuntimeError(f"Could not add image to Img Review: {image}")


def start_server(args: argparse.Namespace, session_dir: Path, images: list[Path]) -> tuple[str, int]:
    port = choose_port(args.host, args.port)
    url = f"http://{args.host}:{port}"
    session_dir.mkdir(parents=True, exist_ok=True)
    log_path = session_dir / "img-review-server.log"
    command = [
        sys.executable,
        str(plugin_root() / "scripts" / "img_review_server.py"),
        "--session-dir",
        str(session_dir),
        "--host",
        args.host,
        "--port",
        str(port),
    ]
    for image in images:
        command.extend(["--image", str(image)])
    with log_path.open("ab") as log_file:
        process = subprocess.Popen(
            command,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    if not wait_for_server(url):
        raise RuntimeError(f"Img Review did not start. See {log_path}")
    return url, process.pid


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", nargs="*", help="Optional images to add to the review")
    parser.add_argument("--image", action="append", default=[], help="Image to add to the review")
    parser.add_argument("--session-dir", default=None, help="Review session directory")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--fresh", action="store_true", help="Start a fresh server even if the preferred URL is healthy")
    parser.add_argument("--json", action="store_true", help="Print machine-readable launch info")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    session_dir = Path(args.session_dir).expanduser().resolve() if args.session_dir else default_session_dir()
    images = [Path(value).expanduser().resolve() for value in [*args.image, *args.images]]
    for image in images:
        if not image.is_file():
            print(f"Image not found: {image}", file=sys.stderr)
            return 2

    reused = False
    pid = None
    healthy_url = None
    if not args.fresh and args.port:
        healthy_url = next((url for url in candidate_urls(args.host, args.port) if is_img_review(url)), None)
    if healthy_url:
        url = healthy_url
        reused = True
        for image in images:
            upload_image(url, image)
    else:
        url, pid = start_server(args, session_dir, images)

    state = {
        "url": url,
        "sessionDir": str(session_dir),
        "reused": reused,
        "pid": pid,
        "openInCodexBrowser": f"Open {url} in the Codex in-app Browser.",
    }
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "img-review-launch.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    if args.json:
        print(json.dumps(state, indent=2))
    else:
        print(f"Img Review: {url}")
        print(f"Session: {session_dir}")
        print("Open this URL in the Codex in-app Browser.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
