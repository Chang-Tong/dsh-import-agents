#!/usr/bin/env node
/**
 * 把 pi / opencode 的会话转写为 Markdown 文件，供任何 agent 直接阅读。
 *
 * 用法:
 *   node export.mjs [--source pi|opencode|all] [--project 子串] [--limit N]
 *                   [--out <目录>] [--no-reasoning] [--no-tools]
 *
 * 默认输出到 ~/.dsh/exports/<source>/<session-id>.md。
 * 与 import.mjs 共用 lib/ 的解析逻辑；这里不做 dsh 会话写入，只转写。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { dshHome, log, parseArgs, parseSince, truncate } from './lib/util.mjs'
import { listPiSessions, parsePiSession } from './lib/pi-reader.mjs'
import { listOpencodeSessions, readOpencodeSession } from './lib/opencode-reader.mjs'

const USAGE = `用法:
  node export.mjs [options]

options:
  --source <pi|opencode|all>  导出来源（默认 all）
  --project <substr>          只导出 cwd 包含该子串的会话
  --limit <n>                 最多导出 n 个会话（按创建时间从新到旧）
  --since <iso|ms>            只导出创建时间不早于该值的会话
  --out <dir>                 输出目录（默认 $DSH_HOME/exports）
  --no-reasoning              不导出推理块
  --no-tools                  不导出工具调用
`

/** ISO 时间格式化（本地时区）。 */
function fmtTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '?'
  const date = new Date(ms)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 一条消息的 markdown（文本 + 折叠推理 + 工具调用）。 */
function renderMessage(message, options) {
  const role = message.role === 'user' ? '用户' : '助手'
  const model = message.model !== undefined ? `（${message.provider ?? ''}/${message.model}）` : ''
  const lines = [`## ${role}${model} · ${fmtTime(message.time)}`]
  const texts = message.blocks.filter(block => block.type === 'text')
  const reasoning = options.reasoning ? message.blocks.filter(block => block.type === 'reasoning') : []
  const tools = options.tools ? message.blocks.filter(block => block.type === 'tool-call') : []
  if (texts.length > 0) {
    for (const block of texts) lines.push('', block.text)
  } else {
    lines.push('', '*(无文本内容)*')
  }
  if (reasoning.length > 0) {
    lines.push('', '<details><summary>推理</summary>', '', ...reasoning.map(block => block.text), '', '</details>')
  }
  for (const tool of tools) {
    lines.push('', `### 工具调用: \`${tool.name}\``, '```json', tool.arguments, '```')
  }
  return lines.join('\n')
}

/** 一个会话的完整 markdown。 */
function renderSession(source, header, messages, options) {
  const title = `${source} 会话 ${header.id}`
  const lines = [
    `# ${title}`,
    '',
    `- 来源: ${source}`,
    `- 工作目录: ${header.cwd ?? '(无)'}`,
    `- 创建时间: ${fmtTime(header.createdAt)}`,
    `- 消息数: ${messages.length}`,
    '',
    '> 本文件由 import-pi-opencode 的 export.mjs 从原始会话数据转写。',
    '> 同一份历史也已导入 dsh（会话 id 前缀 pi- / oc-），可在 dsh 会话列表中恢复继续对话。',
    '',
  ]
  for (const message of messages) {
    lines.push(renderMessage(message, options), '')
  }
  return lines.join('\n')
}

/** 导出一种来源；返回导出文件列表。 */
function exportSource(source, options) {
  const files = []
  const candidates = []
  if (source === 'pi') {
    for (const file of listPiSessions(options.piRoot)) {
      const parsed = parsePiSession(file)
      if (parsed.header.id === undefined) continue
      candidates.push({ file, header: parsed.header, messages: parsed.messages })
    }
  } else if (source === 'opencode') {
    for (const row of listOpencodeSessions(options.opencodeDb)) {
      candidates.push({
        row,
        header: { id: String(row.id).replace(/^ses_/, ''), cwd: row.directory, createdAt: row.time_created },
        messages: readOpencodeSession(options.opencodeDb, row.id),
      })
    }
  } else {
    throw new Error(`未知来源: ${source}`)
  }

  let selected = candidates
  if (options.project !== undefined) {
    selected = selected.filter(c => typeof c.header.cwd === 'string' && c.header.cwd.includes(options.project))
  }
  if (options.since !== undefined) {
    selected = selected.filter(c => typeof c.header.createdAt === 'number' && c.header.createdAt >= options.since)
  }
  if (options.limit !== undefined) {
    selected = [...selected].sort((a, b) => (b.header.createdAt ?? 0) - (a.header.createdAt ?? 0)).slice(0, options.limit)
  }

  const dir = join(options.out, source)
  mkdirSync(dir, { recursive: true })
  for (const candidate of selected) {
    const id = source === 'pi' ? `pi-${candidate.header.id}` : `oc-${candidate.header.id}`
    const path = join(dir, `${id}.md`)
    writeFileSync(path, renderSession(source, candidate.header, candidate.messages, options))
    files.push({ id, cwd: candidate.header.cwd, messages: candidate.messages.length, path })
  }
  return files
}

async function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2), {})
  if (flags.help || positionals.length > 0) {
    process.stdout.write(USAGE)
    return
  }
  const options = {
    source: flags.source ?? 'all',
    project: flags.project,
    since: parseSince(flags.since),
    limit: flags.limit === undefined ? undefined : Number(flags.limit),
    out: flags.out ?? join(dshHome(), 'exports'),
    reasoning: flags['no-reasoning'] === undefined,
    tools: flags['no-tools'] === undefined,
    piRoot: flags['pi-root'] ?? join(process.env.HOME ?? '', '.pi', 'agent', 'sessions'),
    opencodeDb: flags['opencode-db'] ?? join(process.env.HOME ?? '', '.local', 'share', 'opencode', 'opencode.db'),
  }
  if (options.limit !== undefined && !Number.isInteger(options.limit)) throw new Error('--limit 必须是整数')

  const sources = options.source === 'all' ? ['pi', 'opencode'] : [options.source]
  let total = 0
  for (const source of sources) {
    const exported = exportSource(source, options)
    total += exported.length
    log(`[${source}] 导出 ${exported.length} 个会话到 ${join(options.out, source)}/`)
    for (const file of exported.slice(0, 5)) {
      log(`  ${file.id}  ${file.cwd ?? '(无 cwd)'}  ${file.messages} 条消息 -> ${file.path}`)
    }
    if (exported.length > 5) log(`  ... 其余 ${exported.length - 5} 个略`)
  }
  log(`[导出完成] 共 ${total} 个会话，输出目录: ${options.out}`)
}

main().catch((error) => {
  log(`错误: ${error.message}`)
  process.exitCode = 1
})
