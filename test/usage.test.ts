import assert from "node:assert/strict";
import test from "node:test";

import {
  claudeFiveHourUsage,
  codexFiveHourUsage,
  CombinedUsageProvider
} from "../src/usage";
import { combinedUsageSvg } from "../src/usage-render";

test("reads only Claude's five-hour usage window", () => {
  assert.deepEqual(
    claudeFiveHourUsage({ five_hour: { utilization: 23.4, resets_at: "2026-08-14T01:00:00Z" } }),
    { usedPercent: 23, resetAt: Date.parse("2026-08-14T01:00:00Z"), state: "ok" }
  );
});

test("selects Codex's five-hour window and ignores its weekly window", () => {
  assert.deepEqual(
    codexFiveHourUsage({
      rate_limit: {
        primary_window: { used_percent: 28, limit_window_seconds: 604_800, reset_at: 1_800_000_000 },
        secondary_window: { used_percent: 17, limit_window_seconds: 18_000, reset_at: 1_700_000_000 }
      }
    }),
    { usedPercent: 17, resetAt: 1_700_000_000_000, state: "ok" }
  );
});

test("does not mislabel a Codex weekly-only limit as five-hour usage", () => {
  assert.deepEqual(
    codexFiveHourUsage({
      rate_limit: {
        primary_window: { used_percent: 28, limit_window_seconds: 604_800, reset_at: 1_800_000_000 }
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
        rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18_000 } }
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

test("renders both providers in one five-hour key without weekly usage", () => {
  const svg = combinedUsageSvg({
    claude: { usedPercent: 23, resetAt: null, state: "ok" },
    codex: { usedPercent: null, resetAt: null, state: "unavailable" },
    updatedAt: 1_000
  });

  assert.match(svg, />5H</);
  assert.match(svg, />CLAUDE</);
  assert.match(svg, />23%</);
  assert.match(svg, />CODEX</);
  assert.match(svg, />—</);
  assert.doesNotMatch(svg, /WEEK|weekly|週間/i);
  assert.match(svg, /#FF7548/);
  assert.match(svg, /#159DFF/);
});
