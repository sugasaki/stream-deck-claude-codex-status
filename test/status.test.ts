import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ClaudeRemoteTitleResolver, cloudSessionIdFromCommand } from "../src/claude-remote-title";
import {
  applyClaudeTranscriptLine,
  claudeTaskName,
  type ClaudeTranscriptCursor
} from "../src/claude-task-name";
import { renderStatus } from "../src/render";
import {
  applyCodexRolloutLine,
  codexSessionFromThread,
  codexThreadNamesFromSessionIndex,
  type RolloutCursor
} from "../src/codex-task-monitor";
import { HookServer } from "../src/server";
import { StatusStore } from "../src/status";

test("reports that monitoring is active before the first hook arrives", () => {
  const store = new StatusStore();
  assert.equal(store.snapshot(1_000).kind, "ready");
  assert.equal(store.snapshot(1_000).label, "待ちなし");
});

test("turn completion becomes a named Codex confirmation wait", () => {
  const cursor: RolloutCursor = { offset: 0 };
  applyCodexRolloutLine(
    cursor,
    JSON.stringify({ type: "session_meta", payload: { originator: "codex_work_desktop" } })
  );
  applyCodexRolloutLine(
    cursor,
    JSON.stringify({ timestamp: "2026-08-13T12:00:00.000Z", type: "event_msg", payload: { type: "task_started" } })
  );
  applyCodexRolloutLine(
    cursor,
    JSON.stringify({ timestamp: "2026-08-13T12:01:00.000Z", type: "event_msg", payload: { type: "task_complete" } })
  );
  const session = codexSessionFromThread(
    {
      id: "thread-one",
      rollout_path: "/tmp/rollout.jsonl",
      display_name: "Stream Deck 状態表示",
      cwd: "/tmp/status-plugin",
      recency_at_ms: Date.now()
    },
    cursor.lifecycle,
    cursor.originator
  );
  assert.equal(session?.kind, "attention");
  assert.equal(session?.task, "Stream Deck 状態表示");
  assert.equal(session?.detail, "返信を確認してください");
  assert.equal(session?.originator, "codex_work_desktop");
});

test("uses a renamed Claude session title ahead of its latest descriptive prompt", () => {
  const cursor: ClaudeTranscriptCursor = { offset: 0 };
  applyClaudeTranscriptLine(
    cursor,
    JSON.stringify({ type: "user", message: { content: "<local-command-caveat>ignore</local-command-caveat>" } })
  );
  applyClaudeTranscriptLine(
    cursor,
    JSON.stringify({ type: "user", message: { content: "以下のプロジェクトに着手 https://github.com/example-org/sample-project" } })
  );
  applyClaudeTranscriptLine(
    cursor,
    JSON.stringify({ type: "user", message: { content: "再設計の対話を始めたい。類似サービス調査はしない" } })
  );
  applyClaudeTranscriptLine(
    cursor,
    JSON.stringify({ type: "custom-title", customTitle: "App | sample-project 再設計" })
  );

  assert.equal(cursor.firstPrompt, "以下のプロジェクトに着手 https://github.com/example-org/sample-project");
  assert.equal(cursor.latestPrompt, "再設計の対話を始めたい。類似サービス調査はしない");
  assert.equal(claudeTaskName(cursor), "App | sample-project 再設計");
});

test("uses Claude's generated title before prompt-based fallbacks", () => {
  const cursor: ClaudeTranscriptCursor = { offset: 0 };
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "user", message: { content: "最初の依頼" } }));
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "ai-title", aiTitle: "Sample Project" }));

  assert.equal(claudeTaskName(cursor), "Sample Project");
});

test("maps a local Claude session to its changeable remote title", async () => {
  const sessionsRoot = await mkdtemp(path.join(tmpdir(), "claude-remote-title-"));
  await writeFile(
    path.join(sessionsRoot, "12345.json"),
    JSON.stringify({ pid: 12345, sessionId: "local-session" })
  );
  let pageRequests = 0;
  const resolver = new ClaudeRemoteTitleResolver({
    sessionsRoot,
    commandForPid: async () =>
      "/opt/claude --sdk-url https://api.anthropic.com/v1/code/sessions/cse_remoteOne --session-id cse_remoteOne",
    readAccessToken: async () => "test-token",
    requestPage: async () => {
      pageRequests++;
      return { data: [{ id: "cse_remoteOne", title: "Sample Project" }] };
    }
  });

  assert.equal(await resolver.resolve("local-session"), "Sample Project");
  assert.equal(await resolver.resolve("local-session"), "Sample Project");
  assert.equal(pageRequests, 1);
});

