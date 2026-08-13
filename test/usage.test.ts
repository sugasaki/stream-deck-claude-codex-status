import assert from "node:assert/strict";
import test from "node:test";

import {
  claudeFiveHourUsage,
  codexWeeklyUsage,
  CombinedUsageProvider
} from "../src/usage";
import { combinedUsageSvg } from "../src/usage-render";

test("reads only Claude's five-hour usage window", () => {
  assert.deepEqual(
    claudeFiveHourUsage({ five_hour: { utilization: 23.4, resets_at: "2026-08-14T01:00:00Z" } }),
    { usedPercent: 23, resetAt: Date.parse("2026-08-14T01:00:00Z"), state: "ok" }
  );
});

test("selects Codex's weekly window and ignores its five-hour window", () => {
  assert.deepEqual(
    codexWeeklyUsage({
      rate_limit: {
        primary_window: { used_percent: 28, limit_window_seconds: 604_800, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 17, limit_window_seconds: 18_000, reset_at: 1_700_000_000 }
      }
    }),
    { usedPercent: 28, resetAt: 1_800_000_000_000, state: "ok" }
  );
});

test("returns unavailable when Codex has no weekly limit", () => {
  assert.deepEqual(
    codexWeeklyUsage({
      rate_limit: {
        primary_window: { used_percent: 17, limit_window_seconds: 18_000, reset_at: 1_700_000_000 }
      }
    }),
    { usedPercent: null, resetAt: null, state: "unavailable" }
  );
});

test("loads Claude and Codex usage together and caches the result", async () => {
  let claudeRequests = 0;
  let codexRequests = 0;
  const provider = new CombinedUsageProvider({
    now: () => 1_000,
    readClaudeAccessToken: async () => "claude-token",
    requestClaudeUsage: async () => {
      claudeRequests++;
      return { five_hour: { utilization: 31 } };
    },
    readCodexCredentials: async () => ({ accessToken: "codex-token" }),
    requestCodexUsage: async () => {
      codexRequests++;
      return {
        rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 604_800 } }
      };
    }
  });

  const first = await provider.getUsage();
  const second = await provider.getUsage();
  assert.equal(first, second);
  assert.equal(first.claude.usedPercent, 31);
  assert.equal(first.codex.usedPercent, 42);
  assert.equal(claudeRequests, 1);
  assert.equal(codexRequests, 1);
});

test("renders Claude five-hour and Codex weekly usage in one key", () => {
  const svg = combinedUsageSvg({
    claude: { usedPercent: 25, resetAt: null, state: "ok" },
    codex: { usedPercent: 31, resetAt: null, state: "ok" },
    updatedAt: 1_000
  });

  assert.match(svg, />USAGE</);
  assert.match(svg, />CLAUDE</);
  assert.match(svg, />25% \/ 5h</);
  assert.match(svg, />CODEX</);
  assert.match(svg, />31% \/ w</);
  assert.match(svg, /#FF7548/);
  assert.match(svg, /#159DFF/);
});
