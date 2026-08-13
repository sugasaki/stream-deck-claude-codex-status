import assert from "node:assert/strict";
import test from "node:test";

import {
  appPathForProcess,
  appPathFromCommand,
  codexLaunchTarget,
  SessionAppActivator,
  type ProcessInfo,
  type SessionLaunchTarget
} from "../src/session-app";
import type { SessionStatus } from "../src/status";

function session(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "codex:thread-one",
    agent: "codex",
    kind: "attention",
    project: "project",
    task: "task",
    detail: "返信を確認してください",
    startedAt: 1_000,
    updatedAt: 2_000,
    ...overrides
  };
}

test("opens Codex desktop sessions directly in the ChatGPT task", () => {
  assert.deepEqual(
    codexLaunchTarget("codex:thread-one", "codex_work_desktop"),
    { kind: "url", value: "codex://threads/thread-one" }
  );
  assert.deepEqual(
    codexLaunchTarget("codex:thread-two", "Codex Desktop"),
    { kind: "url", value: "codex://threads/thread-two" }
  );
});

test("uses a known Codex origin application before the ChatGPT fallback", () => {
  assert.deepEqual(codexLaunchTarget("thread-one", "zed"), {
    kind: "bundle",
    value: "dev.zed.Zed"
  });
  assert.deepEqual(codexLaunchTarget("thread-one", "vscode"), {
    kind: "bundle",
    value: "com.microsoft.VSCode"
  });
});

test("extracts a parent macOS application from a process command", () => {
  assert.equal(
    appPathFromCommand("/Applications/Ghostty.app/Contents/MacOS/ghostty"),
    "/Applications/Ghostty.app"
  );
  assert.equal(
    appPathFromCommand("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
    "/System/Applications/Utilities/Terminal.app"
  );
  assert.equal(appPathFromCommand("/bin/zsh"), undefined);
});

test("walks a Claude process chain to its terminal application", async () => {
  const processes = new Map<number, ProcessInfo>([
    [100, { parentPid: 200, command: "/Users/example/.local/share/claude/versions/2.1.227" }],
    [200, { parentPid: 300, command: "/bin/zsh" }],
    [300, { parentPid: 1, command: "/Applications/Ghostty.app/Contents/MacOS/ghostty" }],
    [1, { parentPid: 0, command: "/sbin/launchd" }]
  ]);
  assert.equal(
    await appPathForProcess(100, async (pid) => processes.get(pid)),
    "/Applications/Ghostty.app"
  );
});

test("activates the actual Claude application and keeps fallbacks deterministic", async () => {
  const opened: SessionLaunchTarget[] = [];
  const processes = new Map<number, ProcessInfo>([
    [100, { parentPid: 200, command: "/Users/example/.local/share/claude/versions/2.1.227" }],
    [200, { parentPid: 300, command: "/bin/zsh" }],
    [300, { parentPid: 1, command: "/Applications/Ghostty.app/Contents/MacOS/ghostty" }],
    [1, { parentPid: 0, command: "/sbin/launchd" }]
  ]);
  const activator = new SessionAppActivator({
    readClaudeSessionRecords: async () => [{ pid: 100, sessionId: "claude-one" }],
    readProcess: async (pid) => processes.get(pid),
    openTarget: async (target) => { opened.push(target); }
  });

  assert.equal(await activator.activate(session({ sessionId: "claude:claude-one", agent: "claude" })), true);
  assert.deepEqual(opened, [{ kind: "app", value: "/Applications/Ghostty.app" }]);

  opened.length = 0;
  assert.equal(await activator.activate(session({ sessionId: "claude:missing", agent: "claude" })), true);
  assert.deepEqual(opened, [{ kind: "bundle", value: "com.anthropic.claudefordesktop" }]);
});

test("falls back to the exact ChatGPT task when the origin app cannot open", async () => {
  const opened: SessionLaunchTarget[] = [];
  const activator = new SessionAppActivator({
    openTarget: async (target) => {
      opened.push(target);
      if (target.kind === "bundle" && target.value === "dev.zed.Zed") throw new Error("missing");
    }
  });

  assert.equal(await activator.activate(session({ originator: "zed" })), true);
  assert.deepEqual(opened, [
    { kind: "bundle", value: "dev.zed.Zed" },
    { kind: "url", value: "codex://threads/thread-one" }
  ]);
});

test("falls back to the ChatGPT application when its deep link cannot open", async () => {
  const opened: SessionLaunchTarget[] = [];
  const activator = new SessionAppActivator({
    openTarget: async (target) => {
      opened.push(target);
      if (target.kind === "url") throw new Error("scheme unavailable");
    }
  });

  assert.equal(await activator.activate(session({ originator: "codex_work_desktop" })), true);
  assert.deepEqual(opened, [
    { kind: "url", value: "codex://threads/thread-one" },
    { kind: "bundle", value: "com.openai.codex" }
  ]);
});
