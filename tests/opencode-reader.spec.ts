// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { listOpencodeSessions, readOpencodeSession } from '../lib/opencode-reader.mjs'

describe('opencode reader on a machine without opencode', () => {
  it('lists no sessions instead of throwing when the DB file is absent', () => {
    expect(listOpencodeSessions('/nonexistent/opencode.db')).toEqual([])
  })

  it('reads no messages when the DB file is absent', () => {
    expect(readOpencodeSession('/nonexistent/opencode.db', 'ses_x')).toEqual([])
  })
})
