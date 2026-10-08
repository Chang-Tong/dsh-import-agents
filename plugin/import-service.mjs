/**
 * 插件版导入服务：复用 ../lib 的解析与转换逻辑，但写入走 dsh 的
 * ctx.sessionPersistence（create + append），会话立即对 GUI 可见，
 * 不需要写文件、不需要重启进程。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { buildDshEvents, deriveImportTitle } from '../lib/convert.mjs'
import { readFirstLine } from '../lib/lines.mjs'
import { attachSessionsToWorkspaces } from './attach-workspaces.mjs'
import { listPiSessions, parsePiSession } from '../lib/pi-reader.mjs'
import { listOpencodeSessions, readOpencodeSession } from '../lib/opencode-reader.mjs'
import { listCodexConversations } from '../lib/codex-reader.mjs'
import { listClaudeSessions, parseClaudeSession } from '../lib/claude-reader.mjs'
import { applySkillPlan, collectAgents, planSkillWrites } from '../lib/agents.mjs'

/** 读取 pi 会话文件头（id/cwd/createdAt），不解析整文件。 */
function piSessionHeader(file) {
  const first = readFirstLine(file)
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
 * 当前 Session 逻辑格式版本，必须与运行中的 harness 一致（@deepseek-ai/dsh-session
 * 的 SESSION_FORMAT_VERSION）。不 import 该常量：插件的裸导入会解析到本仓库嵌套
 * 安装的旧 pre-release 副本（rc.6，SESSION_FORMAT_VERSION=0），而不是 app 打包的
 * 当前版本——那样 version:0 会被宿主在 encodeCurrent 处拒绝（"requires Session
 * format v4"）。人工同步该数字与 harness 的 SESSION_FORMAT_VERSION。
 */
export const SESSION_FORMAT_VERSION = 4

/**
 * 单次 append 的体积上限。后端把整批事件序列化成一个字符串
 * （`eventLines = events.map(eventLine).join('\n')`），超过 V8 的单字符串上限
 * （2^29 - 24 ≈ 512MB 字符）就抛 "Cannot create a string longer than
 * 0x1fffffe8 characters"。大导入（如 650MB 的 codex rollout）必须分批写。
 */
const APPEND_BATCH_BYTES = 32 << 20

/**
 * 按估算的序列化体积把事件切成连续批次写入句柄。
 * @param handle - create 返回的写句柄。
 * @param events - 完整有序的事件列表（seq 连续）。
 */
async function appendInBatches(handle, events) {
  let batch = []
  let bytes = 0
  for (const event of events) {
    batch.push(event)
    bytes += JSON.stringify(event).length + 1
    if (bytes >= APPEND_BATCH_BYTES) {
      await handle.append(batch)
      batch = []
      bytes = 0
    }
  }
  if (batch.length > 0) await handle.append(batch)
}

/**
 * 导入一个来源的会话到 persistence。
 * @returns 摘要行数组。
 */
export async function importSessions(persistence, source, options) {
  const existing = new Set((await persistence.list()).map(snapshot => snapshot.header.id))
  const lines = []
  const candidates = []
  if (source === 'pi') {
    for (const file of listPiSessions(options.piRoot)) {
      const header = piSessionHeader(file)
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
    // 一个 codex 逻辑会话 = 一个 root：sub-agent 与 fork 片段都归入 root，
    // 只导一个 dsh 会话（消息已按 root 合并去重）。
    for (const conversation of listCodexConversations(options.codexRoot)) {
      if (conversation.header.id === undefined) continue
      candidates.push({ parsed: { header: conversation.header, messages: conversation.messages }, id: `codex-${conversation.header.id}`, cwd: conversation.header.cwd, createdAt: conversation.header.createdAt })
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

  // 同一会话 id 可能命中多个源文件（如 codex 每个 turn 一个 rollout 文件、根目录
  // 符号链接重复枚举）：保留第一个出现者，避免同一次运行内重复 create 被拒绝。
  const byId = new Map()
  for (const candidate of selected) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate)
  }
  selected = [...byId.values()]

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
    let handle
    try {
      handle = await persistence.create({
        version: SESSION_FORMAT_VERSION,
        id: candidate.id,
        createdAt: candidate.createdAt ?? messages[0].time,
        isSeeded: false,
        ...(candidate.cwd !== undefined ? { cwd: candidate.cwd } : {}),
      })
    } catch (error) {
      // 会话已存在于后端（内存态或磁盘产物）时 create 抛 SessionAlreadyExistsError
      // （"session \"…\" already exists"）；旧版后端消息也含 "already exists"。
      // 按跳过处理，不重复写入。
      const message = String(error?.message ?? error)
      if (message.includes('already exists')) {
        skipped += 1
        existing.add(candidate.id)
        continue
      }
      throw error
    }
    // 当前持久化服务是 handle 制：create 返回独占写句柄，事件经 handle.append 写入；
    // flush 让会话落盘（列表可见），close 释放写所有权。服务本身没有 append(id, events)。
    // 大事件列表分批写，避免后端单批序列化越过 V8 字符串上限。
    try {
      await appendInBatches(handle, events)
      await handle.flush()
    } finally {
      await handle.close()
    }
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
