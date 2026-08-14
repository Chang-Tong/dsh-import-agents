<div align="center">

# 🧬 dsh-import-agents

**Bring your pi / opencode / codex / claude-code sessions, agents, and prompts into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)**

Import chat history → real, resumable dsh sessions. Convert custom agents & mode prompts → discoverable dsh skills. One-click **Sync** button in the composer.

[中文文档](./README.zh.md) · MIT License · Node ≥ 22.19 · **zero runtime dependencies**

![dsh-import-agents in action](assets/screenshot-main.png)

</div>

---

## ✨ Features

| | |
| --- | --- |
| 🗂️ **4 sources, 1 command** | Import from **pi** (JSONL), **opencode** (SQLite), **codex** (JSONL), and **claude-code** (JSONL) — sessions, chat history, and subagents. |
| 🔁 **Truly resumable** | Imported sessions are real dsh sessions: browse the full history (text, reasoning, tool calls) and **continue the conversation** — the model gets the complete context. |
| 🧠 **Agents → skills** | pi agents / mode prompts and opencode agents become dsh skill bundles under `$DSH_AGENTS_HOME/skills`, with provenance recorded in frontmatter (`metadata.source` / `metadata.kind`). |
| ⚡ **One-click Sync button** | A small control in the composer tool row runs `/import-all` and shows the result inline. |
| 💬 **Migration prompt on session start** | When a new top-level session starts and unimported history exists, the plugin asks whether to migrate — per-project decisions are remembered, so it never nags twice. |
| 🧱 **Workspace placement** | Imported sessions attach to a workspace matching their original `cwd` (created on demand), not the ungrouped bucket; `/attach-workspaces` retro-fits existing imports. |
| 🧾 **Idempotent** | Stable ids (`pi-<uuid>` / `oc-<id>` / `codex-<id>` / `claude-<id>`); re-imports skip what already exists. |
| 🪶 **Zero runtime dependencies** | Node built-ins (`node:zlib` zstd, `node:sqlite`) plus dsh platform modules. |

---

## 🖼️ Screenshots

> ℹ️ Personal paths and usernames are redacted (▮▮) in the screenshots below.

### The Sync button

Refresh the page and the composer tool row (left of the input) shows a **同步 (Sync)** button. Click it to run the full import — sessions *and* agents — and read the result inline:

![Sync button and inline import result](assets/screenshot-sync.png)

### Imported sessions in the session list

Sessions land in a workspace matching their original project folder, with source-tagged titles (`[pi]`, `[opencode]`, …). In this demo all 36 pi + 167 opencode + 151 codex + 68 claude-code sessions were already imported, so a re-run skips them all:

![Workspace with imported sessions](assets/screenshot-sessions.png)

### A fully resumable imported session

Open any imported session to browse the original conversation — text, reasoning, and tool calls — and keep talking from where you left off:

![Imported session with conversation history](assets/screenshot-session.png)

---

## 🧭 How it works

```mermaid
flowchart LR
    subgraph sources["Your local data"]
        PI["pi sessions<br/>~/.pi/agent/sessions/*.jsonl"]
        OC["opencode sessions<br/>~/.local/share/opencode/opencode.db"]
        CX["codex sessions<br/>~/.codex/sessions/**/*.jsonl"]
        CC["claude-code sessions<br/>~/.claude/projects/**/*.jsonl"]
        AG["pi agents & prompts<br/>opencode agents"]
    end
    subgraph plugin["dsh-import-agents"]
        R["readers<br/>pi / opencode / codex / claude-reader"]
        C["convert<br/>turn structure + tool events"]
        W["write<br/>dsh JSONL persistence<br/>or ctx.sessionPersistence"]
        S["skills<br/>SKILL.md bundles"]
    end
    subgraph dsh["DeepSeek Harness"]
        SL["session list & resume"]
        TR["trajectory & tool cards"]
        SK["ctx.skills.list()"]
    end
    PI --> R
    OC --> R
    CX --> R
    CC --> R
    AG --> S
    R --> C --> W --> SL
    W --> TR
    S --> SK
```

The importer is a **pure converter**: `lib/` parses each source format into a normalized message stream, then emits the exact dsh JSONL event layout (checksummed zstd frames, project-dir encoding) — byte-for-byte the format the dsh persistence backend reads back with its own `list` / `load` / `prepare`.

---

## 📦 Install

