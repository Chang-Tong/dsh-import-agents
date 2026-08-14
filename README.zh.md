# pi / opencode → DSH 导入工具

把你在 **pi**（pi-coding-agent）和 **opencode** 里的会话（聊天记录）与 agent / 模式提示词，快速导入到 DeepSeek Harness（dsh），让历史对话出现在 dsh 的会话列表里、可以直接继续对话，让自定义 agent 变成 dsh 可发现的 skills。

零依赖：只用到 Node 内置模块（`node:zlib` 的 zstd、`node:sqlite`），需要 Node ≥ 22.19（与 dsh 一致）。

## 数据来源

| 来源 | 位置 | 内容 |
| --- | --- | --- |
| pi 会话 | `~/.pi/agent/sessions/<项目>/<时间>_<uuid>.jsonl` | 36 个会话（文本 + 推理 + 工具调用 + 图片） |
| opencode 会话 | `~/.local/share/opencode/opencode.db`（SQLite） | 167 个会话（text / reasoning / tool 等 part） |
| pi agents | `~/.pi/agent/agents/*.md` | k3-reviewer、k3-visual 等自定义 agent |
| pi 模式提示词 | `~/.pi/agent/prompts/*.md` | implement、scout-and-plan 等模式模板 |
| opencode agents | `~/.config/opencode/agents/*.md` | k3-reviewer、kimi-vision 等 agent |

## 快速开始

```sh
# 1. 预览（不写任何东西）
node import.mjs all

# 2. 确认无误后写入
node import.mjs all --apply

# 3. 重启 dsh web，会话列表里就会出现导入的会话
```

导入的会话 id 是**稳定**的（`pi-<uuid>` / `oc-<opencode-id>`），重复运行自动跳过已导入的，可以放心反复执行。

## 命令

```
node import.mjs <command> [options]

commands:
  sessions pi|opencode   导入会话历史（聊天记录）
  agents                 把 pi / opencode 的 agent 与模式提示词导入为 DSH skills
  projects               扫描项目级 agent / skill / 指令文件（只报告，不写入）
  all                    上面全部
```

常用选项：

| 选项 | 说明 |
| --- | --- |
| `--apply` | 真正写入（默认 dry-run 只预览） |
| `--project <substr>` | 只导入 cwd 包含该子串的会话 |
| `--since <iso\|ms>` | 只导入创建时间不早于该值的会话 |
| `--limit <n>` | 最多导入 n 个会话（按创建时间从新到旧） |
| `--no-tools` | 丢弃工具调用块，只保留对话文本 |
| `--tools` | 保留 `tool-call` 块（默认转成文本，避免恢复会话时孤立 tool_calls 被 API 拒绝） |
| `--truncate <n>` | 文本/推理块截断到 n 字符（默认不截断） |
| `--tool-truncate <n>` | 工具调用参数截断到 n 字符（默认 1000） |
| `--preview <n>` | 每个来源预览前 n 个事件（默认 1） |

示例：

```sh
# 只导入 pi 的会话，预览
node import.mjs sessions pi

# 只导入 opencode 最近 20 个会话并写入
node import.mjs sessions opencode --apply --limit 20

# 只导入某项目的会话
node import.mjs sessions opencode --apply --project RealEstateIntelligent

# 只写 skills，不写会话
node import.mjs agents --apply
```

## 导入规则

### 会话（聊天记录）

- 每条 user 消息开启一个 turn（`turn/start` + `user/message`），随后的 assistant 消息以递增 step 加入同一 turn（`assistant/message`），turn 以 `turn/end {kind:'completed'}` 收尾——事件日志是平衡的，符合 dsh 持久化契约。
- pi 的 `thinking` → dsh 的 `reasoning` 块；`toolCall` → **文本形式**（`[工具调用: name]` + 参数）；图片（pi 里极少）→ 占位文本。
- **工具调用默认转成文本**：恢复导入的会话时历史里没有对应的 tool/result 事件，OpenAI 兼容 API 会拒绝孤立的 `tool_calls`（`insufficient tool messages following tool_calls message`）。文本形式保留工具名与参数且模型请求合法；需要保留 `tool-call` 块时用 `--tools`，丢弃时用 `--no-tools`。
- opencode 的 text / reasoning / tool part 对应映射；`step-start` / `step-finish` / `patch` / `file` / `compaction` 这类机械记录跳过。
- assistant 消息带上来源 provider / model（pi 取最近一次 `model_change`，opencode 取消息自身的 model 字段），缺失时回落为 `imported` / `unknown`。
- 会话文件写入 `$DSH_HOME/sessions/<项目目录>/<id>/session.jsonl.zstd`，与 dsh 的 JSONL 后端（zstd 帧 + 校验和、目录名编码）逐字节同构，已验证可用 dsh 自己的 backend `list` / `load` / `prepare` 完整读回。

### agents / 模式提示词 → skills

- 写入 `$DSH_AGENTS_HOME/skills/<name>/SKILL.md`（默认 `~/.agents/skills/`），这是 dsh skill-filesystem 的用户级技能根，重启后 `ctx.skills.list()` 即可发现。
- 名称冲突（pi 和 opencode 都有 `k3-reviewer`）：后导入的自动改名 `<name>-<source>`（如 `k3-reviewer-opencode`）。
- 已存在的 bundle 只补 `SKILL.md` 不动其他文件（如 `kimi-vision` 会保留它的 `scripts/` 目录）。
- 同名同内容自动跳过；frontmatter 里记录 `metadata.source` / `metadata.kind` 溯源。

### projects（只读报告）

