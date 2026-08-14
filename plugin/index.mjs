/**
 * dsh-import-agents
 *
 * 把 pi / opencode 的会话、聊天记录、agent 导入 dsh。
 *
 * 在会话里输入（无前导斜杠，dsh 命令系统自动处理）：
 *   /import-pi [--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]
 *   /import-opencode [同上]
 *   /import-codex [同上]
 *   /import-claude-code [同上]
 *   /import-agents
 *   /import-all [同上]
 *
 * 导入经 ctx.sessionPersistence.create + append 写入，导入的会话立即出现在
 * GUI 会话列表并可继续对话；agent 以 skill 包形式写入 $DSH_AGENTS_HOME/skills。
 * 会话 id 稳定（pi-<uuid> / oc-<opencode-id>），重复导入自动跳过。
 *
 * 无 default export（namespace 插件），避免 Loader 丢弃 inject。
 */

import { importSessions, importAgents } from './import-service.mjs'
import { maybeOfferMigration } from './migrate-on-start.mjs'
import { attachSessionsToWorkspaces, listImportedSessions } from './attach-workspaces.mjs'

export const name = 'import-pi-opencode'

/** 需要 commands（注册命令）、sessionPersistence（写入会话）与 userQuestions（迁移询问）。 */
export const inject = ['commands', 'sessionPersistence', 'userQuestions']

/** 解析 `--key value` / `key=value` 形式的命令输入。 */
function parseInput(rawInput) {
  const options = {}
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    const eq = token.indexOf('=')
    if (token.startsWith('--') && eq >= 0) {
      options[token.slice(2, eq)] = token.slice(eq + 1)
    } else if (token.startsWith('--') && i + 1 < tokens.length) {
      options[token.slice(2)] = tokens[++i]
    } else if (eq >= 0) {
      options[token.slice(0, eq)] = token.slice(eq + 1)
    }
  }
  return options
}

/** 把命令输入归一成导入选项。 */
function resolveOptions(input, defaults) {
  const options = { ...defaults }
  if (input['limit'] !== undefined) {
    const limit = Number(input['limit'])
    if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit 必须是正整数')
    options.limit = limit
  }
  if (input['project'] !== undefined) options.project = input['project']
  if (input['since'] !== undefined) {
    const ms = Number(input['since'])
    options.since = Number.isFinite(ms) && ms > 1e11 ? ms : Date.parse(input['since'])
    if (Number.isNaN(options.since)) throw new Error('--since 无法解析（用 ISO 日期或毫秒时间戳）')
  }
  if (input['no-tools'] !== undefined) options.noTools = true
  if (input['tools-as-text'] !== undefined) options.toolsAsText = true
  if (input['tool-truncate'] !== undefined) {
    const value = Number(input['tool-truncate'])
    if (!Number.isInteger(value) || value < 0) throw new Error('--tool-truncate 必须是非负整数')
    options.toolTruncate = value
  }
  return options
}

/** 默认源路径（与 CLI 脚本一致）。 */
function defaultOptions() {
  const home = process.env.HOME ?? ''
  return {
    piRoot: `${home}/.pi/agent/sessions`,
    piAgentRoot: `${home}/.pi/agent`,
    opencodeDb: `${home}/.local/share/opencode/opencode.db`,
    opencodeConfig: `${home}/.config/opencode`,
    codexRoot: `${home}/.codex/sessions`,
    claudeRoot: `${home}/.claude/projects`,
    skillsRoot: joinAgentsSkills(),
    toolTruncate: 1000,
  }
}

function joinAgentsSkills() {
  const home = process.env.HOME ?? ''
  return `${process.env.DSH_AGENTS_HOME ?? `${home}/.agents`}/skills`
}

/** 注册四个导入命令，并在每个新会话开始时主动询问是否迁移历史数据。 */
export function apply(ctx, config = {}) {
  const defaults = { ...defaultOptions(), ...(config ?? {}) }

  // 会话开始时主动询问：仅全新顶层会话（startup）、带 cwd、有未导入数据时才问；
  // 用户拒绝或导入完成后该项目不再询问（状态记录在 $DSH_HOME 状态文件）。
  if (defaults.offerOnStart !== false) {
    ctx.effect(function* () {
      ctx.on('agent/session-start', ({ agent, source }) => {
        if (source !== 'startup') return
        void maybeOfferMigration(ctx, agent, defaults)
      })
    }, 'import-pi-opencode session-start migration offer')
  }

  const run = async (source, input) => {
    const options = resolveOptions(input, defaults)
    const lines = await importSessions(ctx.sessionPersistence, source, options)
    return { kind: 'success', text: lines.join('\n') }
  }

  ctx.commands.register({
    name: 'import-pi',
    description: 'Import pi sessions (chat history) into dsh (re-runs skip existing)',
    input: { hint: '[--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]' },
    handler: invocation => run('pi', parseInput(invocation.rawInput)),
  })

  ctx.commands.register({
    name: 'import-opencode',
    description: 'Import opencode sessions (chat history) into dsh (re-runs skip existing)',
    input: { hint: '[--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]' },
    handler: invocation => run('opencode', parseInput(invocation.rawInput)),
  })

  ctx.commands.register({
    name: 'import-codex',
    description: 'Import codex sessions (chat history) into dsh (re-runs skip existing)',
    input: { hint: '[--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]' },
    handler: invocation => run('codex', parseInput(invocation.rawInput)),
  })

  ctx.commands.register({
    name: 'import-claude-code',
    description: 'Import claude-code sessions (chat history) into dsh (re-runs skip existing)',
    input: { hint: '[--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]' },
    handler: invocation => run('claude-code', parseInput(invocation.rawInput)),
  })

  ctx.commands.register({
    name: 'attach-workspaces',
    description: 'Attach imported sessions to their cwd-matched workspace (absolute path disambiguates same-name projects)',
    handler: async () => {
      const sessions = await listImportedSessions(ctx)
      const lines = await attachSessionsToWorkspaces(ctx, sessions)
      return { kind: 'success', text: lines.length === 0 ? '没有可归位的会话（或 workspace 服务未加载）' : lines.join('\n') }
    },
  })

  ctx.commands.register({
    name: 'import-agents',
    description: 'Convert pi/opencode agents & mode prompts into dsh skills (~/.agents/skills)',
    handler: () => {
      const lines = importAgents(defaults)
      return { kind: 'success', text: lines.join('\n') }
    },
  })

  ctx.commands.register({
    name: 'import-all',
    description: 'Import pi/opencode sessions, chat history and agents (= import-pi + import-opencode + import-agents)',
    input: { hint: '[--limit N] [--project 子串] [--since ISO|ms] [--no-tools] [--tool-truncate N]' },
    handler: async (invocation) => {
      const input = parseInput(invocation.rawInput)
      const options = resolveOptions(input, defaults)
      const lines = []
      for (const source of ['pi', 'opencode', 'codex', 'claude-code']) {
        lines.push(...await importSessions(ctx.sessionPersistence, source, options))
      }
      lines.push(...importAgents(defaults))
      return { kind: 'success', text: lines.join('\n') }
    },
  })
}
