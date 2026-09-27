import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { costTag, initials, money, routeLabel, scoreClass } from '../../ui/format'
import { request, sourceUrl } from './api'
import { bandName, PAIR_COLORS } from '../overview/model'
import './ProjectsPage.css'

const EVIDENCE_LABELS = {project_cost: 'Estimated cost', construction: 'Construction window', in_service_date: 'In-service date'}
const date = value => value ? String(value).slice(0, 10) : null
const longDate = value => value ? new Date(String(value).slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : null
const parse = value => { const t = value ? Date.parse(String(value).slice(0, 10)) : NaN; return Number.isFinite(t) ? t : null }
const months = (a, b) => Math.max(1, Math.round((b - a) / (30.44 * 864e5)))

export default function ProjectDetail({ projectId, onBack, onOpenProject }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    request(`/api/projects/${projectId}/`, {signal: controller.signal})
      .then(setData)
      .catch(err => {if (err.name !== 'AbortError') setError(err.message)})
    return () => controller.abort()
  }, [projectId, retry])
  const project = data?.project
  const related = data?.related_opportunities || []
  const links = project?.source_urls?.filter(sourceUrl) || []
  const start = parse(project?.construction?.start_date), end = parse(project?.construction?.end_date)
  const service = parse(project?.in_service_date) || (project?.in_service_year ? Date.UTC(project.in_service_year, 0, 1) : null)
  const status = project?.status || project?.document_status

  return <div className="project-detail">
    <button className="btn btn-ghost btn-sm back-link" onClick={onBack}><Icon name="arrowLeft" size={14} />Project library</button>
    {error && <div className="notice notice-error" role="alert">{error}<button className="btn btn-sm" onClick={() => {setError(''); setRetry(n => n + 1)}}>Retry</button></div>}
    {!project && !error && <p className="empty"><span className="spinner" /> Loading project…</p>}
    {project && <>
      <header className="project-hero">
        <div>
          <span className="hero-eyebrow">{project.record_id} · {project.owner || 'Owner unknown'}</span>
          <h1>{project.project_name}</h1>
          <p>{routeLabel(project) || 'Endpoints not supplied'} · {project.states?.join(', ') || project.state_codes?.join(', ') || 'State unknown'}</p>
          <div className="hero-chips">
            {status && <span className="chip chip-ok">{status}</span>}
            {project.voltage_max_kv && <span className="chip">{project.voltage_max_kv} kV</span>}
            {project.project_type && <span className="chip">{project.project_type}</span>}
            {related.length > 0 && <span className="chip chip-signal">{related.length} coordination {related.length === 1 ? 'pair' : 'pairs'}</span>}
          </div>
        </div>
        {links[0] && <a className="btn btn-on-dark" href={links[0]} target="_blank" rel="noreferrer">Source document<Icon name="external" size={14} /></a>}
      </header>

      <section className="detail-kpis">
        <div><span><Icon name="chart" size={16} />Estimated cost</span><strong>{money(project.project_cost) || (project.project_cost_note ? 'Redacted' : '—')}</strong>
          <small>{costTag(project.project_cost) ? <span className="chip chip-warn" title={project.project_cost.note}>Illustrative</span> : project.project_cost?.page ? `Utility filing, p.${project.project_cost.page}` : project.project_cost_note || 'Not published'}</small></div>
        <div><span><Icon name="calendar" size={16} />In service</span><strong>{longDate(project.in_service_date) || project.in_service_year || '—'}</strong><small>Planned in-service date</small></div>
        <div><span><Icon name="crane" size={16} />Construction</span><strong>{start && end ? `${months(start, end)} months` : '—'}</strong>
          <small>{start && end ? `${longDate(project.construction.start_date)} – ${longDate(project.construction.end_date)}${project.construction.basis === 'annual_spending_schedule' ? ' (est.)' : ''}` : 'Dates not supplied'}</small></div>
        <div><span><Icon name="link" size={16} />Nearby projects</span><strong>{related.length}</strong><small>Other utilities within 40 km</small></div>
      </section>

      {(start || service) && <section className="card schedule-card">
        <header className="card-header"><div><h2>Schedule</h2><p>{project.construction?.note || 'Construction window and in-service target'}</p></div></header>
        <ScheduleBar start={start} end={end} service={service} estimated={project.construction?.basis === 'annual_spending_schedule'} />
      </section>}

      <div className="detail-layout">
        <div className="detail-main">
          <section className="card">
            <header className="card-header"><div><h2>Coordination opportunities</h2><p>Projects from other utilities near this one, highest score first</p></div></header>
            {related.length ? <ul className="related">{related.map(o => <li key={o.id}>
              <button onClick={() => onOpenProject?.(o.partner_id)}>
                <span className="org-mark" style={{background: PAIR_COLORS[1]}}>{initials(o.partner_owner)}</span>
                <div><strong>{o.partner_name}</strong><small>{o.partner_owner} · {bandName(o.band)}</small></div>
                <div className="related-facts"><span>{o.shared_substations.length ? `Shares ${o.shared_substations.join(', ')}` : `${o.distance_km.toFixed(1)} km`}</span>
                  <span>{o.timeline?.overlap ? `${Math.round(o.timeline.overlap_days / 30.4)} mo overlap${o.timeline.estimated ? ' (est.)' : ''}` : o.timeline?.overlap === false ? 'No overlap' : 'Timing unknown'}</span></div>
                <span className={`score-chip ${scoreClass(o.coordination_score)}`}>{Math.round(o.coordination_score)}/100</span>
                <Icon name="arrowRight" size={15} />
              </button></li>)}</ul> : <p className="empty">No coordination candidates for this project.</p>}
          </section>

          <section className="card">
            <header className="card-header"><h2>Project details</h2></header>
            <dl className="spec-grid">{[
              ['Utility', project.owner], ['Work type', project.project_type], ['Status', status], ['Voltage', project.voltage_max_kv ? `${project.voltage_max_kv} kV` : null],
              ['From', project.origin?.name], ['To', project.destination?.name], ['RTO', project.rtos?.join(', ')], ['States', project.states?.join(', ') || project.state_codes?.join(', ')],
              ['State permitting', project.permitting?.state_status || project.permitting?.state_simple_status], ['Federal permitting', project.permitting?.federal_status || project.permitting?.federal_simple_status],
              ['Construction start', date(project.construction?.start_date)], ['Construction end', date(project.construction?.end_date)],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value == null || value === '' ? 'missing' : ''}>{value == null || value === '' ? 'Not supplied' : String(value)}</dd></div>)}</dl>
            {project.document_description && <div className="scope-block"><h3>Scope</h3><p>{project.document_description}</p>{project.document_need && <><h3>Why it's needed</h3><p>{project.document_need}</p></>}</div>}
            {project.project_cost?.note && <p className="detail-note">{project.project_cost.note}</p>}
          </section>
        </div>
        <aside className="detail-side">
          {project.document_evidence?.length > 0 && <section className="card"><header className="card-header"><div><h2>From utility documents</h2><p>Values read from the utility's own planning filing</p></div></header>
            <ul className="evidence-list">{project.document_evidence.map((e, i) => <li key={i}><span>{EVIDENCE_LABELS[e.field] || e.field}</span><strong>{e.value}</strong><small><Icon name="file" size={12} />{e.document_title || e.document} · p.{e.page}{e.utility_project_id ? ` · ID ${e.utility_project_id}` : ''}</small></li>)}</ul></section>}
          <section className="card"><header className="card-header"><div><h2>Source documents</h2><p>Original utility and planning filings</p></div></header>
            <ul className="source-links">{links.map((url, i) => <li key={i}><a href={url} target="_blank" rel="noreferrer"><Icon name="file" size={14} /><span>{new URL(url).hostname.replace(/^www\./, '')}</span><Icon name="external" size={12} /></a></li>)}
              {!links.length && <li className="muted">No web links for this record.{project.document_evidence?.length ? ' See the utility filing citations above.' : ''}</li>}</ul></section>
          <section className="card"><header className="card-header"><h2>Provenance</h2></header>
            <dl className="spec-list"><div><dt>Sheet</dt><dd>{project.source_sheet}</dd></div><div><dt>Row</dt><dd className="num">{project.source_row}</dd></div><div><dt>Record</dt><dd className="num">{project.record_id}</dd></div></dl></section>
        </aside>
      </div>
    </>}
  </div>
}

