/**
 * Integration tests for the C12 fork's template customizations.
 *
 * - inject-workflow-state.py adds a remaining-checklist note for in_progress
 *   tasks, so an agent does not treat finishing one implement.md item as a
 *   legal turn end.
 * - Codex session-start.py works when the session cwd is below the project
 *   root and does not repeat the first-reply notice on resume/clear/compact.
 * - workflow.md carries the planning/execution exit checks and Rule 6 that
 *   the breadcrumbs point to.
 * - Templates survive the common pre-commit whitespace hooks unchanged, so a
 *   fresh `trellis update` does not leave local diffs in consumer repos.
 *
 * Each test runs the real templates in a throwaway repo.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEMPLATES = path.resolve(__dirname, "../../src/templates");
const TEMPLATE_SCRIPTS = path.join(TEMPLATES, "trellis/scripts");
const WORKFLOW_MD = path.join(TEMPLATES, "trellis/workflow.md");
const SHARED_HOOKS = path.join(TEMPLATES, "shared-hooks");
const CODEX_HOOKS = path.join(TEMPLATES, "codex/hooks");

function hasPython(): boolean {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function cleanEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(TRELLIS_|CODEX_|CLAUDE_)/.test(k),
    ),
  );
}

function setupRepo(tmp: string): void {
  fs.mkdirSync(path.join(tmp, ".git"));
  fs.mkdirSync(path.join(tmp, ".trellis", "scripts"), { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(tmp, ".trellis", "scripts"), {
    recursive: true,
  });
  fs.copyFileSync(WORKFLOW_MD, path.join(tmp, ".trellis", "workflow.md"));
}

function setActiveTask(
  tmp: string,
  sessionKey: string,
  status: string,
  implementMd: string | null,
): void {
  const task = path.join(tmp, ".trellis", "tasks", "fixture");
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(
    path.join(task, "task.json"),
    JSON.stringify({ status, title: "Fixture task" }),
  );
  fs.writeFileSync(path.join(task, "prd.md"), "Fixture requirements\n");
  const implement = path.join(task, "implement.md");
  if (implementMd === null) fs.rmSync(implement, { force: true });
  else fs.writeFileSync(implement, implementMd);
  const sessions = path.join(tmp, ".trellis", ".runtime", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(
    path.join(sessions, `${sessionKey}.json`),
    JSON.stringify({ current_task: ".trellis/tasks/fixture" }),
  );
}

function runPython(
  script: string,
  cwd: string,
  input: unknown,
  env: NodeJS.ProcessEnv,
): { stdout: string; status: number | null; stderr: string } {
  const r = spawnSync("python3", ["-B", script], {
    cwd,
    encoding: "utf-8",
    input: typeof input === "string" ? input : JSON.stringify(input),
    env,
  });
  return { stdout: r.stdout, status: r.status, stderr: r.stderr };
}

function additionalContext(stdout: string): string {
  if (!stdout.trim()) return "";
  return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
}

const describeFn = hasPython() ? describe : describe.skip;

describeFn("inject-workflow-state remaining-checklist note", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-c12-checklist-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function turn(): string {
    const r = runPython(
      path.join(SHARED_HOOKS, "inject-workflow-state.py"),
      tmp,
      {
        hook_event_name: "UserPromptSubmit",
        cwd: tmp,
        session_id: "owner",
        prompt: "continue",
      },
      { ...cleanEnv(), CLAUDE_PROJECT_DIR: tmp },
    );
    expect(r.status, r.stderr).toBe(0);
    return additionalContext(r.stdout);
  }

  const partial = [
    "# Plan",
    "- [x] First slice",
    "- [ ] Second slice with the real next step",
    "* [ ] Third slice",
    "",
  ].join("\n");

  it("names the unchecked count and the next item while in_progress", () => {
    setActiveTask(tmp, "claude_owner", "in_progress", partial);
    const ctx = turn();
    expect(ctx).toContain("Remaining checklist: 2 of 3 items unchecked");
    expect(ctx).toContain('Next: "Second slice with the real next step"');
    expect(ctx).toContain("Completing one item is not a legal turn end");
  });

  it("stays silent when every item is checked", () => {
    setActiveTask(tmp, "claude_owner", "in_progress", "- [x] a\n- [X] b\n");
    expect(turn()).not.toContain("Remaining checklist");
  });

  it("stays silent during planning, so it never pushes execution early", () => {
    setActiveTask(tmp, "claude_owner", "planning", partial);
    expect(turn()).not.toContain("Remaining checklist");
  });

  it("stays silent when implement.md is missing", () => {
    setActiveTask(tmp, "claude_owner", "in_progress", null);
    expect(turn()).not.toContain("Remaining checklist");
  });

  it("does not leak another session's task", () => {
    setActiveTask(tmp, "claude_someone_else", "in_progress", partial);
    expect(turn()).not.toContain("Remaining checklist");
  });
});

describeFn("Codex session-start from a subdirectory", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-c12-codex-start-"));
    setupRepo(tmp);
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function start(cwd: string, source: string): string {
    const r = runPython(
      path.join(CODEX_HOOKS, "session-start.py"),
      cwd,
      { cwd, source, session_id: "unmatched" },
      cleanEnv(),
    );
    expect(r.status, r.stderr).toBe(0);
    return additionalContext(r.stdout);
  }

  it("finds the project root when the session cwd is nested", () => {
    const deep = path.join(tmp, "src", "deep");
    fs.mkdirSync(deep, { recursive: true });
    const ctx = start(deep, "startup");
    expect(ctx).toContain("<trellis-workflow>");
    expect(ctx).toContain("Current task: none.");
  });

  it("does not repeat the first-reply notice on resume, clear or compact", () => {
    expect(start(tmp, "startup")).toContain("<first-reply-notice>");
    for (const source of ["resume", "clear", "compact"]) {
      expect(start(tmp, source)).not.toContain("<first-reply-notice>");
    }
  });

  it("does not climb past a nested repository boundary", () => {
    const nested = path.join(tmp, "vendor", "other");
    fs.mkdirSync(path.join(nested, ".git"), { recursive: true });
    const deep = path.join(nested, "src");
    fs.mkdirSync(deep);
    expect(start(deep, "startup")).toBe("");
  });
});

describe("workflow.md exit checks", () => {
  const workflow = fs.readFileSync(WORKFLOW_MD, "utf-8");

  function block(name: string): string {
    const m = workflow.match(
      new RegExp(`\\[workflow-state:${name}\\]([\\s\\S]*?)\\[/workflow-state:${name}\\]`),
    );
    expect(m, `missing breadcrumb ${name}`).not.toBeNull();
    return m?.[1] ?? "";
  }

  it("defines the checks the breadcrumbs refer to", () => {
    expect(workflow).toContain("### Planning-turn exit check");
    expect(workflow).toContain("### Execution-turn exit check");
    expect(workflow).toMatch(/^6\. Treat new user input during an active task as steering/m);
  });

  it("points every planning and execution breadcrumb at its exit check", () => {
    for (const name of ["planning", "planning-inline"]) {
      expect(block(name)).toContain("apply the Planning-turn exit check");
    }
    for (const name of ["in_progress", "in_progress-inline"]) {
      expect(block(name)).toContain("apply the Execution-turn exit check");
      expect(block(name)).toContain("apply Rule 6");
    }
  });
});

describe("templates survive pre-commit whitespace hooks", () => {
  function textFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return textFiles(p);
      if (/\.(md|py|json|toml|yaml|yml|ts|js|sh|txt)$/.test(e.name)) return [p];
      return [];
    });
  }

  it("has no trailing whitespace and exactly one final newline", () => {
    const offenders: string[] = [];
    for (const file of textFiles(TEMPLATES)) {
      const text = fs.readFileSync(file, "utf-8");
      if (text.length === 0) continue;
      if (/[ \t]+$/m.test(text) || !text.endsWith("\n") || text.endsWith("\n\n")) {
        offenders.push(path.relative(TEMPLATES, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

describeFn("SessionStart handoff injection", () => {
  let tmp: string;

  function git(...args: string[]): void {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd: tmp,
      stdio: "ignore",
    });
  }

  // Publish `lines` as the fixture task's handoff.md on `trellis-tasks`,
  // leaving the working tree on `main` without the file.
  function publishHandoff(lines: string[]): void {
    git("checkout", "-q", "-b", "trellis-tasks");
    const handoff = path.join(tmp, ".trellis", "tasks", "fixture", "handoff.md");
    fs.writeFileSync(handoff, lines.join("\n") + "\n");
    git("add", handoff);
    git("commit", "-q", "-m", "handoff");
    git("checkout", "-q", "main");
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-c12-handoff-"));
    setupRepo(tmp);
    fs.rmSync(path.join(tmp, ".git"), { recursive: true });
    git("init", "-q", "-b", "main");
    git("commit", "-q", "--allow-empty", "-m", "init");
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // Each agent's own template, resolving the task with its own platform.
  const agents = [
    {
      name: "Claude template",
      script: path.join(SHARED_HOOKS, "session-start.py"),
      sessionKey: "claude_owner",
      otherKey: "codex_owner",
      env: (dir: string) => ({ ...cleanEnv(), CLAUDE_PROJECT_DIR: dir }),
    },
    {
      name: "Codex template",
      script: path.join(CODEX_HOOKS, "session-start.py"),
      sessionKey: "codex_owner",
      otherKey: "claude_owner",
      env: () => cleanEnv(),
    },
  ];

  for (const agent of agents) {
    function start(source = "startup"): string {
      const r = runPython(
        agent.script,
        tmp,
        { cwd: tmp, source, session_id: "owner", hook_event_name: "SessionStart" },
        agent.env(tmp),
      );
      expect(r.status, r.stderr).toBe(0);
      return additionalContext(r.stdout);
    }

    it(`${agent.name}: injects the newest handoff lines for its own task`, () => {
      setActiveTask(tmp, agent.sessionKey, "in_progress", null);
      const lines = Array.from({ length: 45 }, (_, i) => `entry ${i + 1}`);
      publishHandoff(lines);
      for (const source of ["startup", "compact"]) {
        const ctx = start(source);
        expect(ctx).toContain("Current task: .trellis/tasks/fixture");
        expect(ctx).toContain("<task-handoff>");
        expect(ctx).toContain("entry 45");
        expect(ctx).not.toContain("entry 5\n");
        expect(ctx).toContain("5 earlier lines");
      }
    });

    it(`${agent.name}: ignores a task bound to the other agent's session`, () => {
      setActiveTask(tmp, agent.otherKey, "in_progress", null);
      publishHandoff(["entry"]);
      const ctx = start();
      expect(ctx).toContain("Current task: none.");
      expect(ctx).not.toContain("<task-handoff>");
    });

    it(`${agent.name}: injects nothing without a trellis-tasks branch`, () => {
      setActiveTask(tmp, agent.sessionKey, "in_progress", null);
      const ctx = start();
      expect(ctx).toContain("Current task: .trellis/tasks/fixture");
      expect(ctx).not.toContain("<task-handoff>");
    });
  }
});
