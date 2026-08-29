/**
 * parseCodexSession / listCodexConversations 回归测试。
 *
 * codex 新版 rollout 文件（rollout-<timestamp>-<uuid>.jsonl）把会话族谱写进
 * 多个 session_meta 事件：第一个是该文件自己的会话 id（= 文件名 uuid），最后
 * 一个是会话 ROOT（id === session_id）。解析必须取第一个做文件自己 id，取最后
 * 一个做 root；同 root 的 sub-agent / fork 片段合并为一个会话（去重）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { listCodexConversations, parseCodexSession } from '../lib/codex-reader.mjs'

let dir = ''
const tempFile = (name: string, lines: string[]) => {
  if (dir.length === 0) dir = mkdtempSync(join(tmpdir(), 'codex-'))
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

  it('reports the conversation ROOT from the last session_meta record', () => {
    const file = tempFile('rollout-2026-08-25T00-08-04-01a03487-66a2-77e0-95aa-a73e1e1dbb61.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a03487-66a2-77e0-95aa-a73e1e1dbb61', cwd: '/proj', timestamp: '2026-08-25T00:08:04.000Z' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02352-a422-7a81-8e17-fcd19797f30a', cwd: '/proj', timestamp: '2026-08-21T07:56:53.000Z' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02333-ddc6-73b1-91df-081d361fe055', cwd: '/proj', timestamp: '2026-08-21T07:23:16.000Z' } }),
    ])
    const { header, root } = parseCodexSession(file)
    expect(header.id).toBe('01a03487-66a2-77e0-95aa-a73e1e1dbb61')
    expect(root.id).toBe('01a02333-ddc6-73b1-91df-081d361fe055')
    expect(root.createdAt).toBe(Date.parse('2026-08-21T07:23:16.000Z'))
  })
})

describe('listCodexConversations', () => {
  it('merges sub-agent/fork files of one root into a single conversation', () => {
    tempFile('rollout-2026-08-21T07-23-16-01a02333-ddc6-73b1-91df-081d361fe055.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02333-ddc6-73b1-91df-081d361fe055', cwd: '/proj', timestamp: '2026-08-21T07:23:16.000Z' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题一' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '回答一' }] } }),
    ])
    // sub-agent file: own id differs, chain ends at the same root; repeats one
    // user message (cumulative) that must be deduped.
    tempFile('rollout-2026-08-21T08-00-00-01a02352-a422-7a81-8e17-fcd19797f30a.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02352-a422-7a81-8e17-fcd19797f30a', cwd: '/proj', timestamp: '2026-08-21T08:00:00.000Z' } }),
      JSON.stringify({ type: 'session_meta', payload: { id: '01a02333-ddc6-73b1-91df-081d361fe055', cwd: '/proj', timestamp: '2026-08-21T07:23:16.000Z' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题一' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '回答一' }] } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '问题二' }] } }),
    ])
    const conversations = listCodexConversations(dir)
    expect(conversations).toHaveLength(1)
    const conv = conversations[0]
    expect(conv.header.id).toBe('01a02333-ddc6-73b1-91df-081d361fe055')
    expect(conv.files).toBe(2)
    const texts = conv.messages.map(m => m.blocks.map(b => b.text).join(''))
    // cumulative duplicate '问题一'/'回答一' appears once; '问题二' is new
    expect(texts.filter(t => t.includes('问题一'))).toHaveLength(1)
    expect(texts.filter(t => t.includes('回答一'))).toHaveLength(1)
    expect(texts.some(t => t.includes('问题二'))).toBe(true)
  })

  it('keeps standalone sessions as their own conversation', () => {
    tempFile('rollout-01a01a6f-6aba-7071-8be1-2796822e3319.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a01a6f-6aba-7071-8be1-2796822e3319', cwd: '/x', timestamp: '2026-08-21T00:00:00.000Z' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] } }),
    ])
    tempFile('rollout-2026-08-22T00-00-00-01a01a70-24ec-7582-8b1c-254395781c54.jsonl', [
      JSON.stringify({ type: 'session_meta', payload: { id: '01a01a70-24ec-7582-8b1c-254395781c54', cwd: '/y', timestamp: '2026-08-22T00:00:00.000Z' } }),
    ])
    const conversations = listCodexConversations(dir)
    expect(conversations).toHaveLength(2)
    expect(conversations[0].header.id).toBe('01a01a70-24ec-7582-8b1c-254395781c54')
  })
})
