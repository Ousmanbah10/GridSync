import { useState } from 'react'
import Icon from '../../ui/Icon'
import { resourceIcon } from '../../ui/resourceIcon'
import { costTag, initials, money, ownerShort, placeLabel, scheduleLabel } from '../../ui/format'
import { basisLabel, delayLabel, distanceLabel, miles, overlapLabel, byProximity, scheduleTag, timelineSummary, PAIR_COLORS } from './model'
import CoordinationPlan from './CoordinationPlan'
import './CoordinationPanel.css'

const displayDate = value => value ? String(value).slice(0, 10) : null
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1)

export default function CoordinationPanel({ data, loading, opportunities, selectedId, onSelect, onMap, onAnalyze, onOpenProject }) {
  const [anchor, setAnchor] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(null)
  const [limit, setLimit] = useState(30)
  const byId = new Map(data?.projects.map(p => [p.project_record_id, p]) || [])
  const rows = opportunities.filter(o => (!anchor || o.project_record_ids.includes(anchor)) &&
    [...(o.project_names || []), ...(o.owners || [])].join(' ').toLowerCase().includes(search.toLowerCase()))
    .sort(byProximity)
  const active = rows.find(o => o.id === selectedId) || rows[0]
  const schedule = timelineSummary(active)
  const projects = active?.project_record_ids.map(id => byId.get(id)) || []
  function choose(id) { onSelect(id); setDraft(null) }
  function changeAnchor(value) { setAnchor(value); setLimit(30); setDraft(null); onSelect(null) }
  const actions = active?.shared_resources?.map(r => r.resource) || []
  const shared = active?.shared_substations?.length > 0

  return <section className="coordination">
    <aside className="card candidates">
      <div className="candidates-controls">
        <span className="search-box"><Icon name="search" size={14} /><input className="control" aria-label="Search opportunities" placeholder="Search opportunities…" value={search} onChange={e => {setSearch(e.target.value); setLimit(30); setDraft(null)}} /></span>
        <select className="control" aria-label="Compare a project" value={anchor} onChange={e => changeAnchor(e.target.value)}><option value="">All projects</option>{data?.projects.map(p => <option value={p.project_record_id} key={p.project_record_id}>{p.project_name}</option>)}</select>
      </div>
      <div className="candidates-count">{loading ? 'Loading…' : `${rows.length.toLocaleString()} cross-utility pairs`}</div>
      <div className="candidates-list" role="listbox" aria-label="Coordination candidates">{rows.slice(0, limit).map((o, index) =>
        <button key={o.id} role="option" aria-selected={active?.id === o.id} className="candidate" onClick={() => choose(o.id)}>
          <span className={`candidate-rank ${index === 0 ? 'top' : ''}`}>{index + 1}</span>
          <div className="candidate-body">
            <div className="candidate-title"><strong>{o.project_names?.join(' – ')}</strong></div>
            <small className="candidate-owners">{ownerShort(o.owners?.[0])} <Icon name="link" size={12} /> {ownerShort(o.owners?.[1])}</small>
            <small>{distanceLabel(o)} · {overlapLabel(o)}</small>
            {o.project_record_ids.some(id => byId.get(id)?.schedule_flag?.kind === 'delayed') && <small className="risk-note"><Icon name="alert" size={12} />Schedule risk: a project was delayed in its latest filing</small>}
            {o.project_record_ids.some(id => byId.get(id)?.project_type) && <div className="candidate-tags">{o.project_record_ids.map(id => byId.get(id)?.project_type && <span key={id}>{byId.get(id).project_type.split(';')[0]}</span>)}</div>}
          </div>
        </button>)}
        {!loading && !rows.length && <p className="empty"><strong>No eligible pairs</strong>Choose another project or clear the filters.</p>}
        {rows.length > limit && <button className="btn btn-sm load-more" onClick={() => setLimit(n => n + 30)}>Show 30 more</button>}
      </div>
    </aside>

    <div className="comparison">{active ? <>
      <header className="comparison-header">
        <div>
          <div className="comparison-title"><h2>{active.project_names?.join(' – ')}</h2></div>
        </div>
        <div className="comparison-actions">
          <button className="btn btn-primary" onClick={() => setDraft('plan')}><Icon name="mail" size={15} />Contact & Invite</button>
        </div>
      </header>

      {draft && <CoordinationPlan opportunity={active} projects={projects} onClose={() => setDraft(null)} />}

      <div className="pair-compare">
        {projects.map((p, index) => p && <article className="card project-card" key={p.project_record_id} style={{'--pair': PAIR_COLORS[index]}}>
          <header><span className="org-mark" style={{background: PAIR_COLORS[index]}}>{initials(p.owner)}</span><strong>{p.owner || 'Owner not available'}</strong></header>
          <h3>{p.project_name}</h3>
          {p.schedule_flag && <span className={`chip delay-chip ${p.schedule_flag.kind}`} title={`${p.schedule_flag.text} (vs. ${p.schedule_flag.compared_to}, per the utility filing)`}><Icon name="alert" size={13} />{delayLabel(p.schedule_flag)}</span>}
          <ul>
            <li><Icon name="line" size={15} />{[p.project_type, p.voltage_max_kv && `${p.voltage_max_kv} kV`, p.status || p.document_status].filter(Boolean).join(' · ') || 'Work type not supplied'}</li>
            <li><Icon name="calendar" size={15} />{p.construction?.start_date ? `${displayDate(p.construction.start_date)} → ${displayDate(p.construction.end_date) || '?'}${scheduleTag(p.construction)}` : scheduleLabel(p)}</li>
            <li><Icon name="pin" size={15} />{placeLabel(p)}</li>
            <li><Icon name="chart" size={15} />{money(p.project_cost) ? `${money(p.project_cost)} estimated cost` : p.project_cost_note ? 'Cost redacted in public filing' : 'Cost not published'}{costTag(p.project_cost) && <span className="chip chip-warn cost-tag" title={p.project_cost.note}>{costTag(p.project_cost)}</span>}</li>
          </ul>
          <button className="btn btn-sm btn-outline" onClick={() => onOpenProject(p.project_record_id)}>View Project<Icon name="arrowRight" size={13} /></button>
        </article>)}
        <div className="pair-link"><Icon name="arrowLeft" size={14} /><strong className="num">{shared ? 'Shared' : miles(active.distance_km)}</strong><Icon name="arrowRight" size={14} /></div>
      </div>

      <div className="metric-row">
        <article className="card metric"><span className="metric-icon"><Icon name="pin" size={22} /></span><div><h3>Geographic Overlap</h3><strong className="num">{shared ? active.shared_substations.join(', ') : miles(active.distance_km)}</strong><p>{shared ? basisLabel(active) : `Within the 25-mile rule · ${active.distance_basis === 'approximate_corridor' ? 'approximate corridor' : 'mapped points'}`}</p><button className="link-button" onClick={() => onMap(active.id)}>Show on map<Icon name="arrowRight" size={13} /></button></div></article>
        <article className="card metric"><span className="metric-icon violet"><Icon name="calendar" size={22} /></span><div><h3>{schedule.title}</h3><strong>{overlapLabel(active)}</strong><p>{schedule.detail}</p></div></article>
      </div>

      <section className="card">
        <header className="card-header"><div><h2>Potential Shared Resources</h2><p>Based on the distance band. Each needs engineering and ownership review.</p></div><button className="btn btn-sm" onClick={() => onAnalyze(active.id)}><Icon name="chat" size={14} />AI analysis</button></header>
        <ul className="resources">{actions.map(resource => <li key={resource}><span><Icon name={resourceIcon(resource)} size={26} /></span>{capitalize(resource)}</li>)}{!actions.length && <li className="muted">None identified for this pair.</li>}</ul>
      </section>

      <section className="card">
        <header className="card-header"><div><h2>Schedules</h2><p>Construction windows where supplied, and in-service targets</p></div></header>
        <Timeline projects={projects} timeline={active.timeline} />
      </section>

      <p className="comparison-footnote">{active.qualification} {active.score_breakdown?.notes?.join(' ')} Eligible because the recorded utilities differ after alias grouping.{active.segment_pairs > 1 ? ` Best of ${active.segment_pairs} segment/route-option pairs for these two projects.` : ''}</p>
    </> : <div className="card empty">{loading ? <><span className="spinner" /> Loading opportunities…</> : <><strong>Select an eligible project pair</strong>Change the project selector or filters to find comparisons.</>}</div>}</div>
  </section>
}

