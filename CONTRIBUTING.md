# Contributing

[中文版](CONTRIBUTING.zh.md) | English

Thanks for your interest in contributing to **dsh-import-agents**!

The project is small and maintained by one person, but every form of help matters. Here is how you can contribute:

## Ways to contribute

- **Report bugs** — open an [issue](https://github.com/Chang-Tong/dsh-import-agents/issues/new) with the source tool, the import command you ran, and the error output. Minimal reproduction steps help a lot.
- **Request features** — open an issue or start a [discussion](https://github.com/Chang-Tong/dsh-import-agents/discussions). Tell us which tool's format you want imported next.
- **Spread the word** — star the repo, write a blog post, share the project in your team. The plugin lives or dies by discoverability.
- **Help others** — answer questions in Discussions and Issues.
- **Add the topic** — if you build your own dsh plugin, add the `dsh-plugin` topic to your repo so the ecosystem is easier to find (per [deepseek-harness CONTRIBUTING](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md)).

## Development

Requirements: Node >= 22.19, pnpm.

```sh
pnpm install          # devDependencies (esbuild, vitest)
pnpm run build        # rebuild lib/client.js (the Sync button bundle)
npx vitest run        # component tests
```

### Verifying against the real dsh backend

```sh
# from a deepseek-harness checkout
node --import tsx/esm ../dsh-import-agents/verify.mts <sessions-root> <skills-root>
# expects: SESSIONS ALL PASS / SKILLS ALL PASS

# plugin end-to-end (loads the plugin on a real cordis context)
node --import tsx/esm ../dsh-import-agents/plugin/plugin-test.mts
# expects: PLUGIN TEST PASS
```

### Import rules to keep in mind

- Session ids are stable (`pi-<uuid>` / `oc-<id>` / `codex-<id>` / `claude-<id>`) — imports must stay idempotent.
- Tool calls are written as `tool-call` blocks **plus** paired `tool/call` + `tool/result` events so resumed sessions stay API-legal.
- Every user message opens a turn and every turn closes with `turn/end` — the event log must stay balanced.

## Pull requests

PRs are welcome. Please keep them focused, run the tests, and update the CHANGELOG under `Unreleased` (or the next version) if the change is user-visible.

## Code of conduct

Please note that this project adheres to the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.
