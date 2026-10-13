import { describe, expect, test } from 'claude-code/testing'

import { ROW_HEIGHT, STATS_HEIGHT, fit, metaFor, rowsSvg, statsSvg, xml } from '../hooks/svg'
import type { AgentRow } from '../types'

const ROW: AgentRow = {
  agentId: 'a',
  runId: 'wf_1',
  index: 2,
  label: 'read:core',
  type: 'workflow-subagent',
  from: 'claude-opus-5-5',
  sent: 'claude-haiku-5-5',
  answered: 'claude-haiku-5-5',
  effort: 'medium',
  note: 'mod setting',
  status: 'done',
  startedAt: 0,
  endedAt: 8_000,
  tokens: 54_000,
}

describe('the banner', () => {
  test('says the exact numbers and each family’s share, in both themes', () => {
    const source = statsSvg({ agents: 3, tokens: { 'claude-haiku-5-5': 162_000, 'claude-opus-5-5': 18_000 } }, 400)
    expect(source).toStartWith('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="50"')
    expect(source).toContain('3 subagents · 180k tokens')
    expect(source).toContain('>Haiku</tspan><tspan class="m"> 90%</tspan>')
    expect(source).toContain('>Opus</tspan><tspan class="m"> 10%</tspan>')
    expect(source).toContain('class="bg-haiku"')
    expect(source).toContain('@media (prefers-color-scheme: dark)')
    expect(STATS_HEIGHT).toBe(50)
  })

  test('the cache share follows the numbers, when the pane has room for it', () => {
    const stats = { agents: 3, tokens: { 'claude-haiku-5-5': 279_093 }, cache: { read: 151_759, total: 279_093 } }
    expect(statsSvg(stats, 400)).toContain('3 subagents · 279k tokens<tspan class="m" font-size="12.5" font-weight="400"> · 54% from cache</tspan>')
    expect(statsSvg(stats, 260)).not.toContain('from cache')
  })

  test('before any subagent, an empty track and no share', () => {
    const source = statsSvg({ agents: 0, tokens: {} }, 300)
    expect(source).toContain('No subagents yet')
    expect(source).toContain('<rect class="k" x="0" y="41" width="300"')
    expect(source).not.toContain('<rect class="bg-')
  })
})

describe('the list', () => {
  test('a finished row: its mark, the model replaced, the model it ran on, its label and numbers', () => {
    const source = rowsSvg([ROW], 420)
    expect(source).toContain('class="ok"')
    expect(source).toContain('text-decoration="line-through">Opus</text>')
    expect(source).toContain('class="bg-haiku"')
    expect(source).toContain('font-weight="600">Haiku</text>')
    expect(source).toContain('<tspan class="t">read:core</tspan>')
    expect(source).toContain('medium · 8s · 54k tokens')
    expect(source).toContain(`height="${ROW_HEIGHT}"`)
  })

  test('a running row spins, unless motion is reduced', () => {
    const source = rowsSvg([{ ...ROW, status: 'running' }], 420)
    expect(source).toContain('class="run spin"')
    expect(source).toContain('running')
    expect(source).toContain('@media (prefers-reduced-motion: reduce){.spin{animation:none}}')
  })

  test('an ordinary subagent shows its type, and nothing struck when its original model is unknown', () => {
    const source = rowsSvg([{ ...ROW, index: 0, runId: '', label: 'Explore auth', type: 'Explore', from: 'claude-haiku-5-5' }], 420)
    expect(source).not.toContain('line-through')
    expect(source).toContain('<tspan class="m" font-size="11.5">  Explore</tspan>')
  })

  test('labels are escaped and cut to fit', () => {
    const source = rowsSvg([{ ...ROW, label: 'a <b> & "c"' }], 420)
    expect(source).toContain('a &lt;b&gt; &amp; &quot;c&quot;')
    expect(fit('abcdefghijklmnopqrstuvwxyz', 12.5, 70)).toBe('abcdefghi…')
    expect(fit('short', 12.5, 70)).toBe('short')
    expect(xml(`<'&'>`)).toBe('&lt;&apos;&amp;&apos;&gt;')
  })

  test('on a narrow pane the numbers give way to the label: the effort first, then the tokens', () => {
    expect(metaFor(ROW, 80, 460).meta).toBe('medium · 8s · 54k tokens')
    expect(metaFor(ROW, 80, 300).meta).toBe('8s · 54k tokens')
    expect(metaFor(ROW, 80, 240).meta).toBe('8s')
    expect(metaFor(ROW, 80, 240).room).toBeGreaterThan(100)
  })

  test('several rows stack, with a line between them', () => {
    const source = rowsSvg([ROW, { ...ROW, agentId: 'b', status: 'failed' }], 420)
    expect(source).toContain(`height="${2 * ROW_HEIGHT}"`)
    expect(source).toContain('class="ko"')
    expect(source.match(/<line /g)).toHaveLength(1)
  })
})
