"""Read a task's recorded progress (``handoff.md``) for agent context.

Agents append progress entries to ``<task>/handoff.md`` as they work (format in
workflow.md, "Recording task progress"). The file is local and travels with the
task branch, so whoever picks the task up next — on this machine or another —
starts from the latest entries.

``build_handoff_block`` feeds SessionStart; ``progress_note`` feeds the per-turn
breadcrumb so a missing or stale record is visible every turn.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

HANDOFF_FILE = "handoff.md"
MAX_LINES = 40
_ENTRY_RE = re.compile(r"^##\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\b", re.MULTILINE)


def _read(task_dir: Path) -> str:
    try:
        return (task_dir / HANDOFF_FILE).read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def build_handoff_block(repo_root: Path, task_dir: Path) -> str:
    """Return a ``<task-handoff>`` block with the newest lines, or ``""``."""
    lines = _read(task_dir).splitlines()
    if not lines:
        return ""
    try:
        rel = (task_dir / HANDOFF_FILE).resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        rel = str(task_dir / HANDOFF_FILE)
    body = "\n".join(lines[-MAX_LINES:])
    if len(lines) > MAX_LINES:
        body = f"… ({len(lines) - MAX_LINES} earlier lines in {rel})\n" + body
    return f"<task-handoff>\nRecorded progress ({rel}):\n---\n{body}\n</task-handoff>"


def _commits_since(repo_root: Path, stamp: str) -> int | None:
    result = subprocess.run(
        ["git", "rev-list", "--count", f"--since={stamp}", "HEAD"],
        cwd=repo_root, capture_output=True, text=True,
    )
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def progress_note(repo_root: Path, task_dir: Path) -> str:
    """One breadcrumb line about the task's progress record."""
    stamps = _ENTRY_RE.findall(_read(task_dir))
    pointer = 'see "Recording task progress" in .trellis/workflow.md'
    if not stamps:
        return (
            f"Progress record: no entry in {HANDOFF_FILE} yet — append one after "
            f"the next milestone ({pointer})."
        )
    last = stamps[-1]
    since = _commits_since(repo_root, last)
    tail = f"; {since} commit(s) on this branch since" if since else ""
    return (
        f"Progress record: last {HANDOFF_FILE} entry {last}{tail} — append an "
        f"entry after each milestone ({pointer})."
    )
