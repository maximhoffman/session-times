# session-times

A Claude Code mod that lists every background session, grouped by project. For each session it shows when the session started, how long it was actively worked on, and how long ago a person last wrote to it.

Claude Code's built-in agents view shows a single "age" per row. That number counts from when the session was created, and it freezes when the run finishes. So it can't answer "which sessions have I not touched for days?" This mod can.

## What it shows

| Column   | Meaning |
| -------- | ------- |
| Сессия   | Session name, as in the agents view |
| Статус   | работает / ждёт вас / готово / стоп (working / waiting for you / done / stopped) |
| Запущена | When the session was created (local time) |
| Активно  | Active time: the sum of gaps between consecutive transcript entries that are at most 5 minutes apart. Nights and long waits for a reply don't count |
| Общались | Time since the last message a person typed into the session. Task notifications and system reminders don't count |

Sessions are grouped by the folder they were started in. Worktrees are folded into their repository. Project names are shown in bold, with a session count next to each. Groups, and the sessions inside each group, are sorted by the most recent conversation.

## Usage

- `/session-times` prints the table into the transcript at full terminal width. The table refreshes every 30 seconds for 15 minutes, then stops. Run the command again for a fresh table at the bottom of the transcript.
- `/session-times-pane` opens the same table as a side pane. So do `/session-times pane` and `/session-times panel`. The separate command exists because Claude Code's command typeahead lists commands, not their arguments; `/session-times` only shows a dim `[pane|panel]` hint. Claude Code caps a side pane at 45% of the terminal width. The pane opens focused and keeps refreshing while it is open.
  - `r` refreshes
  - `Esc` or `x` closes the pane
  - `Tab` moves between the buttons and `Enter` presses one
  - The arrow keys scroll

The labels in the table are in Russian.

## Install

The mod has to be loaded as a plugin folder. Pick one of these:

- For one session: `claude --plugin-dir ~/Projects/Develop/session-times`
- For every session: add the folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`:

  ```json
  { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Projects/Develop/session-times" } }
  ```

The mod needs `python3` on `PATH`.

## How it works

- `bin/session_times.py` collects the data. It reads `~/.claude/jobs/*/state.json` (name, state, creation time, project folder, transcript path) and each session's transcript.
  - Transcripts are append-only. Each one is read in full once, and after that only from the offset reached last time.
  - Partial totals are cached in `~/.cache/claude-session-times/cache.json`, or under `$XDG_CACHE_HOME` if it is set.
  - A full run over about 40 sessions (~130 MB of transcripts) takes about 0.4 s the first time and about 0.02 s after that.
- `hooks/register.tsx` is the hooks module. It registers the command, runs the collector through `$.process.run`, keeps the latest snapshot in `$.state`, and draws the table in both views.
- `types/index.d.ts` declares the shape of the state.

Active time isn't taken from the session's state timeline (`timeline.jsonl`). That timeline proved unreliable in both directions: one session stayed "working" overnight for 14 hours with no activity, and recent work went unrecorded.

## Development

```sh
claude plugin validate .
claude plugin test .
```

Claude Code generates `.claude-plugin/types/` when it loads the mod. That folder is ignored by git, and `tsconfig.json` extends it.
