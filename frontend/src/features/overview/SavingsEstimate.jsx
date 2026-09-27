import { useState } from 'react'
import Icon from '../../ui/Icon'
import { resourceIcon } from '../../ui/resourceIcon'
import { ASSUMPTION_FIELDS, DEFAULT_ASSUMPTIONS, estimateSavings } from './savings'
import './SavingsEstimate.css'

const usd = (n, compact = true) => new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0}).format(n)
const ICONS = {mobilization: 'crane', yard: 'truck', row: 'road', substation: 'bolt'}
const show = (value, unit) => unit === '$' ? usd(value) : unit === '%' ? `${value}%` : `${value} ${unit}`

export default function SavingsEstimate({ opportunity, projects }) {
  const [assumptions, setAssumptions] = useState(DEFAULT_ASSUMPTIONS)
  const [enabled, setEnabled] = useState({})
  const [open, setOpen] = useState(false)
  const r = estimateSavings(opportunity, projects, assumptions, enabled)
  const max = Math.max(1, ...r.levers.map(l => l.amount))
  const changed = Object.keys(DEFAULT_ASSUMPTIONS).some(k => assumptions[k] !== DEFAULT_ASSUMPTIONS[k])

  return <section className="card savings-card">
    <header className="card-header"><div><h2>Estimated coordination savings</h2><p>A rough cost and land impact if these two projects coordinate. Every number comes from the assumptions below.</p></div>
      {r.illustrative && <span className="chip chip-warn" title="At least one budget is an illustrative demo value">Uses illustrative budget</span>}</header>
    <div className="savings-body">
      <div className="savings-summary">
        <span className="summary-label">Estimated savings</span>
        <strong className="summary-value">{r.total ? `${usd(r.low)} – ${usd(r.high)}` : '$0'}</strong>
        <span className="summary-sub">{r.percent != null && r.total ? `${r.percent.toFixed(1)}% of the ${usd(r.combined)} combined budget` : r.combined ? 'No lever applies with current settings' : 'Both budgets are needed for the crew estimate'}</span>
        <dl className="summary-facts">
          <div><dt><Icon name="ruler" size={14} />Distance</dt><dd>{r.miles.toFixed(1)} mi</dd></div>
          <div><dt><Icon name="calendar" size={14} />Timing</dt><dd>{r.schedule.label}</dd></div>
          <div><dt><Icon name="layers" size={14} />Land not disturbed</dt><dd>{r.acres ? `${r.acres.toFixed(1)} acres` : '—'}</dd></div>
          {r.potential > r.total && <div><dt><Icon name="bulb" size={14} />If schedules align</dt><dd>up to {usd(r.potential)}</dd></div>}
        </dl>
      </div>
      <ul className="levers">{r.levers.map(l => <li key={l.id} className={l.applies ? (l.on ? 'on' : 'off') : 'na'}>
        <label>
          <input type="checkbox" checked={l.on} disabled={!l.applies} onChange={e => setEnabled(s => ({...s, [l.id]: e.target.checked}))} />
          <span className="lever-icon"><Icon name={ICONS[l.id] || resourceIcon(l.title)} size={17} /></span>
          <span className="lever-text"><strong>{l.title}</strong><small>{l.reason}</small></span>
          <span className="lever-amount">{l.applies ? usd(l.realized) : 'n/a'}{l.applies && l.realized !== l.amount && l.on && <small>of {usd(l.amount)}</small>}</span>
        </label>
        {l.applies && <i className="lever-bar"><b style={{width: `${(l.realized / max) * 100}%`}} /><em style={{width: `${(l.amount / max) * 100}%`}} /></i>}
      </li>)}</ul>
    </div>
    <div className="assumptions">
      <button className="link-button" aria-expanded={open} onClick={() => setOpen(o => !o)}><Icon name={open ? 'close' : 'list'} size={14} />{open ? 'Hide assumptions' : 'Adjust assumptions'}</button>
      {changed && <button className="link-button" onClick={() => setAssumptions(DEFAULT_ASSUMPTIONS)}><Icon name="refresh" size={14} />Reset</button>}
      {open && <div className="assumption-grid">{ASSUMPTION_FIELDS.map(([key, label, unit, min, max, step]) => <label key={key}>
        <span>{label}<b>{show(assumptions[key], unit)}</b></span>
        <input type="range" min={min} max={max} step={step} value={assumptions[key]} onChange={e => setAssumptions(s => ({...s, [key]: Number(e.target.value)}))} />
      </label>)}</div>}
      <p>Planning-level estimate for screening, not an engineering or procurement quote. Range is ±30%. Crew, yard, and outage savings count fully only when construction windows overlap.</p>
    </div>
  </section>
}