test("reads the cloud session ID from Claude Remote Control commands", () => {
  assert.equal(
    cloudSessionIdFromCommand(
      "/opt/claude --print --sdk-url https://api.anthropic.com/v1/code/sessions/cse_012345 --session-id cse_012345"
    ),
    "cse_012345"
  );
});

test("uses the latest descriptive Claude prompt and ignores generic follow-ups", () => {
  const cursor: ClaudeTranscriptCursor = { offset: 0 };
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "user", message: { content: "[Image: screenshot]" } }));
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "user", message: { content: "以下のプロジェクトに着手" } }));
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "user", message: { content: "sample-projectを再設計する" } }));
  applyClaudeTranscriptLine(cursor, JSON.stringify({ type: "user", message: { content: "続けて" } }));

  assert.equal(claudeTaskName(cursor), "sample-projectを再設計する");
});

test("updating a recovered Claude name does not reorder the task", () => {
  const store = new StatusStore();
  store.applyHook(
    { hook_event_name: "PostToolUse", session_id: "one", cwd: "/Users/example" },
    1_000,
    "claude"
  );

  assert.equal(store.updateSessionTask("claude:one", "sample-projectを再設計する"), true);
  assert.equal(store.export()[0]?.task, "sample-projectを再設計する");
  assert.equal(store.export()[0]?.updatedAt, 1_000);
});

test("uses the latest renamed Codex task name from the session index", () => {
  const names = codexThreadNamesFromSessionIndex([
    JSON.stringify({ id: "thread-one", thread_name: "ログイン時起動設定を追加", updated_at: "2026-08-13T09:39:28Z" }),
    "invalid json",
    JSON.stringify({ id: "thread-one", thread_name: "App | Sample-ログイン時起動設定を追加", updated_at: "2026-08-13T09:40:08Z" })
  ].join("\n"));

  assert.equal(names.get("thread-one"), "App | Sample-ログイン時起動設定を追加");
});

test("falls back to the database task name when the Codex task was not renamed", () => {
  const names = codexThreadNamesFromSessionIndex(
    JSON.stringify({ id: "another-thread", thread_name: "別のタスク" })
  );
  const databaseName = "以下のアプリを作成しました。";

  assert.equal(names.get("thread-one") ?? databaseName, databaseName);
});

test("renaming a Codex task does not change its conversation update time", () => {
  const lifecycle = {
    kind: "attention" as const,
    timestamp: Date.parse("2026-08-13T09:35:00Z"),
    detail: "返信を確認してください"
  };
  const session = codexSessionFromThread(
    {
      id: "thread-one",
      rollout_path: "/tmp/rollout.jsonl",
      display_name: "App | Sample-ログイン時起動設定を追加",
      cwd: "/tmp/memory-bar",
      recency_at_ms: Date.parse("2026-08-13T09:34:00Z")
    },
    lifecycle
  );

  assert.equal(session?.task, "App | Sample-ログイン時起動設定を追加");
  assert.equal(session?.updatedAt, lifecycle.timestamp);
});

test("keeps an acknowledged completion dismissed until a newer event", () => {
  const store = new StatusStore();
  const completed = {
    sessionId: "codex:one",
    agent: "codex" as const,
    kind: "attention" as const,
    project: "alpha",
    task: "確認するタスク",
    detail: "返信を確認してください",
    startedAt: 1_000,
    updatedAt: 1_000
  };
  store.syncAgentSessions("codex", [completed]);
  store.acknowledgeSession("codex:one", 2_000);
  assert.equal(store.export()[0]?.updatedAt, 1_000);
  store.syncAgentSessions("codex", [completed]);
  assert.equal(store.snapshot(2_000).kind, "ready");

  store.syncAgentSessions("codex", [{ ...completed, kind: "working", updatedAt: 3_000 }]);
  assert.equal(store.snapshot(3_000).kind, "working");
});

test("restores recent session state", () => {
  const original = new StatusStore();
  original.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "one", cwd: "/tmp/alpha", prompt: "復元するタスク" },
    1_000,
    "codex"
  );

  const restored = new StatusStore();
  restored.restore(original.export(), 2_000);
  assert.equal(restored.snapshot(2_000).kind, "working");
  assert.equal(restored.snapshot(2_000).task, "復元するタスク");
});

