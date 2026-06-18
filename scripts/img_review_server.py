#!/usr/bin/env python3
"""Dependency-free local server for the Img Review annotation canvas."""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

MAX_BODY = 40 * 1024 * 1024
SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def safe_name(value: str) -> str:
    raw = Path(value).name
    suffix = Path(raw).suffix
    stem = raw.removesuffix(suffix)
    clean_stem = SAFE_NAME.sub("-", stem).strip(".-") or "asset"
    clean_suffix = SAFE_NAME.sub("", suffix).lower()
    return f"{clean_stem}{clean_suffix}"


def unique_path(directory: Path, name: str) -> Path:
    candidate = directory / safe_name(name)
    stem, suffix = candidate.stem, candidate.suffix
    counter = 2
    while candidate.exists():
        candidate = directory / f"{stem}-{counter}{suffix}"
        counter += 1
    return candidate


def asset_record(path: Path) -> dict[str, str]:
    return {
        "id": path.name,
        "name": path.name,
        "url": f"/session-assets/{path.name}",
    }


def write_review_markdown(payload: dict, destination: Path) -> None:
    title = payload.get("title") or "Img Review"
    assets = {item.get("id"): item.get("name") for item in payload.get("assets", [])}
    annotations = payload.get("annotations", [])
    lines = [f"# {title}", "", f"Saved: {payload.get('savedAt', 'unknown')}", ""]
    if not annotations:
        lines.append("No annotations were saved.")
    for index, item in enumerate(annotations, 1):
        asset = assets.get(item.get("assetId"), item.get("assetId", "unknown asset"))
        kind = item.get("type", "mark")
        comment = str(item.get("comment") or "No comment").strip()
        geometry = json.dumps(item.get("geometry", {}), separators=(",", ":"))
        transform = json.dumps(item.get("transform", {}), separators=(",", ":"))
        lines.extend([
            f"## {index}. {asset}",
            "",
            f"- Type: `{kind}`",
            f"- Comment: {comment}",
            f"- Geometry: `{geometry}`",
            f"- Transform: `{transform}`",
            "",
        ])
    destination.write_text("\n".join(lines), encoding="utf-8")


def build_ai_task(payload: dict, assets_dir: Path) -> dict:
    assets = []
    for item in payload.get("assets", []):
        name = safe_name(str(item.get("id") or item.get("name") or "asset"))
        assets.append({
            "id": item.get("id"),
            "name": item.get("name") or name,
            "path": str((assets_dir / name).resolve()),
        })
    annotations = []
    for item in payload.get("annotations", []):
        annotation = dict(item)
        if not str(annotation.get("comment") or "").strip():
            transform = annotation.get("transform") or {}
            changed = any([
                abs(float(transform.get("translateX", 0))) > 0.0001,
                abs(float(transform.get("translateY", 0))) > 0.0001,
                abs(float(transform.get("scale", 1)) - 1) > 0.0001,
                abs(float(transform.get("rotation", 0))) > 0.01,
            ])
            annotation["inferredIntent"] = (
                "Apply the demonstrated move, scale, and rotation to this selected element."
                if changed else
                "Use this spatial selection as visual context; infer the requested treatment from the mark type and surrounding review."
            )
        annotations.append(annotation)
    return {
        "schemaVersion": 1,
        "status": "ready_for_ai",
        "title": payload.get("title") or "Img Review",
        "instructions": [
            "Apply every annotation to its referenced source asset.",
            "Use geometry as normalized coordinates from the source image top-left.",
            "For magic selections, use the closed paths as the exact affected region.",
            "Apply transform values to the selected visual element, not the annotation overlay.",
            "Preserve unmarked content unless a comment explicitly requests a global change.",
            "Write revisions to new files and visually verify the result.",
        ],
        "assets": assets,
        "annotations": annotations,
        "submittedAt": payload.get("savedAt"),
    }


def write_ai_task_markdown(task: dict, destination: Path) -> None:
    asset_names = {item.get("id"): item.get("name") for item in task.get("assets", [])}
    lines = [
        f"# {task.get('title', 'Img Review')}",
        "",
        "This is an executable visual-edit task for Codex.",
        "",
        "## Source assets",
        "",
    ]
    for asset in task.get("assets", []):
        lines.append(f"- `{asset.get('path')}`")
    lines.extend(["", "## Requested changes", ""])
    for index, item in enumerate(task.get("annotations", []), 1):
        lines.extend([
            f"### {index}. {asset_names.get(item.get('assetId'), item.get('assetId', 'asset'))}",
            "",
            f"- Intent: {str(item.get('comment') or item.get('inferredIntent') or 'No written instruction').strip()}",
            f"- Selection type: `{item.get('type', 'mark')}`",
            f"- Geometry: `{json.dumps(item.get('geometry', {}), ensure_ascii=False, separators=(',', ':'))}`",
            f"- Target transform: `{json.dumps(item.get('transform', {}), ensure_ascii=False, separators=(',', ':'))}`",
            "",
        ])
    lines.extend(["## Execution rules", ""])
    lines.extend(f"- {instruction}" for instruction in task.get("instructions", []))
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def remove_asset_from_payload(payload: dict, asset_id: str) -> dict:
    updated = dict(payload)
    updated["assets"] = [item for item in payload.get("assets", []) if item.get("id") != asset_id]
    updated["annotations"] = [
        item for item in payload.get("annotations", []) if item.get("assetId") != asset_id
    ]
    return updated


