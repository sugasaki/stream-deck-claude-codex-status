# Claude & Codex Status for Stream Deck Neo

English | [日本語](README.ja.md)

[![Version](https://img.shields.io/github/v/tag/sugasaki/stream-deck-claude-codex-status?label=version)](https://github.com/sugasaki/stream-deck-claude-codex-status/tags)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A macOS Stream Deck plugin that displays live Claude Code and Codex task sessions.

After you send an instruction and switch to another task, the plugin tells you when an agent has finished replying or needs permission. Completed responses get a prominent `完了！` (Complete!) alert, while permission and input requests use `確認待ち` (Needs attention), both with the actual session name. You can see multiple Claude Code and Codex tasks at a glance and bring the originating app to the foreground by pressing its task key.

![Recommended Stream Deck Neo page 1 layout](assets/readme-preview.svg)

<p align="center">
  <strong>Live device demo</strong><br>
  <img src="assets/stream-deck-neo-demo.gif" alt="Claude and Codex status running on Stream Deck Neo" width="420"><br>
  <sub>Session names and usage values are anonymized.</sub>
</p>

## Features

- Shows `作業中` (Working), `完了！` (Complete!), `確認待ち` (Needs attention), and `エラー` (Error) for Claude Code and Codex
- Combines both agents and displays up to 13 real tasks across two pages, sorted by most recent update
- Uses renameable Claude and Codex chat titles as session names
- Flashes the entire key between high-visibility red and yellow for 10 seconds after a response completes, then keeps a static red completion display until you physically press the corresponding task or summary key
- Animates a large working indicator at five frames per second
- Brings the app that started a task to the foreground when its key is pressed
- Removes a task waiting for confirmation when its key is held for at least 0.8 seconds
- Combines Claude five-hour usage and Codex weekly usage on one key
- Restores recent task state after Stream Deck restarts

## Requirements

<p align="center">
  <strong>Supported hardware example: Elgato Stream Deck Neo</strong><br>
  <img src="assets/stream-deck-neo.jpg" alt="Elgato Stream Deck Neo" width="520">
</p>

| Item | Requirement |
| --- | --- |
| OS | macOS 13 or later |
| Stream Deck | Stream Deck 7.1 or later |
| Device | Optimized for Stream Deck Neo |
| Development and hook setup | Node.js 24 or later |
| Agent | Claude Code, Codex, or both |

The key images target 144×144-pixel LCD keys. You can add the Keypad actions to other Stream Deck models, but this repository is designed around the Neo 2×4 layout.

## Installation

### 1. Install the plugin

If you have a packaged `.streamDeckPlugin` file, double-click it to install the plugin in Stream Deck.

To build from source:

```sh
git clone https://github.com/sugasaki/stream-deck-claude-codex-status.git
cd stream-deck-claude-codex-status
npm install
npm run pack
open dist/com.atsu.claude-code-status.streamDeckPlugin
```

### 2. Install the agent hooks

Run the following commands from the repository directory:

```sh
npm run hooks:install
npm run codex-hooks:install
```

- The Claude Code hook is added to `~/.claude/settings.json`.
- The Codex hook is added to `~/.codex/hooks.json`.
- Existing settings are preserved. The installers only add or update entries marked as belonging to this plugin.
- A backup is created next to an existing settings file before it is changed.
- If another process changes the file between reading and writing, the installer stops instead of overwriting the newer file.

In Codex, open `/hooks` and trust the newly installed user hook. This lets permission requests appear immediately.

### 3. Arrange the keys

In the Stream Deck app, add these actions from the `Claude & Codex Status` category.

Page 1 keeps the summaries, the five most recently updated tasks, and usage:

| Position | Action shown in Stream Deck | Purpose |
| --- | --- | --- |
| Top 1 | `Claude Code 概要` | Claude attention and working counts |
| Top 2 | `Codex 概要` | Codex attention and working counts |
| Top 3 | `最新更新タスク` | Most recently updated task |
| Top 4 | `1つ前の更新タスク` | Second most recent task |
| Bottom 1 | `2つ前の更新タスク` | Third most recent task |
| Bottom 2 | `3つ前の更新タスク` | Fourth most recent task |
| Bottom 3 | `4つ前の更新タスク` | Fifth most recent task |
| Bottom 4 | `Claude 5時間 + Codex 週間使用率` | Combined usage display |

Page 2 continues the same update-time order with eight more tasks:

| Position | Action shown in Stream Deck | Purpose |
| --- | --- | --- |
| Top 1 | `5つ前の更新タスク` | Sixth most recent task |
| Top 2 | `6つ前の更新タスク` | Seventh most recent task |
| Top 3 | `7つ前の更新タスク` | Eighth most recent task |
| Top 4 | `8つ前の更新タスク` | Ninth most recent task |
| Bottom 1 | `9つ前の更新タスク` | Tenth most recent task |
| Bottom 2 | `10件前の更新タスク` | Eleventh most recent task |
| Bottom 3 | `11件前の更新タスク` | Twelfth most recent task |
| Bottom 4 | `12件前の更新タスク` | Thirteenth most recent task |

The legacy `AI Agent Status` action remains for compatibility but is hidden from the list of new actions. You can remove it if it is still assigned to a key.

## Status meanings

| Display | Meaning |
| --- | --- |
| `作業中` (Working) | The agent is generating a response or running a tool |
| `完了！` (Complete!) | The agent finished its response and is waiting for you to check it |
| `確認待ち` (Needs attention) | The agent needs an answer, choice, or execution permission |
| `エラー` (Error) | A tool or response failed or was interrupted |
| `空き` / `表示なし` (Empty) | There is no real task for that key position |

The summary keys count Claude and Codex separately. Errors are not included in the summary counts; they appear only on their task keys.

## Task ordering and removal

Claude Code and Codex tasks are combined and sorted by the agents' most recent update time. Status does not affect the order, so a newer working task appears before an older task that needs attention. The first five tasks appear on page 1, and the next eight continue on page 2.

A short press on a task key does not remove it. A task leaves the display when its main Claude or Codex task ends, when a Codex task is archived, when it has not been updated for more than eight hours, or when you hold a `確認待ち` task key for at least 0.8 seconds. After a response completes, the plugin keeps the task in `確認待ち` until you return to it or mark it complete with a long press. A later agent update makes the task visible again.

## Session names

### Codex

The plugin prefers the renamed task title in `~/.codex/session_index.jsonl`. If no renamed title is available, it falls back to the task's local record. Renaming a task does not change its sort position.

### Claude Code

The plugin looks for a usable name in this order:

1. A chat title renamed through Remote Control
2. A renamed session title in local records
3. A Claude-generated title or agent name
4. The latest request that can identify the task
5. The first meaningful request

Generic text such as `OK` or `Continue`, local commands, and image notifications are excluded from title candidates. Remote Control title changes normally appear within about 15 seconds.

## What happens when you press a task key

A short press on a task key returns the prominent completion alert to the normal `確認待ち` display, keeps the task in the list, and brings the app most likely to contain that session to the foreground. Holding a `確認待ち` task key for at least 0.8 seconds marks that response complete and removes it from the task list. Long-pressing a working task does not remove it.

- Claude Code: walks up the session PID's parent processes to identify the actual `.app`, such as Ghostty or Terminal
- Codex: uses the recorded origin application and can open supported apps such as Zed, Visual Studio Code, or Chrome
- Codex desktop: opens the exact ChatGPT task through `codex://threads/<task-id>`
- Fallback: opens the Claude app for Claude sessions or the ChatGPT app for Codex sessions

Pressing the Claude or Codex summary key once returns that agent's prominent completion alerts to the normal display. The unified summary key applies to both agents. Tasks stay in the list and remain in the normal `確認待ち` state. Pressing the usage key redraws it immediately.

## Usage display

| Agent | Window | Primary source | Network interval |
| --- | --- | --- | --- |
| Claude | Five hours | Anthropic OAuth usage API | At least five minutes |
| Codex | Weekly | ChatGPT/Codex usage API | Once per minute |

The Claude integration follows the approach used by [CodexBar](https://github.com/steipete/CodexBar).

- Detects the installed Claude Code version and sends a `claude-code/<version>` User-Agent
- Separates Stream Deck redraws from Anthropic API requests
- Honors `Retry-After`, with a minimum five-minute cooldown after HTTP 429
- Keeps the last successful value when a request fails
- If there is no successful value, falls back to Claude Desktop usage data written within the last 30 minutes
- Does not bypass the minimum interval or cooldown when the key is pressed

Typical values are shown as `42% / 5h` for Claude and `38% / w` for Codex. The key displays `—` when the plan or API does not provide that window, `LOGIN` when credentials are unavailable, and `ERR` only when a temporary error occurs and neither a successful nor fallback value exists.

## How it works

### Status events

- Claude Code lifecycle hooks send events to the local HTTP server at `127.0.0.1:37654`.
- Codex start and completion states are read from local task records, while the user hook supplements permission requests.
- The plugin keeps only the agent, state, shortened session name, and timestamps required for the display.

### Local storage

Recent display state is stored at:

```text
~/Library/Application Support/Claude-Codex-Status/session-state.json
```

This file restores the display after Stream Deck restarts. Entries that have not been updated for more than eight hours are discarded automatically.

### External connections

| Purpose | Destination |
| --- | --- |
| Claude five-hour usage | `https://api.anthropic.com/api/oauth/usage` |
| Claude Remote Control titles | Claude's official `api.anthropic.com` service |
| Codex weekly usage | `https://chatgpt.com/backend-api/wham/usage` |

Local session names and status monitoring continue to work when Remote Control is not in use or the network is unavailable.

## Privacy and credentials

- The plugin does not store conversation bodies, full prompts, file contents, or tool input and output.
- Session names are limited to 80 characters and split into at most three display lines.
- Usage providers read the existing Claude Code and Codex login, but the plugin does not save tokens in its own files.
- Authentication tokens, cookies, and API response bodies are never written to logs.
- Status hooks send only to localhost and are not forwarded externally.
- External API traffic is limited to usage data and Remote Control title lookup.

## Troubleshooting

### The key shows `未接続` (Disconnected)

1. Make sure the Stream Deck app is running.
2. Reinstall the plugin or restart the Stream Deck app.
3. Check the local server:

```sh
curl http://127.0.0.1:37654/health
```

If the response begins with `{"ok":true,...}`, the plugin is running. Also check that another application is not using port 37654.

### Tasks do not appear

- Run `npm run hooks:install` and `npm run codex-hooks:install` again.
- In Codex, open `/hooks` and confirm that the user hook is trusted.
- Send one new request in Claude Code or Codex to generate a lifecycle event.

### A session name is stale or shows a request instead of the chat title

- Rename the chat in Claude or Codex.
- Allow about 15 seconds for a Claude Remote Control title to update.
- A Codex title updates after its local session index is written.

### Usage shows `ERR`, `LOGIN`, or `—`

- `ERR`: A network error or HTTP 429 occurred and there is no successful or local fallback value. Wait at least five minutes and check again.
- `LOGIN`: Sign in to the corresponding CLI again.
- `—`: The API or subscription plan does not provide a value for that time window.

### A task key opens the wrong app

If the originating app cannot be identified, the plugin opens Claude or ChatGPT. It cannot identify an individual window when the session is not running as a child process of a terminal or editor.

## Updating

Double-click a newer `.streamDeckPlugin` file to install it over the existing version. To update from source:

```sh
git pull
npm install
npm run pack
open dist/com.atsu.claude-code-status.streamDeckPlugin
npm run hooks:install
npm run codex-hooks:install
```

The hook installers are idempotent and do not add duplicate plugin entries when run repeatedly.

## Uninstalling

```sh
npm run hooks:uninstall
npm run codex-hooks:uninstall
```

Remove `Claude & Codex Status` from the Stream Deck app settings. If you also want to remove saved display state, delete this directory in Finder:

```text
~/Library/Application Support/Claude-Codex-Status
```

## Development

```sh
npm install
npm run check
npm test
npm run build
npm run validate
npm run pack
```

| Command | Purpose |
| --- | --- |
| `npm run watch` | Watch, build, and restart the plugin after changes |
| `npm run preview` | Regenerate the anonymous README preview |
| `npm run demo -- working claude` | Send a test Claude working event |
| `npm run demo -- attention codex` | Send a test Codex attention event |

Valid states are `ready`, `working`, `attention`, `done`, `error`, and `offline`. Valid agents are `claude` and `codex`.

Key implementation files:

| File | Responsibility |
| --- | --- |
| `src/status.ts` | Session state, sorting, and restoration |
| `src/render.ts` | Summary and task key SVG rendering |
| `src/codex-task-monitor.ts` | Local Codex task monitoring |
| `src/claude-task-name.ts` | Local Claude session title resolution |
| `src/claude-remote-title.ts` | Claude Remote Control title resolution |
| `src/session-app.ts` | Originating app detection and fallback |
| `src/usage.ts` | Claude/Codex usage retrieval, caching, and backoff |
| `src/server.ts` | Localhost hook receiver |

Agents modifying this repository should also follow [`AGENTS.md`](AGENTS.md).

## Releases and versioning

- Git tag: `v<major>.<minor>.<patch>`
- npm package: `<major>.<minor>.<patch>`
- Stream Deck manifest: `<major>.<minor>.<patch>.0`
- Distribution file: `dist/com.atsu.claude-code-status.streamDeckPlugin`

Before a release, `npm run pack` must pass type checking, all tests, the build, and Stream Deck manifest validation.

## License

[MIT License](LICENSE)