test("tracks a prompt, tool use, and confirmation wait", () => {
  const store = new StatusStore();
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "one", cwd: "/tmp/alpha" }, 1_000);
  store.applyHook({ hook_event_name: "PreToolUse", session_id: "one", cwd: "/tmp/alpha", tool_name: "Bash" }, 2_000);

  const working = store.snapshot(6_000);
  assert.equal(working.kind, "working");
  assert.equal(working.project, "alpha");
  assert.equal(working.agent, "claude");
  assert.equal(working.detail, "コマンド実行");
  assert.equal(working.elapsedMs, 5_000);

  store.applyHook({ hook_event_name: "Stop", session_id: "one", cwd: "/tmp/alpha" }, 7_000);
  const waiting = store.snapshot(10_000);
  assert.equal(waiting.kind, "attention");
  assert.equal(waiting.detail, "返信を確認してください");
  assert.equal(waiting.elapsedMs, 9_000);
});

test("shows a permission request ahead of another working session", () => {
  const store = new StatusStore();
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "one", cwd: "/tmp/alpha" }, 1_000);
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "two", cwd: "/tmp/beta" }, 2_000);
  store.applyHook(
    { hook_event_name: "PermissionRequest", session_id: "one", cwd: "/tmp/alpha", tool_name: "Bash" },
    3_000
  );

  const snapshot = store.snapshot(4_000);
  assert.equal(snapshot.kind, "attention");
  assert.equal(snapshot.project, "alpha");
  assert.equal(snapshot.activeSessions, 2);
});

test("keeps Claude and Codex sessions separate and sorts them by latest update", () => {
  const store = new StatusStore();
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "same", cwd: "/tmp/claude", prompt: "Claudeの実装タスク" },
    1_000,
    "claude"
  );
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "same", cwd: "/tmp/codex", prompt: "Codexの調査タスク" },
    2_000,
    "codex"
  );
  store.applyHook(
    { hook_event_name: "PermissionRequest", session_id: "same", cwd: "/tmp/codex", tool_name: "Bash" },
    3_000,
    "codex"
  );

  const first = store.sessionSnapshot(0, 4_000);
  const second = store.sessionSnapshot(1, 4_000);
  assert.equal(first.agent, "codex");
  assert.equal(first.kind, "attention");
  assert.equal(first.task, "Codexの調査タスク");
  assert.equal(second.agent, "claude");
  assert.equal(second.task, "Claudeの実装タスク");
});

test("a newer working task is shown before an older confirmation wait", () => {
  const store = new StatusStore();
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "old", prompt: "古い確認待ち" },
    1_000,
    "codex"
  );
  store.applyHook(
    { hook_event_name: "Stop", session_id: "old" },
    2_000,
    "codex"
  );
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "new", prompt: "新しい作業中" },
    3_000,
    "claude"
  );

  assert.equal(store.sessionSnapshot(0, 4_000).task, "新しい作業中");
  assert.equal(store.sessionSnapshot(0, 4_000).kind, "working");
  assert.equal(store.sessionSnapshot(1, 4_000).task, "古い確認待ち");
  assert.equal(store.sessionSnapshot(1, 4_000).kind, "attention");
});

test("agent summaries show counts without repeating task names", () => {
  const store = new StatusStore();
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "one", prompt: "重複させないタスク名" },
    1_000,
    "codex"
  );
  store.applyHook(
    { hook_event_name: "PermissionRequest", session_id: "one", tool_name: "Bash" },
    2_000,
    "codex"
  );
  store.applyHook(
    { hook_event_name: "UserPromptSubmit", session_id: "two", prompt: "別の作業中タスク" },
    3_000,
    "codex"
  );

  const summary = store.summarySnapshot(4_000, "codex");
  assert.equal(summary.kind, "attention");
  assert.equal(summary.label, "確認待ち 1");
  assert.equal(summary.task, "作業中 1");
  assert.equal(summary.activeSessions, 2);
  assert.doesNotMatch(summary.task, /重複させないタスク名/);
});

