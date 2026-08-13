import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKER = "codex-agent-status-stream-deck-neo:v1";
const configDirectory = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const hooksPath = path.join(configDirectory, "hooks.json");

if (!existsSync(hooksPath)) {
  console.log(`No Codex hooks found at ${hooksPath}`);
  process.exit(0);
}

const original = await readFile(hooksPath, "utf8");
const hooksFile = JSON.parse(original);
let removals = 0;
for (const [event, groups] of Object.entries(hooksFile.hooks ?? {})) {
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
  if (nextGroups.length > 0) hooksFile.hooks[event] = nextGroups;
  else delete hooksFile.hooks[event];
}

if (removals === 0) {
  console.log("No Codex Agent Status hooks were installed.");
  process.exit(0);
}

const latest = await readFile(hooksPath, "utf8");
if (latest !== original) {
  throw new Error(`Codex hooks changed during removal; no changes were written. Retry: ${hooksPath}`);
}

const timestamp = new Date().toISOString().replaceAll(":", "-");
await copyFile(hooksPath, `${hooksPath}.backup-${timestamp}`);
const temporaryPath = `${hooksPath}.stream-deck-neo.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(hooksFile, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryPath, hooksPath);
console.log(`Removed ${removals} Codex Agent Status hooks from ${hooksPath}`);