class ReviewHandler(BaseHTTPRequestHandler):
    server_version = "ImgReview/0.1"

    @property
    def app(self):
        return self.server.app  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"[img-review] {fmt % args}\n")

    def send_json(self, data: object, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path) -> None:
        if not path.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        body = path.read_bytes()
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY:
            raise ValueError("Invalid request size")
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def do_GET(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/session":
            assets = [asset_record(path) for path in sorted(self.app.assets_dir.iterdir()) if path.is_file()]
            saved = None
            if self.app.annotations_file.exists():
                saved = json.loads(self.app.annotations_file.read_text(encoding="utf-8"))
            self.send_json({"assets": assets, "saved": saved})
            return
        if route.startswith("/session-assets/"):
            name = safe_name(unquote(route.removeprefix("/session-assets/")))
            self.send_file(self.app.assets_dir / name)
            return
        static_name = "index.html" if route in ("/", "/index.html") else route.lstrip("/")
        if "/" in static_name or static_name.startswith("."):
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        self.send_file(self.app.assets_root / static_name)

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        try:
            payload = self.read_json()
            if route == "/api/assets":
                data_url = payload.get("dataUrl", "")
                header, encoded = data_url.split(",", 1)
                if not header.startswith("data:image/") or ";base64" not in header:
                    raise ValueError("Only base64 image uploads are supported")
                raw = base64.b64decode(encoded, validate=True)
                if len(raw) > MAX_BODY:
                    raise ValueError("Image is too large")
                destination = unique_path(self.app.assets_dir, payload.get("name", "asset.png"))
                destination.write_bytes(raw)
                self.send_json(asset_record(destination), HTTPStatus.CREATED)
                return
            if route == "/api/assets/remove":
                asset_id = str(payload.get("id") or "")
                name = safe_name(asset_id)
                destination = self.app.assets_dir / name
                if not name or not destination.is_file():
                    raise ValueError("Image not found")
                destination.unlink()
                if self.app.annotations_file.exists():
                    saved = json.loads(self.app.annotations_file.read_text(encoding="utf-8"))
                    saved = remove_asset_from_payload(saved, asset_id)
                    self.app.annotations_file.write_text(
                        json.dumps(saved, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                    write_review_markdown(saved, self.app.review_file)
                    task = build_ai_task(saved, self.app.assets_dir)
                    self.app.ai_task_file.write_text(
                        json.dumps(task, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                    )
                    write_ai_task_markdown(task, self.app.ai_task_markdown_file)
                self.send_json({"ok": True, "id": asset_id, "name": name})
                return
            if route == "/api/annotations":
                payload["savedAt"] = datetime.now(timezone.utc).isoformat()
                self.app.annotations_file.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                write_review_markdown(payload, self.app.review_file)
                self.send_json({"ok": True, "annotations": len(payload.get("annotations", []))})
                return
            if route == "/api/submit":
                payload["savedAt"] = datetime.now(timezone.utc).isoformat()
                self.app.annotations_file.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                write_review_markdown(payload, self.app.review_file)
                task = build_ai_task(payload, self.app.assets_dir)
                self.app.ai_task_file.write_text(
                    json.dumps(task, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
                )
                write_ai_task_markdown(task, self.app.ai_task_markdown_file)
                self.send_json({
                    "ok": True,
                    "annotations": len(payload.get("annotations", [])),
                    "taskPath": str(self.app.ai_task_file.resolve()),
                    "prompt": f"执行已提交的视觉修改，请读取 {self.app.ai_task_file.resolve()}",
                })
                return
            self.send_error(HTTPStatus.NOT_FOUND)
        except (ValueError, KeyError, json.JSONDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, HTTPStatus.BAD_REQUEST)


class ReviewServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", action="append", default=[], help="Image to copy into the review session")
    parser.add_argument("--session-dir", required=True, help="Directory for assets and review output")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0, help="Port, or 0 to choose an available port")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    plugin_root = Path(__file__).resolve().parent.parent
    session_dir = Path(args.session_dir).expanduser().resolve()
    assets_dir = session_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    for value in args.image:
        source = Path(value).expanduser().resolve()
        if not source.is_file():
            print(f"Image not found: {source}", file=sys.stderr)
            return 2
        destination = assets_dir / safe_name(source.name)
        if not destination.exists() or not os.path.samefile(source, destination):
            if destination.exists():
                destination = unique_path(assets_dir, source.name)
            shutil.copy2(source, destination)

    server = ReviewServer((args.host, args.port), ReviewHandler)
    server.app = argparse.Namespace(
        assets_root=plugin_root / "assets",
        assets_dir=assets_dir,
        annotations_file=session_dir / "annotations.json",
        review_file=session_dir / "review.md",
        ai_task_file=session_dir / "ai-task.json",
        ai_task_markdown_file=session_dir / "ai-task.md",
    )
    host, port = server.server_address
    print(f"Img Review: http://{host}:{port}", flush=True)
    print(f"Session: {session_dir}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
