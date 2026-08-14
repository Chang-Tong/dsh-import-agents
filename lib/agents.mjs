/**
 * Convert pi / opencode agents and mode prompts into DSH skills.
 *
 * Sources:
 *   ~/.pi/agent/agents/*.md        pi custom agents (frontmatter: name, description, …)
 *   ~/.pi/agent/prompts/*.md       pi mode prompt templates (frontmatter: description)
 *   ~/.config/opencode/agents/*.md opencode agents (frontmatter: description, mode, …)
 *   ~/.config/opencode/skill/*.md  opencode skills, when present
 *
 * Targets: <agentsHome>/skills/<name>/SKILL.md bundles (dsh-skill-filesystem
 * user-agents root). Name collisions across sources are disambiguated with a
 * `-pi` / `-opencode` suffix; an existing bundle without SKILL.md is completed
 * in place (e.g. kimi-vision keeps its scripts/ directory).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Enumerate markdown files in a directory (empty when absent). */
function listMd(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => join(dir, entry.name))
      .sort()
  } catch {
    return []
  }
}

/** Split frontmatter + body; returns { frontmatter: {}, body, raw } or null. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (match === null) return null
  const frontmatter = {}
  let currentKey
  for (const line of match[1].split(/\r?\n/)) {
    const simple = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (simple) {
      currentKey = simple[1]
      frontmatter[currentKey] = simple[2]
    } else if (currentKey !== undefined && line.trim().length > 0) {
      // Nested YAML (e.g. permission: edit: deny) — keep the raw block.
      frontmatter[currentKey] = `${frontmatter[currentKey] ?? ''}\n${line}`
    }
  }
  return { frontmatter, body: match[2], raw: text }
}

/** Collect one source's candidates: { name, source, description, body }. */
function collectSource(dir, source, kind, nameFrom = file => file.replace(/\.md$/, '')) {
  const candidates = []
  for (const file of listMd(dir)) {
    const stem = file.slice(0, -3).split('/').pop()
    const parsed = parseFrontmatter(readFileSync(file, 'utf8'))
    const frontmatter = parsed?.frontmatter ?? {}
    const name = String(frontmatter.name ?? nameFrom(stem)).trim() || stem
    if (frontmatter.kind === 'dsh' || frontmatter.kind === 'skill') {
      // Already a DSH skill; never double-import.
      continue
    }
    candidates.push({
      name,
      source,
      kind,
      sourceFile: file,
      description: String(frontmatter.description ?? '').trim(),
      body: parsed === null ? readFileSync(file, 'utf8') : parsed.body,
    })
  }
  return candidates
}

/** All candidates from pi + opencode. */
export function collectAgents(piRoot, opencodeConfigRoot) {
  const candidates = []
  candidates.push(...collectSource(join(piRoot, 'agents'), 'pi', 'agent'))
  candidates.push(...collectSource(join(piRoot, 'prompts'), 'pi', 'prompt', stem => `pi-prompt-${stem}`))
  candidates.push(...collectSource(join(opencodeConfigRoot, 'agents'), 'opencode', 'agent'))
  candidates.push(...collectSource(join(opencodeConfigRoot, 'skill'), 'opencode', 'skill'))
  return candidates
}

/** Stable frontmatter for a DSH skill file. */
function skillFrontmatter(candidate) {
  const lines = ['---', `name: ${candidate.name}`]
  if (candidate.description.length > 0) {
    lines.push(`description: ${candidate.description}`)
  } else {
    lines.push(`description: 导入自 ${candidate.source} 的 ${candidate.kind}（${candidate.name}）`)
  }
  lines.push(`metadata:`)
  lines.push(`  source: ${candidate.source}`)
  lines.push(`  kind: ${candidate.kind}`)
  lines.push('---')
  return `${lines.join('\n')}\n`
}

/**
 * Plan skill writes without touching the filesystem.
 * @returns [{ target, name, action: 'write'|'complete'|'skip', candidate }]
 */
export function planSkillWrites(skillsRoot, candidates) {
  const plans = []
  const taken = new Map() // final target name -> content hash
  for (const candidate of candidates) {
    const content = `${skillFrontmatter(candidate)}${candidate.body}`
    let name = candidate.name
    let renamed = false
    if (taken.has(name)) {
      // Another source already claimed this name earlier in this plan run.
      const suffixed = `${name}-${candidate.source}`
      if (taken.has(suffixed)) {
        plans.push({ name, action: 'skip', candidate, target: undefined, reason: `名称冲突（${suffixed} 已被占用）` })
        continue
      }
      name = suffixed
      renamed = true
    }
    const dir = join(skillsRoot, name)
    const existing = existsSync(dir)
      ? readdirSync(dir).find(entry => entry === 'SKILL.md')
      : undefined
    if (existing !== undefined) {
      const current = readFileSync(join(dir, 'SKILL.md'), 'utf8')
      if (current === content) {
        plans.push({ name, action: 'skip', candidate, target: join(dir, 'SKILL.md'), reason: '内容相同' })
        continue
      }
      const suffixed = `${name}-${candidate.source}`
      if (taken.has(suffixed) || existsSync(join(skillsRoot, suffixed, 'SKILL.md'))) {
        plans.push({ name, action: 'skip', candidate, target: undefined, reason: `名称冲突（${suffixed} 已存在）` })
        continue
      }
      plans.push({ name: suffixed, action: 'write', candidate, target: join(skillsRoot, suffixed, 'SKILL.md'), renamed: true })
      taken.set(suffixed, content)
      continue
    }
    if (existsSync(dir)) {
      // Bundle exists without SKILL.md (e.g. kimi-vision): complete it in place.
      plans.push({ name, action: 'complete', candidate, target: join(dir, 'SKILL.md') })
      taken.set(name, content)
      continue
    }
    plans.push({ name, action: 'write', candidate, target: join(dir, 'SKILL.md'), renamed })
    taken.set(name, content)
  }
  return plans
}

/** Apply one plan. */
export function applySkillPlan(plan) {
  if (plan.action === 'skip') return false
  mkdirSync(plan.target.slice(0, plan.target.lastIndexOf('/')), { recursive: true })
  const named = plan.renamed ? { ...plan.candidate, name: plan.name } : plan.candidate
  writeFileSync(plan.target, `${skillFrontmatter(named)}${named.body}`)
  return true
}

/** Human-readable size of a file (KB/MB). */
export function fileSize(path) {
  try {
    const bytes = statSync(path).size
    return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
  } catch {
    return '?'
  }
}