test("renders black agent summaries with logos and separate status indicators", () => {
  const svg = decodeURIComponent(renderStatus({
    sessionId: "summary:claude",
    agent: "claude",
    kind: "attention",
    project: "Claude Code",
    task: "作業中 2",
    detail: "3件を監視中",
    startedAt: 0,
    updatedAt: 0,
    scope: "claude",
    label: "確認待ち 1",
    activeSessions: 3,
    elapsedMs: 0
  }));

  assert.match(svg, />CLAUDE</);
  assert.match(svg, />確認待ち 1</);
  assert.match(svg, />作業中 2</);
  assert.match(svg, /fill="#050608" stroke="#E36B3A"/);
  assert.match(svg, /scale\(0\.21\)/);
  assert.match(svg, /data-background-logo="claude" opacity="0\.7"/);
  assert.match(svg, /translate\(64 66\) scale\(0\.76\)/);
  assert.match(svg, /font-size="15\.5"[^>]*>CLAUDE/);
  assert.match(svg, /font-size="20"/);
  assert.match(svg, /data-indicator="attention"/);
  assert.match(svg, /fill="#FF3355"/);
  assert.match(svg, /data-indicator="working"/);
  assert.match(svg, /fill="#00E5FF"[^>]*>確認待ち 1/);
  assert.match(svg, /font-family="Arial,sans-serif"/);
  assert.match(svg, /font-weight="700"/);
  assert.match(svg, /fill="#69E6A6"[^>]*>作業中 2/);
  assert.doesNotMatch(svg, /エラー/);
});

test("empty task positions do not expose session or slot terminology", () => {
  const empty = new StatusStore().sessionSnapshot(2, 1_000);
  assert.equal(empty.label, "空き");
  assert.equal(empty.task, "表示なし");
  assert.doesNotMatch(empty.task, /Session|セッション|スロット/i);
});

test("ignores subagent hook events so they do not complete the parent", () => {
  const store = new StatusStore();
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "one" }, 1_000);
  const changed = store.applyHook({ hook_event_name: "Stop", session_id: "one", agent_id: "child" }, 2_000);

  assert.equal(changed, false);
  assert.equal(store.snapshot(3_000).kind, "working");
});

test("marks explicit input tools and question-ending responses as waiting", () => {
  const store = new StatusStore();
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "one", prompt: "設定する" }, 1_000, "codex");
  store.applyHook({ hook_event_name: "PreToolUse", session_id: "one", tool_name: "request_user_input" }, 2_000, "codex");
  assert.equal(store.snapshot(3_000, "codex").kind, "attention");

  store.applyHook(
    { hook_event_name: "Stop", session_id: "one", last_assistant_message: "どちらの方法にしますか？" },
    4_000,
    "codex"
  );
  assert.equal(store.snapshot(5_000, "codex").kind, "attention");
  assert.equal(store.snapshot(5_000, "codex").detail, "回答してください");
});

test("renders an encoded SVG without leaking markup from project names", () => {
  const image = renderStatus({
    sessionId: "one",
    agent: "claude",
    kind: "working",
    project: "<script>alert(1)</script>",
    task: "表示確認",
    detail: "処理中",
    startedAt: 0,
    updatedAt: 0,
    scope: "all",
    activeSessions: 1,
    elapsedMs: 61_000
  }, 61_000);

  assert.match(image, /^data:image\/svg\+xml,/);
  assert.doesNotMatch(image, /<script>/);
  const svg = decodeURIComponent(image);
  assert.match(svg, /更新 1分前/);
  assert.match(svg, /font-size="16"/);
  assert.match(svg, /font-size="11\.5"/);
  assert.match(svg, /y="136"[^>]*>更新 1分前/);
  assert.match(svg, /data-indicator="working"/);
  assert.match(svg, /fill="#69E6A6"[^>]*>作業中/);
  assert.match(svg, /fill="#050608" stroke="#E36B3A"/);
  assert.match(svg, /fill="#FFFFFF"/);
});

