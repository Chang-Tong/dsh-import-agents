#!/usr/bin/env node
/**
 * 把 pi / opencode 的 session、聊天记录、agent 快速导入 DSH。
 *
 * 用法:
 *   node import.mjs sessions pi|opencode [options]
 *   node import.mjs agents [options]
 *   node import.mjs projects
 *   node import.mjs all [options]
 *
 * 默认 --dry-run 只打印将要导入的内容；--apply 才真正写入
 * (~/.dsh/sessions 的会话文件和 ~/.agents/skills 的 skill 包)。
 * 导入的会话 id 是稳定的（pi-<uuid> / oc-<opencode-id>），重复导入自动跳过。
 *
 * 导入完成后需要重启 `dsh web`，GUI 会话列表才会刷新。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { agentsHome, dshHome, log, parseArgs, parseSince, truncate } from './lib/util.mjs'
import { findExistingSession, writeSession } from './lib/dsh-writer.mjs'
import { buildDshEvents, deriveImportTitle } from './lib/convert.mjs'
import { defaultPiRoot, listPiSessions, parsePiSession } from './lib/pi-reader.mjs'
import { defaultOpencodeDb, listOpencodeSessions, readOpencodeSession } from './lib/opencode-reader.mjs'
import { defaultCodexRoot, listCodexSessions, parseCodexSession } from './lib/codex-reader.mjs'
import { defaultClaudeRoot, listClaudeSessions, parseClaudeSession } from './lib/claude-reader.mjs'
import { applySkillPlan, collectAgents, fileSize, planSkillWrites } from './lib/agents.mjs'

const USAGE = `用法:
  node import.mjs <command> [options]

commands:
  sessions pi|opencode|codex|claude-code   导入会话历史（聊天记录）
  agents                 把 pi / opencode 的 agent 与模式提示词导入为 DSH skills
  projects               扫描项目级 agent / skill / 指令文件（只报告，不写入）
  all                    上面全部

options:
  --apply                真正写入（默认 --dry-run 只预览）
  --project <substr>     只导入 cwd 包含该子串的会话
  --since <iso|ms>       只导入创建时间不早于该值的会话
  --limit <n>            最多导入 n 个会话（按创建时间从新到旧）
  --no-tools             丢弃工具调用块（只留对话文本）
  --tools-as-text        工具调用转成纯文本（默认保留 tool-call 块并为每个
                         调用写入配对的 tool/call + tool/result 事件：
                         轨迹可见、恢复会话时模型请求合法）
  --truncate <n>         文本/推理块截断到 n 字符（默认不截断）
  --tool-truncate <n>    工具调用参数截断到 n 字符（默认 1000）
  --preview <n>          预览前 n 个事件（默认 1）
  --sessions-root <dir>  会话存储根目录（默认 $DSH_HOME/sessions）
  --skills-root <dir>    技能存储根目录（默认 $DSH_AGENTS_HOME/skills）
  --pi-root <dir>        pi 会话根目录（默认 ~/.pi/agent/sessions）
  --opencode-db <file>   opencode 数据库路径（默认 ~/.local/share/opencode/opencode.db）
`

/** Compact one-line rendering of an event for dry-run previews. */
function renderEvent(event) {
  if (event.type === 'turn/start') return `turn/start turn=${event.data.turn}`
  if (event.type === 'turn/end') return `turn/end turn=${event.data.turn}`
  if (event.type === 'user/message') {
    return `user: ${event.data.content.map(block => block.type === 'text' ? truncate(block.text, 80) : `[${block.type}]`).join(' ')}`
  }
  if (event.type === 'assistant/message') {
    const parts = event.data.message.content.map((block) => {
      if (block.type === 'text') return truncate(block.text, 80)
      return `[${block.type}]`
    })
    return `assistant: ${parts.join(' ')}`
  }
  return event.type
}

