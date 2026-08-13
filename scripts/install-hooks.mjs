import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "claude-code-status-stream-deck-neo:v1";
const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  "StopFailure",
  "SessionEnd"
];
const COMMAND = `/usr/bin/curl --silent --max-time 0.25 --request POST --header 'Content-Type: application/json' --data-binary @- http://127.0.0.1:37654/hook/claude >/dev/null 2>&1 || true # ${MARKER}`;

const configDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const settingsPath = path.join(configDirectory, "settings.json");
await mkdir(configDirectory, { recursive: true });

let settings = {};
let original = "";
if (existsSync(settingsPath)) {
  original = await readFile(settingsPath, "utf8");
  try {
    settings = JSON.parse(original);
  } catch (error) {
    throw new Error(`Claude Code settings is not valid JSON: ${settingsPath}`, { cause: error });
  }
}

settings.hooks ??= {};
let additions = 0;
let updates = 0;
for (const event of EVENTS) {
  settings.hooks[event] ??= [];
  let alreadyInstalled = false;
  for (const group of settings.hooks[event]) {
    if (!Array.isArray(group?.hooks)) continue;
    for (const hook of group.hooks) {
      if (hook?.command?.includes(MARKER)) {
        alreadyInstalled = true;
        if (hook.command !== COMMAND) {
          hook.command = COMMAND;
          hook.timeout = 1;
          updates++;
        }
      }
    }
  }
  if (!alreadyInstalled) {
    settings.hooks[event].push({
      matcher: "",
      hooks: [{ type: "command", command: COMMAND, timeout: 1 }]
    });
    additions++;
  }
}

if (additions === 0 && updates === 0) {
  console.log(`Claude Code hooks are already installed in ${settingsPath}`);
  process.exit(0);
}

const latest = existsSync(settingsPath) ? await readFile(settingsPath, "utf8") : "";
if (latest !== original) {
  throw new Error(`Claude Code settings changed during installation; no changes were written. Retry: ${settingsPath}`);
}

if (original) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  await copyFile(settingsPath, `${settingsPath}.backup-${timestamp}`);
}

const temporaryPath = `${settingsPath}.stream-deck-neo.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, settingsPath);
console.log(`Installed ${additions} and updated ${updates} Claude Code hook events in ${settingsPath}`);