扫描 pi / opencode 涉及的项目目录，报告项目级的 `.opencode/`、`.pi/`、`.agents/skills`、`.dsh/skills`、`AGENTS.md`、`CLAUDE.md`。说明：`AGENTS.md` / `CLAUDE.md` dsh 会话会自动读取，`.agents/skills` 与 `.dsh/skills` 本身就是 dsh 技能根，无需导入。

## 验证

`lib/` 下的解析与写入逻辑已用真实数据验证：`verify.mts` 用 dsh 自己的 JSONL 后端（list / load / prepare）和 skill-filesystem provider 读回导入产物。改动代码后可回归：

```sh
# 1. 写入 staging 目录（不碰真实 ~/.dsh）
node import.mjs sessions pi --apply --sessions-root /tmp/check/sessions --limit 2
node import.mjs sessions opencode --apply --sessions-root /tmp/check/sessions --limit 3
node import.mjs agents --apply --skills-root /tmp/check/skills

# 2. 在 deepseek-harness 仓库根挂载真实后端读回（tsx 需要仓库 tsconfig paths）
cd /Users/dongair/project/05-pr/dsh/deepseek-harness
node --import tsx/esm ../import-agents/verify.mts /tmp/check/sessions /tmp/check/skills
# 期望输出: SESSIONS ALL PASS / SKILLS ALL PASS
```

导入的会话在 dsh GUI 中可浏览、可恢复继续对话；因为历史里含工具调用与推理块，继续对话时模型能看到完整的上下文。

## 一键同步按钮（composer 工具行）

插件自带一个轻量 client 插件：刷新页面后，**输入框工具行左侧**会出现一个 **「同步」** 按钮，点击即执行 `/import-all`（导入 pi/opencode 会话 + agents/skills），结果内联显示。构建产物 `lib/client.js` 遵循 dsh 的 client bundle 协议（`__ModuleLoader__.load`），随插件包自动被 dsh web 发现并加载，无需额外配置。

重新构建前端产物：`pnpm install && pnpm run build`。

## 插件形态（dsh 内斜杠命令）

验证通过后，可以把同一套逻辑封装成 dsh 插件，在 GUI 会话里直接敲命令导入，**无需写文件、无需重启**（走 `ctx.sessionPersistence`，导入的会话立即出现在会话列表）。

插件源码在 `plugin/`（`dsh-plugin-import-agents`，无依赖，只复用 `lib/` 的解析逻辑）。

### 安装（启用后需要重启一次 dsh web 加载插件）

```sh
# 1. 装进 web profile
cd ~/.dsh/profiles/web
# 开源仓库安装（推荐）
pnpm add git+https://github.com/Chang-Tong/dsh-import-agents.git
# 或本地目录: pnpm add file:/Users/dongair/project/05-pr/dsh/import-agents

# 2. 在 ~/.dsh/profiles/web/cordis.patch.yml 里追加：
#    - insert:
#        - id: import-agents
#          name: dsh-plugin-import-agents

# 3. 重启 dsh web
```

### 命令

| 命令 | 作用 |
| --- | --- |
| `/import-pi [选项]` | 导入 pi 会话 |
| `/import-opencode [选项]` | 导入 opencode 会话 |
| `/import-agents` | 导入 agents / 模式提示词为 skills |
| `/import-all [选项]` | 以上全部 |

选项：`--limit N`、`--project 子串`、`--since ISO|ms`、`--no-tools`、`--tool-truncate N`。会话 id 与 CLI 脚本一致（`pi-<uuid>` / `oc-<id>`），两套方式混用会自动去重。

### 会话开始时的主动迁移询问

插件还会**在每个新会话（startup）开始时主动询问**是否迁移历史数据：

- 触发条件：全新顶层会话（`agent/session-start` + `source: startup`，非 subagent）、会话有 cwd、且该状态下存在**未导入**的 pi/opencode 会话；
- 询问内容（经 `ctx.userQuestions`，GUI 弹窗）：
  1. 是否迁移会话 —— **全部导入 / 只导入本项目 / 不导入**（"本项目"= cwd 相等或在其目录内部，排除 `/Users/dongair` 这类全局根）；
  2. 是否迁移 pi/opencode 的 agent / subagent 定义为 dsh skills（只在首次询问，之后不再重复问）；
- 结果反馈：导入完成后向会话注入一条 notice（"已从 pi/opencode 导入 会话、agents/skills…"）；
- 去打扰：每个项目的决定（`imported` / `declined`）与全局 agents 决定记录在 `$DSH_HOME/import-agents-state.json`，拒绝或导入完成的项目不再询问；headless 等无 UI provider 环境自动静默跳过。

配置：插件 config 传 `offerOnStart: false` 可关闭主动询问（命令仍可用）；源路径与导入默认值均可覆盖（`piRoot`、`opencodeDb`、`piAgentRoot`、`opencodeConfig`、`skillsRoot`、`toolTruncate`）。

回归测试（在 deepseek-harness 仓库根）：

```sh
node --import tsx/esm ../import-agents/plugin/plugin-test.mts
# 期望输出: PLUGIN TEST PASS（会话写入 /tmp/dsh-plugin-test/sessions staging）
```

## 已知限制

- 导入发生在 dsh 未运行或写入后**重启 dsh** 才生效（`--apply` 直接写文件，不经过运行中的进程；正在运行的 dsh 不会感知）。
- pi / opencode 的工具**结果**未导入（pi 的 JSONL 不含结果；opencode 的 tool part 只保留调用输入摘要），工具调用默认以文本形式保留在 assistant 消息里（`--tools` 可保留 `tool-call` 块，但恢复会话时可能被模型 API 拒绝）。
- 只支持单机本地的 pi / opencode 数据，路径可通过 `--pi-root` / `--opencode-db` / `--opencode-config` 覆盖。