/** Read only the session header line of a pi file. */
function piSessionHeader(file) {
  const first = readFileSync(file, 'utf8').split('\n', 1)[0]
  try {
    const event = JSON.parse(first)
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

/** Build the event list for one normalized message stream + block options. */
function toEvents(messages, options) {
  const filtered = []
  for (const message of messages) {
    let blocks = message.blocks
    if (options.noTools) {
      blocks = blocks.filter(block => block.type !== 'tool-call')
    } else if (options.toolsAsText === true) {
      // 纯文本模式：不生成 tool/call + tool/result 事件（轨迹无工具卡片）。
      blocks = blocks.map((block) => {
        if (block.type === 'tool-call') {
          return { type: 'text', text: `[工具调用: ${block.name}]\n${block.arguments}` }
        }
        return block
      })
    }
    if (options.truncate !== undefined) {
      blocks = blocks.map((block) => {
        if (block.type === 'text' || block.type === 'reasoning') {
          return { ...block, text: truncate(block.text, options.truncate) }
        }
        return block
      })
    }
    if (options.toolTruncate !== undefined) {
      blocks = blocks.map((block) => {
        if (block.type === 'tool-call') return { ...block, arguments: truncate(block.arguments, options.toolTruncate) }
        return block
      })
    }
    filtered.push({ ...message, blocks })
  }
  return buildDshEvents(filtered, {
    toolEvents: options.noTools !== true && options.toolsAsText !== true,
    title: options.title,
  })
}

/** Import one source's sessions; returns per-session outcome lists. */
function importSessions(source, options) {
  const candidates = []
  if (source === 'pi') {
    for (const file of listPiSessions(options.piRoot)) {
      const header = piSessionHeader(file)
      if (header.id === undefined) {
        log(`  [skip] ${file}: 无有效 session 头`)
        continue
      }
      candidates.push({ file, id: `pi-${header.id}`, cwd: header.cwd, createdAt: header.createdAt })
    }
  } else if (source === 'opencode') {
    for (const row of listOpencodeSessions(options.opencodeDb)) {
      candidates.push({
        row,
        id: `oc-${String(row.id).replace(/^ses_/, '')}`,
        cwd: typeof row.directory === 'string' && row.directory.length > 0 ? row.directory : undefined,
        createdAt: row.time_created,
      })
    }
  } else if (source === 'codex') {
    for (const file of listCodexSessions(options.codexRoot)) {
      const parsed = parseCodexSession(file)
      if (parsed.header.id === undefined) continue
      candidates.push({
        file,
        parsed,
        id: `codex-${parsed.header.id}`,
        cwd: parsed.header.cwd,
        createdAt: parsed.header.createdAt,
      })
    }
  } else if (source === 'claude-code') {
    for (const entry of listClaudeSessions(options.claudeRoot)) {
      const parsed = parseClaudeSession(entry.file, entry.cwd)
      if (parsed.header.id === undefined) continue
      candidates.push({
        file: entry.file,
        parsed,
        id: `claude-${parsed.header.id}`,
        cwd: entry.cwd,
        createdAt: parsed.header.createdAt,
      })
    }
  } else {
    throw new Error(`未知来源: ${source}（可选 pi / opencode / codex / claude-code）`)
  }

  let selected = candidates
  if (options.project !== undefined) {
    selected = selected.filter(c => typeof c.cwd === 'string' && c.cwd.includes(options.project))
  }
  if (options.since !== undefined) {
    selected = selected.filter(c => typeof c.createdAt === 'number' && c.createdAt >= options.since)
  }
  if (options.limit !== undefined) {
    selected = [...selected].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, options.limit)
  }
  log(`[${source}] 候选 ${selected.length}/${candidates.length} 个会话`)

  const existing = []
  const imported = []
  const empty = []
  const failed = []
  let previewDone = false

  for (const candidate of selected) {
    if (findExistingSession(options.sessionsRoot, candidate.id)) {
      existing.push(candidate)
      continue
    }
    try {
      let messages
      let sourceTitle
      if (source === 'pi') {
        const parsed = parsePiSession(candidate.file)
        if (parsed.header.createdAt !== undefined) candidate.createdAt = parsed.header.createdAt
        messages = parsed.messages
      } else if (source === 'opencode') {
        messages = readOpencodeSession(options.opencodeDb, candidate.row.id)
        sourceTitle = candidate.row.title
      } else {
        messages = candidate.parsed.messages
        sourceTitle = candidate.parsed.header.title
      }
      if (messages.length === 0) {
        empty.push(candidate)
        continue
      }
      const events = toEvents(messages, { ...options, title: deriveImportTitle(sourceTitle, messages) })
      if (options.apply) {
        const path = writeSession(options.sessionsRoot, {
          id: candidate.id,
          createdAt: candidate.createdAt ?? messages[0].time,
          cwd: candidate.cwd,
        }, events)
        log(`  [写入] ${candidate.id}  ${candidate.cwd ?? '(无 cwd)'}  ${messages.length} 条消息 -> ${events.length} 事件 -> ${path}`)
      } else {
        log(`  [待导入] ${candidate.id}  ${candidate.cwd ?? '(无 cwd)'}  ${messages.length} 条消息 -> ${events.length} 事件`)
      }
      imported.push({ candidate, events })
      if (!previewDone && options.preview > 0) {
        previewDone = true
        log(`  --- 事件预览（${source}）---`)
        for (let i = 0; i < Math.min(events.length, options.preview); i++) {
          log(`    [${i}] ${renderEvent(events[i])}`)
        }
      }
    } catch (error) {
      failed.push({ candidate, error })
      log(`  [失败] ${candidate.id}: ${error.message}`)
    }
  }

  log(`[${source}] 结果: 新导入 ${imported.length}，已存在跳过 ${existing.length}，空会话 ${empty.length}，失败 ${failed.length}`)
  if (!options.apply && imported.length > 0) {
    log(`[${source}] 提示: 加上 --apply 才会写入 ${options.sessionsRoot}，随后重启 dsh web 生效`)
  }
  return { imported, existing, empty, failed }
}

/** Import agents/prompts as skills. */
function importAgents(options) {
  const candidates = collectAgents(options.piAgentRoot, options.opencodeConfig)
  const plans = planSkillWrites(options.skillsRoot, candidates)
  const stats = { write: 0, complete: 0, skip: 0 }
  for (const plan of plans) {
    stats[plan.action] += 1
    if (plan.action === 'skip') {
      log(`  [跳过] ${plan.name}: ${plan.reason ?? '已存在'}`)
      continue
    }
    const note = plan.action === 'complete'
      ? '（补全既有 bundle）'
      : plan.renamed ? `（因名称冲突改名 ${plan.name}）` : ''
    if (options.apply) {
      applySkillPlan(plan)
      log(`  [写入] ${plan.target}${note}`)
    } else {
      const size = plan.candidate.sourceFile !== undefined ? fileSize(plan.candidate.sourceFile) : '?'
      log(`  [待写入] ${plan.name}${note} <- ${plan.candidate.source}/${plan.candidate.kind}（源文件 ${size}）`)
    }
  }
  log(`[agents] 结果: 新写入 ${stats.write}，补全 ${stats.complete}，跳过 ${stats.skip}`)
  return plans
}

/** Scan project-level agent/skill/instruction files (report only). */
function scanProjects(options) {
  const seen = new Map()
  const consider = (cwd) => {
    if (typeof cwd === 'string' && cwd.length > 0 && existsSync(cwd)) seen.set(cwd, true)
  }
  for (const file of listPiSessions(options.piRoot)) {
    const header = piSessionHeader(file)
    consider(header.cwd)
  }
  for (const row of listOpencodeSessions(options.opencodeDb)) consider(row.directory)

  log(`[projects] 扫描 ${seen.size} 个项目目录的项目级指令/agent/skill:`)
  for (const project of [...seen.keys()].sort()) {
    const findings = []
    for (const sub of ['.opencode/agent', '.opencode/skill', '.pi/agent', '.agents/skills', '.dsh/skills']) {
      if (existsSync(join(project, sub))) findings.push(sub)
    }
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      if (existsSync(join(project, name))) findings.push(name)
    }
    log(`  ${project}${findings.length === 0 ? '  （无）' : `  ->  ${findings.join(', ')}`}`)
  }
  log('[projects] 说明: AGENTS.md/CLAUDE.md 由 DSH 会话自动读取；.agents/skills 与 .dsh/skills 已是 DSH 技能根，无需导入。')
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2), {
    'dry-run': false,
    apply: false,
    preview: 1,
    'tool-truncate': 1000,
  })
  if (flags.help || positionals.length === 0) {
    process.stdout.write(USAGE)
    return
  }
  const command = positionals[0]
  const options = {
    apply: flags.apply === true,
    project: flags.project,
    since: parseSince(flags.since),
    limit: flags.limit === undefined ? undefined : Number(flags.limit),
    noTools: flags['no-tools'] === true,
    toolsAsText: flags['tools-as-text'] === true,
    truncate: flags.truncate === undefined ? undefined : Number(flags.truncate),
    toolTruncate: flags['tool-truncate'] === undefined ? 1000 : Number(flags['tool-truncate']),
    preview: Number(flags.preview ?? 1),
    sessionsRoot: flags['sessions-root'] ?? join(dshHome(), 'sessions'),
    skillsRoot: flags['skills-root'] ?? join(agentsHome(), 'skills'),
    piRoot: flags['pi-root'] ?? defaultPiRoot(),
    piAgentRoot: flags['pi-agent-root'] ?? join(process.env.HOME ?? '', '.pi', 'agent'),
    opencodeDb: flags['opencode-db'] ?? defaultOpencodeDb(),
    opencodeConfig: flags['opencode-config'] ?? join(process.env.HOME ?? '', '.config', 'opencode'),
    codexRoot: flags['codex-root'] ?? defaultCodexRoot(),
    claudeRoot: flags['claude-root'] ?? defaultClaudeRoot(),
  }
  if (options.limit !== undefined && !Number.isInteger(options.limit)) throw new Error('--limit 必须是整数')
  if (options.truncate !== undefined && (!Number.isInteger(options.truncate) || options.truncate < 0)) throw new Error('--truncate 必须是非负整数')
  if (options.toolTruncate !== undefined && (!Number.isInteger(options.toolTruncate) || options.toolTruncate < 0)) throw new Error('--tool-truncate 必须是非负整数')
  if (options.truncate === 0) options.truncate = undefined
  if (options.toolTruncate === 0) options.toolTruncate = undefined

  log(`模式: ${options.apply ? '--apply（写入）' : '--dry-run（预览）'}`)
  log(`会话根: ${options.sessionsRoot}`)
  log(`技能根: ${options.skillsRoot}`)

  if (command === 'sessions') {
    const source = positionals[1]
    if (!['pi', 'opencode', 'codex', 'claude-code'].includes(source)) throw new Error('sessions 需要 pi / opencode / codex / claude-code 参数')
    importSessions(source, options)
  } else if (command === 'agents') {
    importAgents(options)
  } else if (command === 'projects') {
    scanProjects(options)
  } else if (command === 'all') {
    importSessions('pi', options)
    importSessions('opencode', options)
    importAgents(options)
  } else {
    throw new Error(`未知命令: ${command}\n${USAGE}`)
  }
}

main().catch((error) => {
  log(`错误: ${error.message}`)
  process.exitCode = 1
})