The plugin is published on **npm** as [`dsh-import-agents`](https://www.npmjs.com/package/dsh-import-agents) (latest `0.2.2`). Add it to your dsh profile — shown here for the `web` profile — in three steps: install → configure → restart.

### 1 · Install the package

```sh
cd ~/.dsh/profiles/web

# from npm (recommended)
pnpm add dsh-import-agents
# ...or with npm
# npm install dsh-import-agents
```

Other sources:

```sh
# from git
pnpm add git+https://github.com/Chang-Tong/dsh-import-agents.git
# from a local checkout (development)
pnpm add file:/path/to/dsh-import-agents
```

### 2 · Enable it in the profile config

Append an entry to `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: import-pi-opencode
      name: dsh-import-agents
```

- `name` — the npm package name you just installed
- `id` — the plugin's registered id (keep it as `import-pi-opencode`; this is what the slash commands and the Sync button bind to)

### 3 · Restart & verify

1. Restart `dsh web` — the host plugin registers its slash commands at startup, and the client bundle (the Sync button) is served automatically, no extra config.
2. **Refresh the page** — the old page's RPC connection is gone after a restart.
3. Verify it's live: the composer tool row shows the **同步 (Sync)** button, and `/import-all` answers in the input.

```sh
# optional sanity checks
npm view dsh-import-agents version     # latest published version
pnpm list dsh-import-agents            # installed in the profile
```

> 💡 Disable the session-start migration prompt with `config: { offerOnStart: false }` on the inserted row. Source paths and defaults are overridable the same way — see [Configuration](#configuration).

---

## 🚀 Quick start

1. **Refresh the page** after a restart (the old page's RPC connection is gone).
2. Click **同步 (Sync)** in the composer tool row — or type `/import-all` in the input.
3. Imported sessions appear in the session list (grouped by workspace); imported agents appear as skills.

Everything is **idempotent** — run it as often as you like; already-imported sessions are skipped.

### Slash commands

| Command | What it does |
| --- | --- |
| `/import-pi [options]` | Import pi sessions |
| `/import-opencode [options]` | Import opencode sessions |
| `/import-codex [options]` | Import codex sessions |
| `/import-claude-code [options]` | Import claude-code sessions |
| `/import-agents` | Convert pi/opencode agents & prompts into dsh skills |
| `/import-all [options]` | All of the above (4 sources + agents) |
| `/attach-workspaces` | Attach imported sessions to cwd-matched workspaces (retro-fit) |

Options: `--limit N` · `--project <substr>` · `--since <iso|ms>` · `--no-tools` · `--tools-as-text` · `--tool-truncate N`

---

## 💻 CLI (no dsh needed)

```sh
node import.mjs all                # dry-run preview (writes nothing)
node import.mjs all --apply        # write sessions + skills
node import.mjs sessions codex --apply --limit 20   # one source at a time
node import.mjs agents --apply     # agents/prompts → skills only
node export.mjs                    # export sessions as Markdown for any agent to read
```

- `import.mjs` defaults to **dry-run**; pass `--apply` to write.
- `all` = pi + opencode + agents; add codex/claude-code explicitly (e.g. `sessions codex`, `sessions claude-code`).
- `export.mjs` writes `$DSH_HOME/exports/<source>/<session-id>.md` (`--source`, `--project`, `--limit`, `--since`, `--out`, `--no-reasoning`, `--no-tools`).

---

## 🔄 Import rules

**Sessions**

- Each user message opens a turn (`turn/start` + `user/message`); following assistant messages join it with increasing step numbers; every turn closes with `turn/end` — the event log is balanced and matches the dsh persistence contract.
- pi `thinking` → dsh `reasoning` blocks. pi `toolCall`, opencode `tool`, claude `tool_use`, codex `tool_use` → `tool-call` content blocks **plus paired `tool/call` + `tool/result` events**: the trajectory UI renders the call cards, and the placeholder `tool/result` answers every `tool_calls` so OpenAI-compatible APIs accept resumed requests (orphaned `tool_calls` are rejected with `insufficient tool messages following tool_calls message`).
  - `--tools-as-text` → tool calls as plain text (no trajectory cards)
  - `--no-tools` → tool calls dropped entirely
- `step-start` / `step-finish` / `patch` / `file` / `compaction` opencode parts are skipped as mechanical records.
- Assistant messages keep the source provider/model when available (pi: last `model_change`; opencode: message's own `model` field), falling back to `imported` / `unknown`.
- Sessions are written under `$DSH_HOME/sessions/<project-dir>/<id>/session.jsonl.zstd` in the exact dsh layout; the plugin path writes through `ctx.sessionPersistence` so sessions appear **immediately** in the GUI — no restart needed.

**Agents & prompts → skills**

- Written to `$DSH_AGENTS_HOME/skills/<name>/SKILL.md` (default `~/.agents/skills/`) — the dsh skill-filesystem user root; discoverable via `ctx.skills.list()` after restart.
- Name conflicts (e.g. `k3-reviewer` exists in both pi and opencode): the later import is renamed `<name>-<source>` (`k3-reviewer-opencode`).
- Existing bundles are only completed (missing `SKILL.md` filled in), never clobbered — e.g. `kimi-vision` keeps its `scripts/` directory.
- Identical content is skipped; frontmatter records `metadata.source` / `metadata.kind` for provenance.

---

## ⚙️ Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `offerOnStart` | `true` | Ask about migration when a new top-level session starts |
| `piRoot` | `~/.pi/agent/sessions` | pi session root |
| `piAgentRoot` | `~/.pi/agent` | pi agents & prompts root |
| `opencodeDb` | `~/.local/share/opencode/opencode.db` | opencode SQLite path |
| `opencodeConfig` | `~/.config/opencode` | opencode agents root |
| `codexRoot` | `~/.codex/sessions` | codex session root |
| `claudeRoot` | `~/.claude/projects` | claude-code projects root |
| `skillsRoot` | `$DSH_AGENTS_HOME/skills` | skills output root |
| `toolTruncate` | `1000` | tool-call arguments truncation (chars) |

The migration prompt only fires for brand-new **top-level** sessions (startup, not subagents) that have a `cwd` and unimported history. Per-project decisions and the global agents decision are stored in `$DSH_HOME/import-pi-opencode-state.json`; headless environments without a UI provider silently skip the prompt.

---

## 🧪 Verification & testing

- `verify.mts` — mounts the **real** dsh JSONL backend + skill provider on staged output (`node --import tsx/esm ../dsh-import-agents/verify.mts <sessions-root> <skills-root>` from the dsh checkout) → expects `SESSIONS ALL PASS / SKILLS ALL PASS`.
- `plugin/plugin-test.mts` — end-to-end: loads the plugin on a real cordis context, runs the commands and the session-start migration offer, asserts idempotency and state persistence.
- `tests/` — Vitest component tests for the Sync button (`sync-button.spec.tsx`, `sync-button-hide.spec.tsx`), plus `opencode-reader.spec.ts` and `attach-workspaces.spec.ts`.
- CI (GitHub Actions, `macos-latest`, Node 22): `pnpm install` → `pnpm run build` → `npx vitest run`.

```sh
pnpm install          # devDependencies (esbuild, vitest)
pnpm run build        # rebuild lib/client.js (Sync button bundle)
npx vitest run        # component tests
```

---

## ❓ FAQ

**Why does Sync say “新导入 0，已存在跳过 N”?**
That's idempotency working: those sessions were imported before, so they're skipped. Nothing is duplicated.

**Tool call *results* are missing — why?**
The source formats don't store tool results, only the calls. Imports keep the calls as `tool-call` blocks with placeholder `tool/result` events, so the trajectory renders cards and resumed requests stay API-legal.

**Will it keep asking me to migrate?**
Only while unimported sessions exist and only per project. Once you pick “不导入” or an import completes, that decision is remembered in `$DSH_HOME/import-pi-opencode-state.json`.

**Why do I need to refresh after a dsh restart?**
The old page's RPC connection is gone after a restart; commands (and the Sync button) fail until you refresh.

**Node version requirement?**
Node ≥ 22.19 — same baseline as dsh (`node:sqlite`, zstd via `node:zlib`).

---

## ⚠️ Known limitations

- Tool **results** are not imported (the source data doesn't contain them); calls appear as text/tool-call blocks with placeholder results.
- Sessions land in the **ungrouped** bucket unless a workspace matches their exact `cwd` at creation; `/attach-workspaces` retro-fits them.
- The CLI writes files directly — a **running** dsh won't notice until restart. The plugin commands (Sync button, slash commands) write live through `ctx.sessionPersistence`, no restart needed.
- Local, single-machine sources only (paths are overridable via config/CLI flags).

---

## 📄 License

MIT