const yearStart = y => Date.UTC(y, 0, 1)
const parse = value => { const t = value ? Date.parse(String(value).slice(0, 10)) : NaN; return Number.isFinite(t) ? t : null }
const validYear = y => Number.isInteger(y) && y >= 1900 && y <= 2200

// Shared year axis for both projects. Missing data is shown as missing, never guessed.
function Timeline({ projects, timeline }) {
  const rows = projects.map(p => ({ start: parse(p?.construction?.start_date), end: parse(p?.construction?.end_date), service: parse(p?.in_service_date) || (validYear(p?.in_service_year) ? yearStart(p.in_service_year) : null), serviceLabel: p?.in_service_date ? String(p.in_service_date).slice(0, 10) : p?.in_service_year, estimated: ['annual_spending_schedule', 'illustrative'].includes(p?.construction?.basis), illustrative: p?.construction?.basis === 'illustrative' }))
  const years = rows.flatMap(r => [r.start, r.end, r.service].filter(Boolean).map(t => new Date(t).getUTCFullYear()))
  if (!years.length) return <p className="empty">Neither project supplies construction dates or an in-service year.</p>
  let first = Math.min(...years), last = Math.max(...years) + 1
  if (last - first < 4) { first -= Math.floor((4 - (last - first)) / 2); last = first + 4 }
  const span = yearStart(last) - yearStart(first)
  const at = t => `${((t - yearStart(first)) / span) * 100}%`
  const overlap = timeline?.overlap && parse(timeline.start_date) && parse(timeline.end_date)
  const ticks = Array.from({length: last - first + 1}, (_, i) => first + i)
  return <div className="timeline">
    <div className="timeline-axis">{ticks.map(y => <span key={y} style={{left: at(yearStart(y))}}>{y}</span>)}</div>
    {rows.map((r, index) => <div className="timeline-row" key={index}>
      <div className="timeline-label"><i className="dot" style={{background: PAIR_COLORS[index]}} /><span title={projects[index]?.project_name}>{projects[index]?.project_name}</span></div>
      <div className="timeline-track">
        {ticks.map(y => <i key={y} className="timeline-grid" style={{left: at(yearStart(y))}} />)}
        {overlap && <b className="timeline-overlap" style={{left: at(parse(timeline.start_date)), width: `calc(${at(parse(timeline.end_date))} - ${at(parse(timeline.start_date))})`}} />}
        {r.start && r.end && <b className={`timeline-bar ${r.estimated ? 'estimated' : ''}`} title={r.illustrative ? 'Illustrative demo schedule' : r.estimated ? 'Estimated from the published spending schedule' : 'Documented project dates'} style={{left: at(r.start), width: `calc(${at(r.end)} - ${at(r.start)})`, '--bar': PAIR_COLORS[index]}} />}
        {r.service && <span className="timeline-service" style={{left: at(r.service), '--pair': PAIR_COLORS[index]}} title={`In service ${r.serviceLabel}`}><em>{String(r.serviceLabel).slice(0, 7)}</em></span>}
      </div>
    </div>)}
    <div className="timeline-legend"><span><b className="timeline-bar-key" />Construction{rows.some(r => r.start && r.end) ? '' : ' (not supplied)'}</span><span><i className="timeline-service-key" />In-service target</span>{rows.some(r => r.estimated) && <span><b className="timeline-bar-key estimated" />{rows.some(r => r.illustrative) ? 'Illustrative demo schedule' : 'Estimated from spending schedule'}</span>}{overlap && <span><b className="timeline-overlap-key" />Overlap · {timeline.overlap_days} days</span>}</div>
  </div>
}