test("renders a black Codex task with a blue frame, logo, and red wait marker", () => {
  const svg = decodeURIComponent(renderStatus({
    sessionId: "codex:one",
    agent: "codex",
    kind: "attention",
    project: "status-plugin",
    task: "StreamDeck Claude Code状態表示プラグイン作成",
    detail: "返信を確認してください",
    startedAt: 0,
    updatedAt: 0,
    scope: "all",
    slot: 0,
    activeSessions: 1,
    elapsedMs: 61_000
  }, 61_000));

  assert.match(svg, /fill="#050608" stroke="#1E96FF"/);
  assert.match(svg, /fill="#FFFFFF"/);
  assert.match(svg, />CODEX</);
  assert.match(svg, /data-background-logo="codex" opacity="0\.72"/);
  assert.match(svg, />StreamDeck</);
  assert.match(svg, /font-size="16"/);
  assert.match(svg, /data-indicator="attention"/);
  assert.match(svg, /fill="#FF3355"/);
  assert.match(svg, /fill="#00E5FF"[^>]*>確認待ち/);
  assert.doesNotMatch(svg, />セッション名</);
});

test("advances a large working indicator every 200 milliseconds", () => {
  const snapshot = {
    sessionId: "codex:animated",
    agent: "codex" as const,
    kind: "working" as const,
    project: "status-plugin",
    task: "アニメーション確認",
    detail: "処理中",
    startedAt: 0,
    updatedAt: 0,
    scope: "all" as const,
    activeSessions: 1,
    elapsedMs: 0
  };
  const first = decodeURIComponent(renderStatus(snapshot, 0));
  const second = decodeURIComponent(renderStatus(snapshot, 200));

  assert.match(first, /data-frame="0"/);
  assert.match(second, /data-frame="1"/);
  assert.match(first, /stroke-width="4"/);
  assert.match(first, /x2="30\.00" y2="26\.00"/);
  assert.notEqual(first, second);
});

test("pulses a new confirmation marker and then leaves it static", () => {
  const snapshot = {
    sessionId: "claude:waiting",
    agent: "claude" as const,
    kind: "attention" as const,
    project: "status-plugin",
    task: "回答を待つタスク",
    detail: "回答待ち",
    startedAt: 0,
    updatedAt: 0,
    scope: "all" as const,
    activeSessions: 1,
    elapsedMs: 0
  };

  const bright = decodeURIComponent(renderStatus(snapshot, 0));
  const dim = decodeURIComponent(renderStatus(snapshot, 500));
  const staticMarker = decodeURIComponent(renderStatus(snapshot, 10_000));
  assert.match(bright, /data-recent="true" data-pulse="true"/);
  assert.match(bright, /r="6\.3" fill="#FF3355" opacity="1"/);
  assert.match(dim, /data-recent="true" data-pulse="false"/);
  assert.match(dim, /r="6\.3" fill="#FF3355" opacity="0\.12"/);
  assert.match(staticMarker, /data-recent="false" data-pulse="false"/);
  assert.match(staticMarker, /r="6\.3" fill="#FF3355" opacity="1"/);
});

test("keeps the actual wait start time in an agent summary", () => {
  const store = new StatusStore();
  store.applyHook({ hook_event_name: "UserPromptSubmit", session_id: "one" }, 1_000, "claude");
  store.applyHook({ hook_event_name: "Stop", session_id: "one" }, 5_000, "claude");

  const summary = store.summarySnapshot(6_000, "claude");
  assert.equal(summary.updatedAt, 5_000);
  assert.match(decodeURIComponent(renderStatus(summary, 6_000)), /data-recent="true"/);
  assert.match(decodeURIComponent(renderStatus(summary, 15_000)), /data-recent="false"/);
});

test("keeps the current Claude chat title readable without truncation", () => {
  const image = decodeURIComponent(renderStatus({
    sessionId: "claude:sample-project",
    agent: "claude",
    kind: "attention",
    project: "example-user",
    task: "Sample Project",
    detail: "返信を確認してください",
    startedAt: 1_000,
    updatedAt: 2_000,
    scope: "all",
    activeSessions: 1,
    elapsedMs: 3_000
  }, 4_000));

  assert.match(image, />Sample Project<\/text>/);
  assert.match(image, />プロジェクト<\/text>/);
  assert.doesNotMatch(image, /プロジェ…/);
});

test("accepts hook JSON over its loopback HTTP endpoint", async () => {
  const store = new StatusStore();
  let updates = 0;
  const server = new HookServer(store, 0, () => updates++);
  const port = await server.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/hook/codex`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: "one",
        cwd: "/tmp/alpha",
        prompt: "現在の課題"
      })
    });
    assert.equal(response.status, 200);
    assert.equal(store.snapshot().kind, "working");
    assert.equal(store.snapshot().agent, "codex");
    assert.equal(updates, 1);
  } finally {
    await server.stop();
  }
});
