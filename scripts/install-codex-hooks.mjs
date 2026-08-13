import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "codex-agent-status-stream-deck-neo:v1";
const EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "Stop",
  "SessionEnd"
];
const COMMAND = `/usr/bin/curl --silent --max-time 0.25 --request POST --header 'Content-Type: application/json' --data-binary @- http://127.0.0.1:37654/hook/codex >/dev/null 2>&1 || true # ${MARKER}`;

const configDirectory = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const hooksPath = path.join(configDirectory, "hooks.json");
await mkdir(configDirectory, { recursive: true });

let hooksFile = { description: "Local lifecycle integrations.", hooks: {} };
let original = "";
if (existsSync(hooksPath)) {
  original = await readFile(hooksPath, "utf8");
  try {
    hooksFile = JSON.parse(original);
  } catch (error) {
    throw new Error(`Codex hooks file is not valid JSON: ${hooksPath}`, { cause: error });
  }
}

hooksFile.hooks ??= {};
let additions = 0;
let updates = 0;
for (const event of EVENTS) {
  hooksFile.hooks[event] ??= [];
  let alreadyInstalled = false;
  for (const group of hooksFile.hooks[event]) {
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
    hooksFile.hooks[event].push({
      matcher: "",
      hooks: [{ type: "command", command: COMMAND, timeout: 1 }]
    });
    additions++;
  }
}

if (additions === 0 && updates === 0) {
  console.log(`Codex hooks are already installed in ${hooksPath}`);
  process.exit(0);
}

const latest = existsSync(hooksPath) ? await readFile(hooksPath, "utf8") : "";
if (latest !== original) {
  throw new Error(`Codex hooks changed during installation; no changes were written. Retry: ${hooksPath}`);
}

if (original) {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  await copyFile(hooksPath, `${hooksPath}.backup-${timestamp}`);
}

const temporaryPath = `${hooksPath}.stream-deck-neo.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(hooksFile, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, hooksPath);
console.log(`Installed ${additions} and updated ${updates} Codex hook events in ${hooksPath}`);
console.log("Open /hooks in Codex and trust the new user hooks before using them.");
