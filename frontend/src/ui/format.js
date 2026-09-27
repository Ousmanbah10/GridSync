// Display helpers shared by the map, coordination, consultation and project pages.
import { OWNER_COLORS } from '../features/overview/model.js'

// "Georgia Power Company" -> "GPC"; keeps an existing "(DESC)" acronym.
export function ownerShort(owner) {
  if (!owner) return 'Unknown'
  const acronym = owner.match(/\(([A-Z&]{2,8})\)/)
  if (acronym) return acronym[1]
  if (owner.length <= 14) return owner
  const words = owner.replace(/[(),.]/g, ' ').split(/\s+/).filter(w => /^[A-Z]/.test(w) && !['LLC', 'Inc', 'The', 'Of'].includes(w))
  return words.length >= 2 ? words.map(w => w[0]).join('').slice(0, 5) : owner.slice(0, 14)
}
export const initials = owner => (owner || '?').replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')

// Stable per-owner color, independent of which owners are on screen.
export function orgColor(owner) {
  let hash = 0
  for (const c of owner || '') hash = (hash * 31 + c.charCodeAt(0)) >>> 0
  return OWNER_COLORS[hash % OWNER_COLORS.length]
}

export const scoreClass = score => score >= 85 ? 'score-high' : score >= 75 ? 'score-mid' : 'score-low'

export function money(cost, compact = true) {
  const amount = Number(cost?.amount)
  if (cost?.amount == null || !Number.isFinite(amount)) return null
  try {
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: cost.currency || 'USD',
      notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0}).format(amount)
  } catch { return `${amount.toLocaleString()} ${cost.currency || ''}`.trim() }
}

const endpoint = value => typeof value === 'string' ? value : value?.name
export function routeLabel(p) {
  const [from, to] = [endpoint(p?.origin), endpoint(p?.destination)]
  return from && to ? `${from} → ${to}` : from || to || null
}
export function placeLabel(p) {
  return [routeLabel(p), (p?.state_codes || []).join(', ')].filter(Boolean).join(' · ') || 'Location not supplied'
}

export const year = value => value ? String(value).slice(0, 4) : null
export function scheduleLabel(p) {
  const [start, end] = [year(p?.construction?.start_date), year(p?.construction?.end_date)]
  if (start && end) return start === end ? start : `${start} – ${end}`
  return p?.in_service_year ? `In service ${p.in_service_year}` : 'Schedule not supplied'
}
export const hostname = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }

// "Illustrative" for demo placeholders; null for values that come from records or filings.
export const costTag = cost => cost?.basis === 'illustrative' ? 'Illustrative' : null

// Public company websites for utilities we know; everything else is looked up by the user.
const SITES = [[/dominion/i, 'https://www.dominionenergy.com'], [/georgia power/i, 'https://www.georgiapower.com']]
export const ownerSite = owner => SITES.find(([pattern]) => pattern.test(owner || ''))?.[1] || null
