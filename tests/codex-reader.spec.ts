/**
 * parseCodexSession 会话 id 提取回归测试。
 *
 * codex 新版 rollout 文件（rollout-<timestamp>-<uuid>.jsonl）会把会话族谱写进
 * 多个 session_meta 事件：第一个是该文件自己的会话 id（= 文件名 uuid），后续是
 * 父/根会话 id。解析必须取第一个，否则新会话会被并到旧的父 id 上、被当作
 * "已存在" 而跳过，最新 codex 会话无法导入。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCodexSession } from '../lib/codex-reader.mjs'

let dir = ''
const tempFile = (name: string, lines: string[]) => {
  dir = mkdtempSync(join(tmpdir(), 'codex-'))
  const file = join(dir, name)
  writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

afterEach(() => {
  if (dir.length > 0) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('parseCodexSession session id', () => {
  it('uses the FIRST session_meta id (its own session), not the lineage parent', () => {
    const file = tempFile('rollout-2026-08-25T00-08-04-01a03487-66a2-77e0-95aa-a73e1e1dbb61.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a03487-66a2-77e0-95aa-a73e1e1dbb61', cwd: '/proj', timestamp: '2026-08-25T00:08:04.000Z' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02352-a422-7a81-8e17-fcd19797f30a', cwd: '/proj', timestamp: '2026-08-25T00:08:04.000Z' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02333-ddc6-73b1-91df-081d361fe055', cwd: '/proj', timestamp: '2026-08-25T00:08:04.000Z' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hello' }] } }),
    ])
    const { header } = parseCodexSession(file)
    expect(header.id).toBe('01a03487-66a2-77e0-95aa-a73e1e1dbb61')
    expect(header.cwd).toBe('/proj')
  })

  it('keeps a single session_meta unchanged (older codex format)', () => {
    const file = tempFile('rollout-01a01a6f-6aba-7071-8be1-2796822e3319.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a01a6f-6aba-7071-8be1-2796822e3319', cwd: '/x', timestamp: '2026-08-21T00:00:00.000Z' } }),
    ])
    const { header } = parseCodexSession(file)
    expect(header.id).toBe('01a01a6f-6aba-7071-8be1-2796822e3319')
  })
})
