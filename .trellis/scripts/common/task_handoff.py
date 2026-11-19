"""Read a task's published handoff for SessionStart injection.

A project may publish task directories to a ``trellis-tasks`` branch (for
example with a ``bin/handoff`` helper) so that a session started on another
machine sees the latest recorded state. SessionStart hooks resolve the active
task with their own platform rules and pass its directory here.

Nothing is injected when the branch or the task's ``handoff.md`` on it does not
exist, so projects that never publish handoffs see no change.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

HANDOFF_BRANCH = "trellis-tasks"
HANDOFF_FILE = "handoff.md"
MAX_LINES = 40


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args], cwd=repo_root, capture_output=True, text=True
    )


def build_handoff_block(repo_root: Path, task_dir: Path) -> str:
    """Return a ``<task-handoff>`` block for ``task_dir``, or ``""``.

    Reads the branch tip through git without touching the worktree. Entries
    are appended over time, so the newest lines are the ones shown.
    """
    tip_sha = ""
    for ref in (f"refs/remotes/origin/{HANDOFF_BRANCH}", f"refs/heads/{HANDOFF_BRANCH}"):
        probe = _git(repo_root, "rev-parse", "--verify", "-q", ref)
        if probe.returncode == 0:
            tip_sha = probe.stdout.strip()
            break
    if not tip_sha:
        return ""

    try:
        rel_task = task_dir.resolve().relative_to(repo_root.resolve())
    except ValueError:
        return ""
    rel_handoff = rel_task.joinpath(HANDOFF_FILE).as_posix()

    show = _git(repo_root, "show", f"{tip_sha}:{rel_handoff}")
    if show.returncode != 0:
        return ""
    lines = show.stdout.strip().splitlines()
    if not lines:
        return ""
    body = "\n".join(lines[-MAX_LINES:])
    if len(lines) > MAX_LINES:
        body = (
            f"… ({len(lines) - MAX_LINES} earlier lines; read {rel_handoff} on the branch)\n"
            + body
        )

    stamp = _git(repo_root, "show", "-s", "--format=%cs %h", tip_sha).stdout.strip()
    return (
        "<task-handoff>\n"
        f"Published state: branch `{HANDOFF_BRANCH}` @ {stamp}. "
        f"Read the full file from that branch: {rel_handoff}.\n"
        "---\n"
        f"{body}\n"
        "</task-handoff>"
    )