function ScheduleBar({ start, end, service, estimated }) {
  const [now] = useState(() => Date.now())
  const points = [start, end, service, now].filter(Boolean)
  const first = new Date(Math.min(...points)).getUTCFullYear(), last = new Date(Math.max(...points)).getUTCFullYear() + 1
  const span = Date.UTC(last, 0, 1) - Date.UTC(first, 0, 1)
  const at = t => `${((t - Date.UTC(first, 0, 1)) / span) * 100}%`
  const years = Array.from({length: last - first + 1}, (_, i) => first + i)
  return <div className="schedule-bar">
    <div className="schedule-track">
      {years.map(y => <span key={y} className="schedule-year" style={{left: at(Date.UTC(y, 0, 1))}}><em>{y}</em></span>)}
      {start && end && <b className={`schedule-window ${estimated ? 'estimated' : ''}`} style={{left: at(start), width: `calc(${at(end)} - ${at(start)})`}} />}
      {service && <i className="schedule-service" style={{left: at(service)}} title="In-service target" />}
      <i className="schedule-today" style={{left: at(now)}}><em>Today</em></i>
    </div>
    <div className="timeline-legend"><span><b className="legend-window" />Construction{estimated ? ' (estimated from spending schedule)' : ''}</span><span><i className="legend-service" />In service</span><span><i className="legend-today" />Today</span></div>
  </div>
}
