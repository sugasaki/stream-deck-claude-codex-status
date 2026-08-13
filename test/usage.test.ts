import assert from "node:assert/strict";
import test from "node:test";

import {
  claudeFiveHourUsage,
  claudeFiveHourUsageFromHistory,
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

test("reads Claude's latest fresh five-hour usage from its local history", () => {
  const now = Date.parse("2026-08-14T01:30:00Z");
  assert.deepEqual(
    claudeFiveHourUsageFromHistory(JSON.stringify({
      samples: [
        { t: now - 20 * 60_000, u: { fh: 28 } },
        { t: now - 5 * 60_000, u: { fh: 35 } }
      ]
    }), now),
    { usedPercent: 35, resetAt: null, state: "ok" }
  );
  assert.equal(
    claudeFiveHourUsageFromHistory(JSON.stringify({
      samples: [{ t: now - 31 * 60_000, u: { fh: 35 } }]
    }), now),
    undefined
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
    readClaudeLocalUsage: async () => undefined,
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

test("prefers Claude's local usage and avoids the rate-limited API", async () => {
  let credentialReads = 0;
  let apiRequests = 0;
  const provider = new CombinedUsageProvider({
    readClaudeLocalUsage: async () => ({ usedPercent: 35, resetAt: null, state: "ok" }),
    readClaudeAccessToken: async () => {
      credentialReads++;
      return "claude-token";
    },
    requestClaudeUsage: async () => {
      apiRequests++;
      throw new Error("HTTP 429");
    },
    readCodexCredentials: async () => undefined
  });

  const snapshot = await provider.getUsage();
  assert.equal(snapshot.claude.usedPercent, 35);
  assert.equal(credentialReads, 0);
  assert.equal(apiRequests, 0);
});

test("renders Claude five-hour and Codex weekly usage in one key", () => {
  const svg = combinedUsageSvg({
    claude: { usedPercent: 25, resetAt: null, state: "ok" },
    codex: { usedPercent: 31, resetAt: null, state: "ok" },
    updatedAt: 1_000
  });

  assert.match(svg, />USAGE</);
  assert.match(svg, /data-usage-logo="claude"/);
  assert.match(svg, /font-size="22">25<\/tspan>/);
  assert.match(svg, /font-size="15">% \/ 5h<\/tspan>/);
  assert.match(svg, /data-usage-logo="codex"/);
  assert.match(svg, /font-size="22">31<\/tspan>/);
  assert.match(svg, /font-size="15">% \/ w<\/tspan>/);
  assert.doesNotMatch(svg, />CLAUDE</);
  assert.doesNotMatch(svg, />CODEX</);
  assert.match(svg, /#FF7548/);
  assert.match(svg, /#159DFF/);
});
