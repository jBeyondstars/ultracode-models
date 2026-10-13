// Drawings for the surfaces that take an Svg (desktop, VS Code, mobile): one
// banner for the session's numbers, one list for the recent subagents. They
// follow the surface's light or dark scheme; a running subagent's mark spins.
import type { AgentRow, Stats } from '../types'
import { WORKFLOW_AGENT_TYPE, cacheShare, formatTokens, modelKey, originalModel, priceText, rowLabel, rowMeta, shares, shortModel, shownModel, statsTotal } from './logic'

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"

const CSS = `<style>
.t{fill:#1f1e1d}.m{fill:#73726c}.k{fill:#e8e6dc}.l{stroke:#e8e6dc}
.haiku{fill:#0F6E56}.sonnet{fill:#534AB7}.opus{fill:#993C1D}.fable{fill:#993556}.other{fill:#5F5E5A}
.bg-haiku{fill:#1D9E75}.bg-sonnet{fill:#7F77DD}.bg-opus{fill:#D85A30}.bg-fable{fill:#D4537E}.bg-other{fill:#888780}
.ok{stroke:#3B6D11}.ko{stroke:#A32D2D}.run{stroke:#185FA5}.stop{fill:#888780}
@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#a3a29b}.k{fill:#2c2c2a}.l{stroke:#333331}
.haiku{fill:#5DCAA5}.sonnet{fill:#AFA9EC}.opus{fill:#F0997B}.fable{fill:#ED93B1}.other{fill:#B4B2A9}
.ok{stroke:#97C459}.ko{stroke:#F09595}.run{stroke:#85B7EB}}
.spin{transform-box:fill-box;transform-origin:center;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.spin{animation:none}}
</style>`

export const STATS_HEIGHT = 50
export const ROW_HEIGHT = 28

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }

export function xml(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char] ?? char)
}

/** About how wide a text is drawn, in px: the UI font's average glyph is a little over half its size. */
export function textWidth(text: string, size: number): number {
  return text.length * size * 0.56
}

/** The text cut to fit `width` px, with an ellipsis when cut. */
export function fit(text: string, size: number, width: number): string {
  if (textWidth(text, size) <= width) return text
  // The epsilon keeps a width that is an exact multiple of the glyph width from losing one to rounding.
  const room = Math.floor(width / (size * 0.56) + 1e-9) - 1
  return room <= 0 ? '' : `${text.slice(0, room).trimEnd()}…`
}

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${CSS}${body}</svg>`
}

/** The banner: how many subagents ran this session, the tokens they used, and each model's share. */
export function statsSvg(stats: Stats, width: number): string {
  const total = statsTotal(stats)
  const split = shares(stats)
  const legend = split
    .map(one => `<tspan class="${one.key}" font-weight="600">${xml(one.label)}</tspan><tspan class="m"> ${one.percent}%</tspan>`)
    .join('<tspan class="m">  ·  </tspan>')
  const head = `<text class="m" x="0" y="13" font-family="${FONT}" font-size="11.5">This session</text>`
    + (legend === '' ? '' : `<text x="${width}" y="13" text-anchor="end" font-family="${FONT}" font-size="11.5">${legend}</text>`)
  const agents = stats.agents === 0 ? 'No subagents yet' : `${stats.agents} subagent${stats.agents > 1 ? 's' : ''}`
  const tokens = total > 0 ? `${agents} · ${formatTokens(total)} tokens` : agents
  // The estimated price joins them when it fits whole: a price cut short would mislead.
  const price = total > 0 ? priceText(stats) : undefined
  const priced = price === undefined ? undefined : `${tokens} · ${price}`
  const numbers = priced !== undefined && textWidth(priced, 15) <= width - 4 ? priced : tokens
  // The cache's share follows the numbers, lighter, when the pane has room for it.
  const cached = total > 0 ? cacheShare(stats) : undefined
  const extra = cached === undefined ? '' : ` · ${cached}% from cache`
  const hasRoom = extra !== '' && textWidth(numbers, 15) + textWidth(extra, 12.5) <= width - 8
  const after = hasRoom ? `<tspan class="m" font-size="12.5" font-weight="400">${xml(extra)}</tspan>` : ''
  const line = `<text class="t" x="0" y="33" font-family="${FONT}" font-size="15" font-weight="600">${xml(fit(numbers, 15, width))}${after}</text>`

  let bar = `<rect class="k" x="0" y="41" width="${width}" height="6" rx="3"/>`
  if (total > 0) {
    let x = 0
    const gap = split.length > 1 ? 2 : 0
    const room = width - gap * (split.length - 1)
    bar = split
      .map((one, index) => {
        const isLast = index === split.length - 1
        const w = isLast ? width - x : Math.max(3, Math.round((one.tokens / total) * room))
        const rect = `<rect class="bg-${one.key}" x="${x}" y="41" width="${Math.max(0, w)}" height="6" rx="3"/>`
        x += w + gap
        return rect
      })
      .join('')
  }
  return svg(width, STATS_HEIGHT, head + line + bar)
}

function mark(row: AgentRow, cx: number, cy: number): string {
  if (row.status === 'running') {
    return `<circle class="run spin" cx="${cx}" cy="${cy}" r="5.5" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-dasharray="22 13"/>`
  }
  if (row.status === 'done') {
    return `<path class="ok" d="M${cx - 4.5} ${cy} l3 3 l6 -6.5" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  if (row.status === 'failed') {
    return `<path class="ko" d="M${cx - 4} ${cy - 4} l8 8 M${cx + 4} ${cy - 4} l-8 8" fill="none" stroke-width="1.8" stroke-linecap="round"/>`
  }
  return `<rect class="stop" x="${cx - 3.5}" y="${cy - 3.5}" width="7" height="7" rx="1.5"/>`
}

