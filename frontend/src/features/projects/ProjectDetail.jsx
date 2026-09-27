import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { request, sourceUrl } from './api'
import './ProjectsPage.css'

const date = value => value ? String(value).slice(0, 10) : null
export default function ProjectDetail({ projectId, onBack }) {
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    request(`/api/projects/${projectId}/`, {signal: controller.signal})
      .then(data => setProject(data.project))
      .catch(err => {if (err.name !== 'AbortError') setError(err.message)})
    return () => controller.abort()
  }, [projectId, retry])
  const links = project?.source_urls?.filter(sourceUrl) || []
  const groups = project && [
    ['Overview', [['Utility', project.owner], ['Work type', project.project_type], ['Status', project.status], ['RTO', project.rtos?.join(', ')], ['Voltage', project.voltage_max_kv ? `${project.voltage_max_kv} kV` : null, true]]],
    ['Schedule', [['In-service target', project.in_service_year_raw || project.in_service_year, true], ['Construction start', date(project.construction?.start_date), true], ['Construction end', date(project.construction?.end_date), true]]],
    ['Cost & permitting', [['Published cost', project.project_cost?.amount != null ? `${project.project_cost.amount} ${project.project_cost.currency || '(currency unknown)'}` : null, true],
      ['State permitting', project.permitting?.state_status || project.permitting?.state_simple_status], ['Federal permitting', project.permitting?.federal_status || project.permitting?.federal_simple_status]]],
  ]
  return <div className="project-detail">
    <button className="btn btn-ghost btn-sm back-link" onClick={onBack}><Icon name="arrowLeft" size={14} />Project library</button>
    {error && <div className="notice notice-error" role="alert">{error}<button className="btn btn-sm" onClick={() => {setError(''); setRetry(n => n + 1)}}>Retry</button></div>}
    {!project && !error && <p className="empty"><span className="spinner" /> Loading project…</p>}
    {project && <>
      <header className="page-header"><div><span className="eyebrow">{project.record_id} · {project.owner || 'Owner unknown'}</span><h1>{project.project_name}</h1><p>{[project.origin?.name, project.destination?.name].filter(Boolean).join(' → ') || 'Endpoints not supplied'} · {project.state_codes?.join(', ') || 'States unknown'}</p></div>
        <span className="chip chip-accent status-chip">{project.status || 'Status unknown'}</span></header>
      <div className="detail-layout">
        <div className="detail-main">{groups.map(([title, rows]) => <section className="card" key={title}>
          <header className="card-header"><h2>{title}</h2></header>
          <dl className="spec-list">{rows.map(([label, value, mono]) => <div key={label}><dt>{label}</dt><dd className={value == null || value === '' ? 'missing' : mono ? 'num' : ''}>{value == null || value === '' ? 'Not supplied' : String(value)}</dd></div>)}</dl>
        </section>)}
          <p className="detail-note">In-service targets describe expected operation, not construction start or end dates.</p>
        </div>
        <aside className="detail-side">
          <section className="card"><header className="card-header"><div><h2>Source documents</h2><p>Original utility and planning filings</p></div></header>
            <ul className="source-links">{links.map((url, i) => <li key={i}><a href={url} target="_blank" rel="noreferrer"><Icon name="file" size={14} /><span>{new URL(url).hostname.replace(/^www\./, '')}</span><Icon name="external" size={12} /></a></li>)}
              {!links.length && <li className="muted">No source links supplied for this record.</li>}</ul></section>
          <section className="card"><header className="card-header"><h2>Provenance</h2></header>
            <dl className="spec-list"><div><dt>Sheet</dt><dd>{project.source_sheet}</dd></div><div><dt>Row</dt><dd className="num">{project.source_row}</dd></div><div><dt>Record</dt><dd className="num">{project.record_id}</dd></div></dl></section>
        </aside>
      </div>
    </>}
  </div>
}
