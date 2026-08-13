import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "claude-code-status-stream-deck-neo:v1";
const configDirectory = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const settingsPath = path.join(configDirectory, "settings.json");

if (!existsSync(settingsPath)) {
  console.log(`No Claude Code settings found at ${settingsPath}`);
  process.exit(0);
}

const original = await readFile(settingsPath, "utf8");
const settings = JSON.parse(original);
let removals = 0;

for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
  if (!Array.isArray(groups)) continue;
  const nextGroups = [];
  for (const group of groups) {
    if (!Array.isArray(group?.hooks)) {
      nextGroups.push(group);
      continue;
    }
    const hooks = group.hooks.filter((hook) => {
      const remove = hook?.command?.includes(MARKER);
      if (remove) removals++;
      return !remove;
    });
    if (hooks.length > 0) nextGroups.push({ ...group, hooks });
  }
  if (nextGroups.length > 0) settings.hooks[event] = nextGroups;
  else delete settings.hooks[event];
}

if (removals === 0) {
  console.log("No Claude Code Status hooks were installed.");
  process.exit(0);
}

const latest = await readFile(settingsPath, "utf8");
if (latest !== original) {
  throw new Error(`Claude Code settings changed during removal; no changes were written. Retry: ${settingsPath}`);
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
await copyFile(settingsPath, `${settingsPath}.backup-${timestamp}`);
const temporaryPath = `${settingsPath}.stream-deck-neo.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, settingsPath);
console.log(`Removed ${removals} Claude Code Status hooks from ${settingsPath}`);
