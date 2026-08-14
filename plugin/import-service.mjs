/**
 * 插件版导入服务：复用 ../lib 的解析与转换逻辑，但写入走 dsh 的
 * ctx.sessionPersistence（create + append），会话立即对 GUI 可见，
 * 不需要写文件、不需要重启进程。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildDshEvents, deriveImportTitle } from '../lib/convert.mjs'
import { attachSessionsToWorkspaces } from './attach-workspaces.mjs'
import { listPiSessions, parsePiSession } from '../lib/pi-reader.mjs'
import { listOpencodeSessions, readOpencodeSession } from '../lib/opencode-reader.mjs'
import { listCodexSessions, parseCodexSession } from '../lib/codex-reader.mjs'
import { listClaudeSessions, parseClaudeSession } from '../lib/claude-reader.mjs'
import { applySkillPlan, collectAgents, planSkillWrites } from '../lib/agents.mjs'

/** 读取 pi 会话文件头（id/cwd/createdAt），不解析整文件。 */
function piSessionHeader(file, readFileSync) {
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

/** 把归一化消息流折叠成事件并应用块级选项（与 CLI 一致）。 */
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
    if (options.toolTruncate !== undefined) {
      blocks = blocks.map((block) => {
        if (block.type === 'tool-call') {
          return { ...block, arguments: truncate(block.arguments, options.toolTruncate) }
        }
        return block
      })
    }
    filtered.push({ ...message, blocks })
  }
  return buildDshEvents(filtered, {
    toolEvents: options.noTools !== true && options.toolsAsText !== true,
    title: options.title,
    titlePinned: options.titlePinned,
  })
}

function truncate(text, max) {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 导入一个来源的会话到 persistence。
 * @returns 摘要行数组。
 */
export async function importSessions(persistence, source, options) {
  const { readFileSync } = await import('node:fs')
  const existing = new Set((await persistence.list()).map(meta => meta.id))
  const lines = []
  const candidates = []
  if (source === 'pi') {
    for (const file of listPiSessions(options.piRoot)) {
      const header = piSessionHeader(file, readFileSync)
      if (header.id === undefined) continue
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
      candidates.push({ file, parsed, id: `codex-${parsed.header.id}`, cwd: parsed.header.cwd, createdAt: parsed.header.createdAt })
    }
  } else if (source === 'claude-code') {
    for (const entry of listClaudeSessions(options.claudeRoot)) {
      const parsed = parseClaudeSession(entry.file, entry.cwd)
      if (parsed.header.id === undefined) continue
      candidates.push({ file: entry.file, parsed, id: `claude-${parsed.header.id}`, cwd: entry.cwd, createdAt: parsed.header.createdAt })
    }
  } else {
    throw new Error(`未知来源: ${source}`)
  }

  let selected = candidates
  if (options.project !== undefined) {
    selected = selected.filter(c => typeof c.cwd === 'string' && c.cwd.includes(options.project))
  }
  if (typeof options.cwdFilter === 'function') {
    selected = selected.filter(c => typeof c.cwd === 'string' && options.cwdFilter(c.cwd))
  }
  if (options.since !== undefined) {
    selected = selected.filter(c => typeof c.createdAt === 'number' && c.createdAt >= options.since)
  }
  if (options.limit !== undefined) {
    selected = [...selected].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, options.limit)
  }

  let imported = 0
  let skipped = 0
  let empty = 0
  for (const candidate of selected) {
    if (existing.has(candidate.id)) {
      skipped += 1
      continue
    }
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
      empty += 1
      continue
    }
    const events = toEvents(messages, {
      ...options,
      title: deriveImportTitle(sourceTitle, messages, source),
      titlePinned: true,
    })
      .map((event, seq) => ({ ...event, seq }))
    await persistence.create({
      version: 0,
      id: candidate.id,
      createdAt: candidate.createdAt ?? messages[0].time,
      ...(candidate.cwd !== undefined ? { cwd: candidate.cwd } : {}),
    })
    await persistence.append(candidate.id, events)
    imported += 1
    lines.push(`  [imported] ${candidate.id}  ${candidate.cwd ?? '(no cwd)'}  ${messages.length} messages -> ${events.length} events`)
  }
  lines.push(`[${source}] result: imported ${imported}, skipped ${skipped}, empty ${empty}`)
  // 新导入的会话挂到对应工作区（workspace 服务未加载时静默跳过）。
  if (imported > 0 && persistence.ctx !== undefined) {
    const attached = await attachSessionsToWorkspaces(
      persistence.ctx,
      selected.filter(candidate => candidate.id !== undefined && /^(pi|oc|codex|claude)-/u.test(candidate.id)),
    )
    lines.push(...attached)
  }
  return lines
}

/**
 * 导入 agents / 模式提示词为 skills（直接写 ~/.agents/skills，与 CLI 一致）。
 * @returns 摘要行数组。
 */
export function importAgents(options) {
  const candidates = collectAgents(options.piAgentRoot, options.opencodeConfig)
  const plans = planSkillWrites(options.skillsRoot, candidates)
  const lines = []
  let written = 0
  for (const plan of plans) {
    if (plan.action === 'skip') {
      lines.push(`  [skipped] ${plan.name}: ${plan.reason ?? 'already exists'}`)
      continue
    }
    applySkillPlan(plan)
    written += 1
    const note = plan.action === 'complete' ? ' (completed existing bundle)' : plan.renamed ? ` (renamed ${plan.name} due to conflict)` : ''
    lines.push(`  [written] ${plan.target}${note}`)
  }
  lines.push(`[agents] result: wrote ${written}, skipped ${plans.length - written}`)
  return lines
}
