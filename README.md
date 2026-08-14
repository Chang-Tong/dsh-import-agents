# dsh-import-agents

Import your **pi** (pi-coding-agent) and **opencode** sessions, chat history, and agents into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) — with a one-click **Sync** button in the composer.

Imported sessions appear in the dsh session list, are fully browsable, and can be **resumed**: the model continues with the complete conversation history (text, reasoning, tool calls) as context. Custom agents and mode prompts become discoverable dsh skills.

中文文档见 [README.zh.md](README.zh.md).

## Features

- **Session import** — parse pi JSONL session files and the opencode SQLite store into real dsh sessions (same on-disk format the dsh JSONL persistence backend writes; verified with the backend's own `list` / `load` / `prepare`).
- **Agents → skills** — convert pi agents / mode prompts and opencode agents into dsh skill bundles under `$DSH_AGENTS_HOME/skills` (default `~/.agents/skills`), invocable by name.
- **One-click Sync button** — a small control in the composer tool row (`conversation.input.left` slot) that runs `/import-all` and shows the result inline.
- **Session-start migration prompt** — when a new top-level session starts, the plugin asks (via `ctx.userQuestions`) whether to migrate pending pi/opencode sessions and agents. Per-project decisions are remembered in `$DSH_HOME/import-pi-opencode-state.json`, so it never nags twice.
- **Workspace placement** — imported sessions are attached to a workspace matching their original `cwd` (created on demand) instead of piling up in the ungrouped bucket. Workspace titles carry a shortened absolute path (`name (~/last/segments)`) so same-named projects stay distinguishable; `/attach-workspaces` retro-fits existing imports.
- **Idempotent** — stable session ids (`pi-<uuid>` / `oc-<opencode-id>`); re-imports skip what already exists.
- **Zero runtime dependencies** — Node built-ins (`node:zlib` zstd, `node:sqlite`) plus dsh platform modules.

## Data sources

| Source | Location | Content |
| --- | --- | --- |
| pi sessions | `~/.pi/agent/sessions/<project>/<timestamp>_<uuid>.jsonl` | conversations (text + reasoning + tool calls) |
| opencode sessions | `~/.local/share/opencode/opencode.db` (SQLite) | conversations (text / reasoning / tool parts) |
| pi agents | `~/.pi/agent/agents/*.md` | custom agents (e.g. k3-reviewer) |
| pi mode prompts | `~/.pi/agent/prompts/*.md` | mode prompt templates |
| opencode agents | `~/.config/opencode/agents/*.md` | agents (e.g. k3-reviewer, kimi-vision) |

## Install

Add the plugin to your dsh profile (shown here for the `web` profile):

```sh
cd ~/.dsh/profiles/web
# from npm (recommended for users)
pnpm add dsh-import-agents
# from git: pnpm add git+https://github.com/Chang-Tong/dsh-import-agents.git
# or locally: pnpm add file:/path/to/dsh-import-agents
```

Append to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: import-pi-opencode
      name: dsh-import-agents
```

Restart `dsh web`. The host plugin registers the slash commands, and the client bundle (the Sync button) is served automatically — no extra config. Disable the session-start prompt with `config: { offerOnStart: false }` on the row.

## Usage

### Sync button

Refresh the page, then look at the composer tool row (left of the input): the **同步 (Sync)** button runs the full import (`/import-all`) and shows the result inline.

### Slash commands

| Command | What it does |
| --- | --- |
| `/import-pi [options]` | Import pi sessions |
| `/import-opencode [options]` | Import opencode sessions |
| `/import-agents` | Convert pi/opencode agents & prompts into dsh skills |
| `/import-all [options]` | All of the above |
| `/attach-workspaces` | Attach imported sessions to cwd-matched workspaces (retro-fit) |

Options: `--limit N`, `--project <substr>`, `--since <iso|ms>`, `--no-tools` (drop tool calls), `--tools` (keep `tool-call` blocks), `--tool-truncate N`.

### CLI (no dsh needed)

```sh
node import.mjs all          # dry-run preview
node import.mjs all --apply  # write sessions + skills
node export.mjs              # export sessions as Markdown for any agent to read
```

## Import rules

- Each user message opens a turn (`turn/start` + `user/message`); following assistant messages join it with increasing step numbers; every turn closes with `turn/end`. The event log is balanced and matches the dsh persistence contract.
- pi `thinking` → dsh `reasoning` blocks; pi `toolCall` / opencode `tool` parts / claude `tool_use` / codex `tool_use` → `tool-call` content blocks **plus paired `tool/call` + `tool/result` events**: the trajectory UI renders the call cards, and the placeholder `tool/result` answers every `tool_calls` so OpenAI-compatible APIs accept resumed requests (orphaned `tool_calls` are rejected with `insufficient tool messages following tool_calls message`). `--tools-as-text` switches to plain text (no trajectory cards); `--no-tools` drops tool calls.
- `step-start` / `step-finish` / `patch` / `file` / `compaction` opencode parts are skipped as mechanical records.
- Sessions are written under `$DSH_HOME/sessions` in the exact dsh JSONL layout (checksummed zstd frames, project-dir encoding).

## Development

```sh
pnpm install          # devDependencies (esbuild)
pnpm run build        # rebuild lib/client.js (client bundle)
pnpm run import       # CLI entry
```

### Verification

- `verify.mts` — mounts the real dsh JSONL backend + skill provider on staged output (`node --import tsx/esm ../dsh-import-agents/verify.mts <sessions-root> <skills-root>` from the dsh checkout).
- `plugin/plugin-test.mts` — end-to-end: loads the plugin on a real cordis context, runs the commands and the session-start migration offer, asserts idempotency and state persistence.

## Known limitations

- Tool **results** are not imported (pi JSONL has none; opencode tool parts keep only the call input). Tool calls appear as text markers in assistant messages.
- Imported sessions live in the **ungrouped** bucket of the dsh sidebar (workspace membership requires an exact cwd match and is only recorded at session creation). Opening a session works fine from there.
- Imports are hot (Sync button, migration prompt), but a plugin code change requires a dsh restart. After any server restart, **refresh the page** — the old page's RPC connection is gone and the Sync button (or any command) will fail until then.

## License

MIT