/** The label keeps at least this much room (px), or all of its own width when shorter. */
const LABEL_ROOM = 110

/**
 * A row's right-hand numbers, as many as leave its label room: on a narrow
 * pane the effort goes first, then the tokens, then everything.
 */
export function metaFor(row: AgentRow, x: number, width: number): { meta: string; room: number } {
  const all = rowMeta(row)
  const effortless = row.effort === undefined ? all : all.slice(1)
  const options = [all, effortless, effortless.filter(part => !part.endsWith('tokens')), []]
  const wanted = Math.min(LABEL_ROOM, textWidth(rowLabel(row), 12.5))
  for (const parts of options) {
    const meta = parts.join(' · ')
    const room = width - 4 - (meta === '' ? 0 : textWidth(meta, 11.5) + 10) - x
    if (room >= wanted || parts.length === 0) return { meta, room: Math.max(0, room) }
  }
  return { meta: '', room: Math.max(0, width - 4 - x) }
}

/** The recent subagents, newest first: a mark, the model it ran on, its label, then its effort and numbers. */
export function rowsSvg(rows: readonly AgentRow[], width: number): string {
  const body = rows
    .map((row, index) => {
      const top = index * ROW_HEIGHT
      const base = top + 18
      let x = 26
      let parts = mark(row, 12, top + 14)

      const original = originalModel(row)
      if (original !== undefined) {
        const name = shortModel(original)
        parts += `<text class="m" x="${x}" y="${base}" font-family="${FONT}" font-size="11.5" text-decoration="line-through">${xml(name)}</text>`
        x += textWidth(name, 11.5) + 6
      }

      const shown = shownModel(row)
      const key = modelKey(shown)
      const chip = fit(shortModel(shown), 12, 110)
      const chipWidth = Math.round(textWidth(chip, 12) + 14)
      parts += `<rect class="bg-${key}" x="${x}" y="${top + 6}" width="${chipWidth}" height="16" rx="5" fill-opacity="0.16"/>`
      parts += `<text class="${key}" x="${x + 7}" y="${base - 0.5}" font-family="${FONT}" font-size="12" font-weight="600">${xml(chip)}</text>`
      x += chipWidth + 8

      const { meta, room } = metaFor(row, x, width)
      if (meta !== '') {
        parts += `<text class="m" x="${width - 4}" y="${base}" text-anchor="end" font-family="${FONT}" font-size="11.5">${xml(meta)}</text>`
      }

      const label = fit(rowLabel(row), 12.5, room)
      const type = row.type !== WORKFLOW_AGENT_TYPE && rowLabel(row) !== row.type ? `  ${row.type}` : ''
      const typeRoom = room - textWidth(label, 12.5)
      const typeText = type !== '' && label === rowLabel(row) && textWidth(type, 11.5) <= typeRoom ? type : ''
      parts += `<text x="${x}" y="${base}" font-family="${FONT}" font-size="12.5"><tspan class="t">${xml(label)}</tspan>${typeText === '' ? '' : `<tspan class="m" font-size="11.5">${xml(typeText)}</tspan>`}</text>`

      if (index < rows.length - 1) {
        parts += `<line class="l" x1="0" y1="${top + ROW_HEIGHT - 0.5}" x2="${width}" y2="${top + ROW_HEIGHT - 0.5}" stroke-width="1"/>`
      }
      return parts
    })
    .join('')
  return svg(width, Math.max(ROW_HEIGHT, rows.length * ROW_HEIGHT), body)
}
