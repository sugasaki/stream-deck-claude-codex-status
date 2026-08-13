import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { type SessionStatus, StatusStore } from "./status";

export const SESSION_STATE_PATH = path.join(
  homedir(),
  "Library",
  "Application Support",
  "Claude-Codex-Status",
  "session-state.json"
);

interface PersistedState {
  version: 1;
  sessions: SessionStatus[];
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class StatePersistence {
  #pendingSave: Promise<void> = Promise.resolve();

  constructor(private readonly statePath = SESSION_STATE_PATH) {}

  async load(store: StatusStore): Promise<boolean> {
    let contents: string;
    try {
      contents = await readFile(this.statePath, "utf8");
    } catch (error: unknown) {
      if (isMissingFile(error)) return false;
      throw error;
    }

    const parsed = JSON.parse(contents) as Partial<PersistedState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
      throw new Error("Unsupported session state file");
    }
    store.restore(parsed.sessions);
    return true;
  }

  save(store: StatusStore): Promise<void> {
    const state: PersistedState = { version: 1, sessions: store.export() };
    const directory = path.dirname(this.statePath);
    const temporaryPath = `${this.statePath}.${process.pid}.tmp`;

    this.#pendingSave = this.#pendingSave
      .catch(() => undefined)
      .then(async () => {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await writeFile(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.statePath);
      });
    return this.#pendingSave;
  }
}
