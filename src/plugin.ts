import streamDeck from "@elgato/streamdeck";

import { ClaudeRemoteTitleResolver } from "./claude-remote-title";
import { ClaudeTaskNameResolver } from "./claude-task-name";
import { CodexTaskMonitor } from "./codex-task-monitor";
import { StatePersistence } from "./persistence";
import { HookServer } from "./server";
import { SessionAppActivator } from "./session-app";
import { StatusStore } from "./status";
import { CombinedUsageProvider } from "./usage";
import { CombinedUsageAction } from "./usage-action";
import {
  ClaudeStatusAction,
  CodexStatusAction,
  Session1Action,
  Session2Action,
  Session3Action,
  Session4Action,
  Session5Action,
  Session6Action,
  Session7Action,
  Session8Action,
  UnifiedStatusAction
} from "./status-action";

const HOOK_PORT = 37_654;
const store = new StatusStore();
const persistence = new StatePersistence();
const claudeRemoteTitles = new ClaudeRemoteTitleResolver();
const claudeTaskNames = new ClaudeTaskNameResolver();
const usageProvider = new CombinedUsageProvider();
const usageAction = new CombinedUsageAction(usageProvider);
const sessionAppActivator = new SessionAppActivator({
  onError: (error) => streamDeck.logger.error(`Could not activate session app: ${String(error)}`)
});
const saveState = () => {
  void persistence.save(store).catch((error: unknown) =>
    streamDeck.logger.error(`Could not save session state: ${String(error)}`)
  );
};

streamDeck.logger.setLevel("info");
try {
  if (await persistence.load(store)) streamDeck.logger.info("Restored the previous session state");
} catch (error: unknown) {
  streamDeck.logger.error(`Could not restore session state: ${String(error)}`);
}

const statusActions = [
  new UnifiedStatusAction(store),
  new ClaudeStatusAction(store),
  new CodexStatusAction(store),
  new Session1Action(store, sessionAppActivator),
  new Session2Action(store, sessionAppActivator),
  new Session3Action(store, sessionAppActivator),
  new Session4Action(store, sessionAppActivator),
  new Session5Action(store, sessionAppActivator),
  new Session6Action(store, sessionAppActivator),
  new Session7Action(store, sessionAppActivator),
  new Session8Action(store, sessionAppActivator)
];
const refreshClaudeTaskName = async (sessionId: string, transcriptPath?: string): Promise<void> => {
  try {
    const [remoteResult, transcriptResult] = await Promise.allSettled([
      claudeRemoteTitles.resolve(sessionId),
      claudeTaskNames.resolve(sessionId, transcriptPath)
    ]);
    if (remoteResult.status === "rejected") {
      streamDeck.logger.debug(`Could not read Claude remote title: ${String(remoteResult.reason)}`);
    }
    if (transcriptResult.status === "rejected") throw transcriptResult.reason;
    const taskName = remoteResult.status === "fulfilled" && remoteResult.value
      ? remoteResult.value
      : transcriptResult.value;
    if (!taskName || !store.updateSessionTask(`claude:${sessionId}`, taskName)) return;
    saveState();
    await Promise.all(statusActions.map((statusAction) => statusAction.refresh()));
  } catch (error: unknown) {
    streamDeck.logger.error(`Could not read Claude task name: ${String(error)}`);
  }
};
const hookServer = new HookServer(store, HOOK_PORT, () => {
  saveState();
  void Promise.all(statusActions.map((statusAction) => statusAction.refresh())).catch((error: unknown) =>
    streamDeck.logger.error(String(error))
  );
}, (payload, source) => {
  if (source !== "claude" || typeof payload.session_id !== "string") return;
  void refreshClaudeTaskName(
    payload.session_id,
    typeof payload.transcript_path === "string" ? payload.transcript_path : undefined
  );
});
const codexTaskMonitor = new CodexTaskMonitor(
  (sessions) => {
    if (!store.syncAgentSessions("codex", sessions)) return;
    saveState();
    void Promise.all(statusActions.map((statusAction) => statusAction.refresh())).catch((error: unknown) =>
      streamDeck.logger.error(String(error))
    );
  },
  (error) => streamDeck.logger.error(`Could not read Codex task state: ${String(error)}`)
);

for (const statusAction of statusActions) streamDeck.actions.registerAction(statusAction);
streamDeck.actions.registerAction(usageAction);
streamDeck.connect();
codexTaskMonitor.start();
for (const session of store.export()) {
  if (session.agent === "claude" && session.sessionId.startsWith("claude:")) {
    void refreshClaudeTaskName(session.sessionId.slice("claude:".length));
  }
}

const claudeTitleTimer = setInterval(() => {
  for (const session of store.export()) {
    if (session.agent === "claude" && session.sessionId.startsWith("claude:")) {
      void refreshClaudeTaskName(session.sessionId.slice("claude:".length));
    }
  }
}, 15_000);
claudeTitleTimer.unref();

hookServer
  .start()
  .then((port) => streamDeck.logger.info(`Claude Code hook server is listening on 127.0.0.1:${port}`))
  .catch((error: unknown) => streamDeck.logger.error(`Could not start hook server: ${String(error)}`));

const refreshTimer = setInterval(() => {
  void Promise.all(statusActions.map((statusAction) => statusAction.refresh())).catch((error: unknown) =>
    streamDeck.logger.error(String(error))
  );
}, 200);
refreshTimer.unref();

const usageRefreshTimer = setInterval(() => {
  void usageAction.refresh().catch((error: unknown) =>
    streamDeck.logger.error(`Could not refresh usage: ${String(error)}`)
  );
}, 60_000);
usageRefreshTimer.unref();
