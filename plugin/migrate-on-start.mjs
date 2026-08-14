/**
 * 会话开始时主动询问是否迁移 pi/opencode 数据。
 *
 * 挂在 `agent/session-start`（source === 'startup'，非 subagent）上：
 * 1. 过滤：只有带 cwd 的顶层新会话才会触发；
 * 2. 扫描：该项目或全局是否存在未导入的 pi/opencode 会话（id 已稳定，
 *    persistence.list() 可判重）；
 * 3. 询问：经 ctx.userQuestions.ask() 弹 UI 问题（无 provider 时静默跳过）；
 * 4. 执行：按用户选择导入会话 / agents，并注入一条 notice 告知结果；
 * 5. 记忆：per-project 的「不导入」与全局 agents 决定写入
 *    $DSH_HOME/import-pi-opencode-state.json，避免每次新会话重复打扰。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { dshHome } from '../lib/util.mjs'
import { listPiSessions } from '../lib/pi-reader.mjs'
import { listOpencodeSessions } from '../lib/opencode-reader.mjs'
import { listCodexSessions, parseCodexSession } from '../lib/codex-reader.mjs'
import { listClaudeSessions, parseClaudeSession } from '../lib/claude-reader.mjs'
import { importAgents, importSessions } from './import-service.mjs'

const STATE_FILE = 'import-pi-opencode-state.json'

/** 两个 cwd 是否属于同一项目（相等，或一方在另一方目录内部且后者是真实项目而非全局根）。 */
export function sameProject(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) return false
  if (a === b) return true
  const depth = p => p.split('/').filter(Boolean).length
  if (a.startsWith(`${b}/`)) return depth(b) > 2
  if (b.startsWith(`${a}/`)) return depth(a) > 2
  return false
}

/** 读取 per-project 决定状态；缺失或损坏时回退为空状态。 */
export function loadState() {
  const path = join(dshHome(), STATE_FILE)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') {
      return {
        projects: parsed.projects ?? {},
        agents: parsed.agents,
      }
    }
  } catch {
    // 首次运行或文件损坏：从空状态开始。
  }
  return { projects: {}, agents: undefined }
}

/** 原子写状态文件。 */
export function saveState(state) {
  const path = join(dshHome(), STATE_FILE)
  const tmp = `${path}.tmp`
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, path)
}

/** 读取 pi 会话文件头（id/cwd），不解析整文件。 */
function piSessionHeader(file) {
  try {
    const event = JSON.parse(readFileSync(file, 'utf8').split('\n', 1)[0])
    const created = Date.parse(event.timestamp)
    return {
      id: event.id,
      cwd: event.cwd,
      createdAt: Number.isNaN(created) ? undefined : created,
    }
  } catch {
    return { id: undefined, cwd: undefined, createdAt: undefined }
  }
}

/**
 * 枚举未导入的 pi/opencode 会话（按稳定 id 与 persistence 判重）。
 * @returns { pi: [{id, cwd}], opencode: [{id, cwd}] }
 */
export async function findPending(persistence, config) {
  const ids = new Set((await persistence.list()).map(meta => meta.id))
  const pi = []
  for (const file of listPiSessions(config.piRoot)) {
    const header = piSessionHeader(file)
    if (header.id === undefined) continue
    const id = `pi-${header.id}`
    if (!ids.has(id)) pi.push({ id, cwd: header.cwd })
  }
  const opencode = []
  for (const row of listOpencodeSessions(config.opencodeDb)) {
    const id = `oc-${String(row.id).replace(/^ses_/, '')}`
    if (!ids.has(id)) opencode.push({ id, cwd: row.directory })
  }
  const codex = []
  for (const file of listCodexSessions(config.codexRoot)) {
    const parsed = parseCodexSession(file)
    if (parsed.header.id === undefined) continue
    const id = `codex-${parsed.header.id}`
    if (!ids.has(id)) codex.push({ id, cwd: parsed.header.cwd })
  }
  const claude = []
  for (const entry of listClaudeSessions(config.claudeRoot)) {
    const parsed = parseClaudeSession(entry.file, entry.cwd)
    if (parsed.header.id === undefined) continue
    const id = `claude-${parsed.header.id}`
    if (!ids.has(id)) claude.push({ id, cwd: entry.cwd })
  }
  return { pi, opencode, codex, claude }
}

/** 收集导入执行的结果摘要（供 notice 使用）。 */
function summarizeChoice(sessionsChoice, agentsChoice) {
  const parts = []
  if (sessionsChoice === 'Import all' || sessionsChoice === 'Import this project only') parts.push('sessions')
  if (agentsChoice === 'Import agents/skills') parts.push('agents/skills')
  return parts.length === 0 ? '' : `Imported from pi/opencode: ${parts.join(', ')}`
}

