const kind = process.argv[2] || "working";
const agent = process.argv[3] || "claude";
const events = {
  ready: { hook_event_name: "SessionStart" },
  working: { hook_event_name: "PreToolUse", tool_name: "Bash" },
  attention: { hook_event_name: "PermissionRequest", tool_name: "Bash" },
  done: { hook_event_name: "Stop" },
  error: { hook_event_name: "StopFailure" },
  offline: { hook_event_name: "SessionEnd" }
};

if (!events[kind]) {
  throw new Error(`Unknown demo status: ${kind}. Use ready, working, attention, done, error, or offline.`);
}

if (!["claude", "codex"].includes(agent)) throw new Error("Agent must be claude or codex.");

const response = await fetch(`http://127.0.0.1:37654/hook/${agent}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ...events[kind],
    session_id: `demo-${agent}`,
    cwd: process.cwd(),
    prompt: `${agent === "codex" ? "Codex" : "Claude Code"} のデモセッション`
  })
});
if (!response.ok) throw new Error(`Hook server returned HTTP ${response.status}`);
console.log(`Sent ${agent} ${kind} demo status.`);
