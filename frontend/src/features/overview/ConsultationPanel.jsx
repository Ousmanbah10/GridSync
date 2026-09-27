import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { resourceIcon } from '../../ui/resourceIcon'
import { costTag, initials, money, ownerShort, placeLabel, scheduleLabel } from '../../ui/format'
import { byProximity, delayLabel, distanceLabel, bandName, overlapLabel, PAIR_COLORS } from './model'
import SavingsEstimate from './SavingsEstimate'
import { estimateSavings } from './savings'
import './ConsultationPanel.css'

const TABS = [['summary', 'Executive Summary'], ['resources', 'Resource Opportunities'], ['risks', 'Risks & Considerations'], ['steps', 'Recommended Next Steps']]

export default function ConsultationPanel({ data, loading, opportunities, selectedId, onOpenProject, onBack }) {
  const ranked = [...opportunities].sort(byProximity)
  const active = ranked.find(o => o.id === selectedId) || ranked[0]
  const byId = new Map(data?.projects.map(p => [p.project_record_id, p]) || [])
  const projects = active?.project_record_ids.map(id => byId.get(id)).filter(Boolean) || []
  const [state, setState] = useState({ id: null, analysis: null, csrf: '', configured: true, error: '', busy: false })
  const [tab, setTab] = useState('summary')
  const activeId = active?.id

  useEffect(() => {
    if (!activeId) return
    const abort = new AbortController()
    fetch(`/api/opportunities/${activeId}/analysis/`, { signal: abort.signal })
      .then(async r => { const body = await r.json().catch(() => ({})); if (!r.ok) throw new Error(body.error || 'The saved analysis could not be loaded.'); return body })
      .then(body => setState({ id: activeId, analysis: body.analysis, csrf: body.csrf_token, configured: body.ai_configured, error: '', busy: false }))
      .catch(err => { if (err.name !== 'AbortError') setState(s => ({ ...s, id: activeId, analysis: null, error: err.message, busy: false })) })
    return () => abort.abort()
  }, [activeId])

  async function generate() {
    setState(s => ({ ...s, busy: true, error: '' }))
    try {
      const est = estimateSavings(active, projects)
      const savings = est.total ? {low: est.low, high: est.high, percent: est.percent, acres: est.acres, miles: est.miles, schedule: est.schedule.label,
        levers: est.levers.filter(l => l.on).map(l => ({title: l.title, amount: l.realized}))} : null
      const r = await fetch(`/api/opportunities/${activeId}/analysis/`, { method: 'POST', headers: { 'X-CSRFToken': state.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({savings}) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(body.error || 'The analysis could not be generated. Please retry.')
      setState(s => ({ ...s, analysis: body.analysis, busy: false })); setTab('summary')
    } catch (err) { setState(s => ({ ...s, busy: false, error: err.message })) }
  }

  if (!active) return <div className="card empty">{loading ? <><span className="spinner" /> Loading coordination candidates…</> : <><strong>No coordination candidates in view</strong>Clear the map filters to choose a pair.</>}</div>
  const analysis = state.id === activeId ? state.analysis : null
  const pending = state.id !== activeId
  const costs = projects.map(p => ({ p, label: money(p.project_cost), amount: Number(p.project_cost?.amount) }))
  const priced = costs.filter(c => c.label && Number.isFinite(c.amount))
  const maxCost = Math.max(1, ...priced.map(c => c.amount))

  return <div className="consultation">
    <div className="consult-toolbar no-print">
      {onBack && <button className="btn btn-ghost back-to" onClick={onBack}><Icon name="arrowLeft" size={15} />Back to coordination</button>}
      <div className="consult-actions">
        <button className="btn" onClick={() => window.print()} disabled={!analysis}><Icon name="download" size={15} />Export Report</button>
      </div>
    </div>
    {!state.configured && <div className="notice notice-info">Add a Gemini API key and model to backend/.env to generate analyses. Screening facts below still come from your data.</div>}
    {state.error && <div className="notice notice-error" role="alert">{state.error}</div>}

    <div className="consult-grid">
      <section className="card">
        <header className="card-header"><div><h2>Selected Projects</h2><p>{distanceLabel(active)} · {overlapLabel(active)}</p></div><div className="consult-chips"><span className="chip chip-signal">{bandName(active.band)}</span></div></header>
        <div className="selected-body">
          <ul className="selected-projects">{projects.map((p, index) => <li key={p.project_record_id}>
            <span className="org-mark" style={{background: PAIR_COLORS[index]}}>{initials(p.owner)}</span>
            <div>
              <small style={{color: PAIR_COLORS[index]}}>{p.owner || 'Owner not available'}</small>
              <button className="link-plain" onClick={() => onOpenProject(p.project_record_id)}><strong>{p.project_name}</strong></button>
              <p><Icon name="line" size={13} />{[p.project_type, p.voltage_max_kv && `${p.voltage_max_kv} kV`, p.status || p.document_status].filter(Boolean).join(' · ') || 'Work type not supplied'}</p>
              <p><Icon name="calendar" size={13} />{scheduleLabel(p)}</p>
              {p.schedule_flag && <p className="delay-line"><Icon name="alert" size={13} />{delayLabel(p.schedule_flag)} (per filing)</p>}
              <p><Icon name="pin" size={13} />{placeLabel(p)}</p>
              <p><Icon name="chart" size={13} />{money(p.project_cost) ? `Est. cost ${money(p.project_cost)} (${costTag(p.project_cost) ? 'illustrative' : 'published'})` : p.project_cost_note ? 'Cost redacted in public filing' : 'Cost not published'}</p>
            </div>
          </li>)}</ul>
          <PairSketch opportunity={active} />
        </div>
      </section>

      <section className="card">
        <header className="card-header"><div><h2>Budget Comparison</h2><p>Published project costs from the source records</p></div></header>
        <div className="card-body budget">
          {priced.length ? <div className="bars">{costs.map(({p, label, amount}, index) => <div className="bar-col" key={p.project_record_id}>
            <span className="bar-value">{label || (p.project_cost_note ? 'Redacted' : 'n/a')}</span>{costTag(p.project_cost) && <span className="chip chip-warn bar-tag" title={p.project_cost.note}>{costTag(p.project_cost)}</span>}
            <div className="bar-track">{label ? <b style={{height: `${Math.max(4, (amount / maxCost) * 100)}%`, background: PAIR_COLORS[index]}} /> : <b className="bar-missing" />}</div>
            <small>{ownerShort(p.owner)}</small>
          </div>)}</div> : <div className="budget-empty"><Icon name="chart" size={28} /><strong>No published costs for this pair</strong><p>Neither source record includes a project budget, so savings can't be estimated from data yet. Use research on each project page to look for filed cost estimates.</p></div>}
          <div className="savings">
            <h3>Combined budget</h3>
            {priced.length === 2 ? <strong className="num">{money({amount: priced[0].amount + priced[1].amount, currency: priced[0].p.project_cost.currency})}</strong> : <strong className="muted-strong">Not available</strong>}
            <p>{priced.length === 2 ? `${priced.some(c => costTag(c.p.project_cost)) ? 'Includes an illustrative budget. ' : ''}See the savings estimate below.` : 'Both budgets are needed to compare.'}</p>
          </div>
        </div>
      </section>
    </div>

    <SavingsEstimate key={active.id} opportunity={active} projects={projects} />

    <section className="card analysis">
      <header className="card-header"><div><h2>AI Analysis</h2><p>{analysis ? `Generated ${new Date(analysis.created_at).toLocaleString()} · ${analysis.model} · grounded only in the saved records` : 'Grounded in the saved records and screening facts only; no web search.'}</p></div></header>
      {pending ? <p className="empty"><span className="spinner" /> Loading saved analysis…</p> : !analysis ? <div className="analysis-empty">
        <span className="analysis-empty-icon"><Icon name="chat" size={26} /></span>
        <div><strong>No analysis for this pair yet</strong><p>Generate a brief covering shared resources, risks, and next steps for {active.owners?.join(' and ')}.</p></div>
        <button className="btn btn-primary" onClick={generate} disabled={state.busy || !state.configured}>{state.busy ? 'Analyzing…' : 'Generate analysis'}</button>
      </div> : <>
        <div className="tabs no-print" role="tablist">{TABS.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="analysis-grid">
          <div className="analysis-main">
            {(tab === 'summary') && <>
              <div className="summary-head"><span className="ai-badge">AI</span><div><h3>Executive Summary</h3><p>{analysis.executive_summary}</p></div></div>
              {analysis.key_insights.length > 0 && <div className="insights"><h4><Icon name="bulb" size={16} />Key insights</h4><ul>{analysis.key_insights.map((item, i) => <li key={i}>{item}</li>)}</ul></div>}
            </>}
            {tab === 'resources' && <ul className="resource-list">{analysis.resource_opportunities.map((r, i) => <li key={i}><span><Icon name={resourceIcon(r.resource)} size={20} /></span><div><strong>{r.resource}</strong><p>{r.rationale}</p></div></li>)}{!analysis.resource_opportunities.length && <li className="muted">None identified.</li>}</ul>}
            {tab === 'risks' && <ul className="plain-list risk">{analysis.risks.map((item, i) => <li key={i}><Icon name="alert" size={16} />{item}</li>)}{!analysis.risks.length && <li className="muted">None identified.</li>}</ul>}
            {tab === 'steps' && <ol className="steps-list">{analysis.next_steps.map((item, i) => <li key={i}><span>{i + 1}</span>{item}</li>)}</ol>}
          </div>
          <aside className="recommendation">
            <h3>Recommendation</h3>
            <ul>{analysis.recommendation.map((item, i) => <li key={i}><Icon name="check" size={15} />{item}</li>)}</ul>
            <p>{bandName(active.band)} · {distanceLabel(active)}. AI output is a planning aid; verify with both utilities.</p>
          </aside>
        </div>
        <div className="print-only">{TABS.slice(1).map(([id, label]) => <section key={id}><h3>{label}</h3><ul>{(id === 'resources' ? analysis.resource_opportunities.map(r => `${r.resource}: ${r.rationale}`) : id === 'risks' ? analysis.risks : analysis.next_steps).map((item, i) => <li key={i}>{item}</li>)}</ul></section>)}</div>
      </>}
    </section>
  </div>
}

// Relative position of the two closest mapped points, not to geographic scale beyond the pair.
function PairSketch({ opportunity }) {
  const points = opportunity.closest_substation_coordinates
  if (!points || points.length !== 2) return null
  const [w, h, pad] = [220, 150, 34]
  const lngs = points.map(p => p[0]), lats = points.map(p => p[1])
  const span = Math.max(Math.max(...lngs) - Math.min(...lngs), Math.max(...lats) - Math.min(...lats), 1e-4)
  const cx = (Math.max(...lngs) + Math.min(...lngs)) / 2, cy = (Math.max(...lats) + Math.min(...lats)) / 2
  const xy = ([lng, lat]) => [w / 2 + ((lng - cx) / span) * (w - pad * 2), h / 2 - ((lat - cy) / span) * (h - pad * 2)]
  const [a, b] = points.map(xy)
  const same = Math.hypot(a[0] - b[0], a[1] - b[1]) < 2
  return <figure className="pair-sketch" aria-label={`Relative location of the two projects: ${distanceLabel(opportunity)}`}>
    <svg viewBox={`0 0 ${w} ${h}`} role="img">
      <defs><pattern id="sketch-grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M22 0H0V22" fill="none" stroke="#e4e9f0" strokeWidth="1" /></pattern></defs>
      <rect width={w} height={h} fill="url(#sketch-grid)" />
      <circle cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} r={same ? 26 : Math.min(58, Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 + 16)} fill="rgb(224 65 58 / 8%)" stroke="#e0413a" strokeDasharray="4 4" />
      {!same && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#e0413a" strokeWidth="2" strokeDasharray="2 5" strokeLinecap="round" />}
      <circle cx={a[0]} cy={a[1]} r={same ? 9 : 7} fill={PAIR_COLORS[0]} stroke="#fff" strokeWidth="2" />
      <circle cx={b[0]} cy={b[1]} r={same ? 5 : 7} fill={PAIR_COLORS[1]} stroke="#fff" strokeWidth="2" />
    </svg>
    <figcaption>{distanceLabel(opportunity)}</figcaption>
  </figure>
}