/**
 * 会话开始时的迁移询问入口。所有失败都静默降级（不打扰会话）。
 * @param ctx - 全局上下文（userQuestions / sessionPersistence / logger）。
 * @param agent - 刚启动的顶层 agent。
 * @param config - 源路径与导入默认配置。
 */
export async function maybeOfferMigration(ctx, agent, config) {
  const cwd = agent.session.header.cwd
  if (typeof cwd !== 'string' || cwd.length === 0) return
  if (agent.session.header.origin === 'subagent') return

  const state = loadState()
  const sessionsState = state.projects[cwd]?.sessions
  if (sessionsState === 'declined' || sessionsState === 'imported') return

  const pending = await findPending(ctx.sessionPersistence, config)
  const total = pending.pi.length + pending.opencode.length + pending.codex.length + pending.claude.length
  if (total === 0) return

  const here = source => pending[source].filter(item => sameProject(item.cwd, cwd)).length
  const counts = { pi: here('pi'), opencode: here('opencode'), codex: here('codex'), claude: here('claude') }

  const questions = [{
    id: 'migrate-sessions',
    header: 'Migrate history',
    question: `Found ${total} unimported pi/opencode/codex/claude-code sessions (this project: pi ${counts.pi}, opencode ${counts.opencode}, codex ${counts.codex}, claude-code ${counts.claude}). Import them into dsh?`,
    detail: 'Imported sessions appear in the session list and can be resumed; ids are stable and re-imports are skipped automatically.',
    options: [
      { label: 'Import all', description: 'Import every pi/opencode session (including other projects)' },
      { label: 'Import this project only', description: `Only import sessions related to ${cwd}` },
      { label: "Don't import", description: 'Skip migration; this project will not be asked again' },
    ],
  }]
  if (state.agents === undefined) {
    questions.push({
      id: 'migrate-agents',
      header: 'Migrate agents',
      question: 'Import pi/opencode agent & subagent definitions as dsh skills (e.g. k3-reviewer, kimi-vision, mode prompts)?',
      detail: 'Written to $DSH_AGENTS_HOME/skills (default ~/.agents/skills); dsh sessions can invoke them by name.',
      options: [
        { label: 'Import agents/skills', description: 'Convert them to dsh skills and mark as handled' },
        { label: 'Skip', description: 'Do not import agents; will not be asked again' },
      ],
    })
  }

  let answer
  try {
    // 不带 agent 调用：询问与具体会话解耦，不依赖 agents 服务的 live 校验。
    answer = await ctx.userQuestions.ask({ questions })
  } catch (error) {
    // 无 UI provider（如 headless）或询问被取消：静默跳过，不记状态。
    ctx.logger.info(`[import-pi-opencode] 迁移询问跳过: ${error.message}`)
    return
  }
  const pick = id => answer.answers.find(item => item.id === id)?.selected ?? []

  const sessionsChoice = pick('migrate-sessions')[0]
  if (sessionsChoice === 'Import all' || sessionsChoice === 'Import this project only') {
    const options = { ...config }
    if (sessionsChoice === 'Import this project only') {
      options.cwdFilter = candidate => sameProject(candidate, cwd)
    }
    const lines = []
    for (const source of ['pi', 'opencode', 'codex', 'claude-code']) {
      lines.push(...await importSessions(ctx.sessionPersistence, source, options))
    }
    for (const line of lines) ctx.logger.info(`[import-pi-opencode] ${line}`)
    state.projects[cwd] = { ...(state.projects[cwd] ?? {}), sessions: 'imported' }
  } else if (sessionsChoice === "Don't import") {
    state.projects[cwd] = { ...(state.projects[cwd] ?? {}), sessions: 'declined' }
  }

  const agentsChoice = pick('migrate-agents')[0]
  if (agentsChoice === 'Import agents/skills') {
    const lines = importAgents(config)
    for (const line of lines) ctx.logger.info(`[import-pi-opencode] ${line}`)
    state.agents = 'imported'
  } else if (agentsChoice === 'Skip') {
    state.agents = 'declined'
  }

  saveState(state)

  const summary = summarizeChoice(sessionsChoice, agentsChoice)
  if (summary.length > 0) {
    agent.inject({
      id: crypto.randomUUID(),
      role: 'user',
      content: [{ type: 'text', text: `${summary}. Find them in the session list to continue the conversations.` }],
      source: { kind: 'plugin', plugin: 'import-pi-opencode', form: 'notice', summary },
    })
  }
}
