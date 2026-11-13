"""Collect timing facts for every Claude Code background session (job).

Prints one JSON object {"sessions": [...]}. Per session:
  createdAtMs    when the session was created (state.json)
  activeMs       time of live work or conversation: the sum of gaps between
                 consecutive transcript entries that are at most ACTIVE_GAP
                 apart, so nights and long waits do not count
  lastHumanAtMs  when a person last wrote into the session

Transcripts are append-only, so each one is read once and then only from the
offset reached last time; partial results live in a cache file.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

JOBS_DIR = Path.home() / ".claude" / "jobs"
CACHE_FILE = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache") / "claude-session-times" / "cache.json"
CACHE_VERSION = 1
ACTIVE_GAP_MS = 5 * 60 * 1000
NON_HUMAN_PREFIXES = ("<task-notification", "<system-reminder", "<local-command-")


def parse_ms(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return None


def is_human(entry: dict[str, Any]) -> bool:
    if entry.get("type") != "user" or entry.get("isMeta"):
        return False
    origin = entry.get("origin")
    if isinstance(origin, dict):
        return origin.get("kind") == "human"
    content = entry.get("message", {}).get("content")
    if isinstance(content, list):
        if any(isinstance(b, dict) and b.get("type") == "tool_result" for b in content):
            return False
        text = " ".join(b.get("text", "") for b in content if isinstance(b, dict))
    else:
        text = str(content or "")
    return not text.lstrip().startswith(NON_HUMAN_PREFIXES)


def scan(transcript: Path, prev: dict[str, Any] | None) -> dict[str, Any]:
    """Advance the per-transcript totals from the cached offset to the end."""
    stat = transcript.stat()
    acc = {"offset": 0, "lastTs": None, "activeMs": 0, "lastHumanAtMs": None}
    if prev and prev.get("offset", 0) <= stat.st_size and prev.get("ino") == stat.st_ino:
        acc.update({k: prev[k] for k in acc if k in prev})
    with transcript.open("rb") as fh:
        fh.seek(acc["offset"])
        for raw in fh:
            if not raw.endswith(b"\n"):
                break  # a line still being written: pick it up next time
            acc["offset"] += len(raw)
            try:
                entry = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(entry, dict) or entry.get("isSidechain"):
                continue
            ts = parse_ms(entry.get("timestamp"))
            if ts is None:
                continue
            last = acc["lastTs"]
            if last is not None and 0 < ts - last <= ACTIVE_GAP_MS:
                acc["activeMs"] += ts - last
            if last is None or ts > last:
                acc["lastTs"] = ts
            if is_human(entry):
                acc["lastHumanAtMs"] = ts
    acc["ino"] = stat.st_ino
    return acc


def project_of(meta: dict[str, Any]) -> str:
    """The folder the session was started in, worktree copies folded into their repo."""
    path = str(meta.get("originCwd") or meta.get("cwd") or "")
    marker = "/.claude/worktrees/"
    return path.split(marker, 1)[0] if marker in path else path


def load_cache() -> dict[str, Any]:
    try:
        data = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
        return data["files"] if data.get("version") == CACHE_VERSION else {}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def save_cache(files: dict[str, Any]) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"version": CACHE_VERSION, "files": files}), encoding="utf-8")
        tmp.replace(CACHE_FILE)
    except OSError as exc:
        print(f"cache not saved: {exc}", file=sys.stderr)


def collect() -> list[dict[str, Any]]:
    sessions: list[dict[str, Any]] = []
    if not JOBS_DIR.is_dir():
        return sessions
    cache, fresh = load_cache(), {}
    for job in sorted(JOBS_DIR.iterdir()):
        try:
            meta = json.loads((job / "state.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        created = parse_ms(meta.get("createdAt"))
        if created is None:
            continue
        totals: dict[str, Any] = {"activeMs": 0, "lastHumanAtMs": None}
        path = meta.get("linkScanPath")
        if isinstance(path, str) and os.path.isfile(path):
            try:
                totals = fresh[path] = scan(Path(path), cache.get(path))
            except OSError as exc:
                print(f"{job.name}: {exc}", file=sys.stderr)
        sessions.append(
            {
                "id": job.name,
                "name": str(meta.get("name") or meta.get("intent") or job.name),
                "state": str(meta.get("state") or "unknown"),
                "project": project_of(meta),
                "createdAtMs": created,
                "createdLocal": datetime.fromtimestamp(created / 1000).strftime("%Y-%m-%d %H:%M"),
                "workMs": int(totals["activeMs"]),
                "lastHumanAtMs": totals["lastHumanAtMs"],
            }
        )
    save_cache(fresh)
    return sessions


def main() -> int:
    json.dump({"nowLabel": datetime.now().strftime("%H:%M:%S"), "sessions": collect()}, sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
