// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { attachSessionsToWorkspaces } from '../plugin/attach-workspaces.mjs'

const eNoent = Object.assign(
  new Error(`ENOENT: no such file or directory, realpath '/workspace/demo'`),
  { code: 'ENOENT' },
)

describe('attachSessionsToWorkspaces with a cwd missing on this machine', () => {
  it('reports a skip, not a failure, and says the session stays ungrouped', async () => {
    const ctx = {
      get: (name) => (name === 'workspaceRegistry' ? { resolveByPath: async () => { throw eNoent } } : undefined),
    }
    const lines = await attachSessionsToWorkspaces(ctx, [{ id: 'pi-x', cwd: '/workspace/demo' }])
    expect(lines[0]).toContain('[skipped] /workspace/demo')
    expect(lines[0]).toContain('ungrouped')
    expect(lines[0]).not.toContain('[failed]')
  })

  it('still reports a failure for non-ENOENT workspace errors', async () => {
    const ctx = {
      get: (name) => (name === 'workspaceRegistry' ? { resolveByPath: async () => { throw new Error('boom') } } : undefined),
    }
    const lines = await attachSessionsToWorkspaces(ctx, [{ id: 'pi-x', cwd: '/workspace/demo' }])
    expect(lines[0]).toContain('[failed] /workspace/demo')
    expect(lines[0]).toContain('boom')
  })
})
