import { useState } from 'react'
import Icon from '../../ui/Icon'
import { fieldLabel, post, sourceUrl } from './api'
import { hostname } from '../../ui/format'

const OUTCOMES = {
  proposals: 'Found facts with sources. Review them below.',
  no_supported_findings: 'Searched, but found no facts that a source clearly supports.',
  report_only: 'Report saved; the facts could not be pulled out automatically.',
  no_evidence: 'No usable sources were returned.',
}
const STATUS = {pending: ['Pending review', 'chip-warn'], reviewed: ['Accepted', 'chip-ok'], rejected: ['Rejected', 'chip']}

// Gemini + Google Search research for one project. Results are proposals; imported data is never changed.
export default function ResearchPanel({ projectId, runs: initialRuns, csrf, aiConfigured }) {
  const [runs, setRuns] = useState(initialRuns || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = runs[0]
  async function research() {
    setBusy(true); setError('')
    try {
      const data = await post(`/api/projects/${projectId}/research/`, {search: true}, csrf)
      setRuns(previous => [data.run, ...previous])
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  async function review(finding, status) {
    setError('')
    try {
      await post(`/api/projects/${projectId}/research/${run._id}/review/`, {finding_id: finding.id, status}, csrf)
      setRuns(previous => previous.map((r, i) => i ? r : {...r, findings: r.findings.map(f => f.id === finding.id ? {...f, review_status: status} : f)}))
    } catch (err) { setError(err.message) }
  }
  const sourceById = new Map((run?.sources || []).map(s => [s.id, s]))

  return <section className="card research">
    <header className="card-header">
      <div><h2>Web research</h2><p>Search the web for dates, budget, and permits</p></div>
      <button className="btn btn-primary" onClick={research} disabled={busy || !aiConfigured}>
        {busy ? <><span className="spinner light" />Searching the web…</> : <><Icon name={run ? 'refresh' : 'search'} size={15} />{run ? 'Search again' : 'Search the web'}</>}
      </button>
    </header>
    {error && <div className="notice notice-error research-notice" role="alert">{error}</div>}
    {busy && <p className="research-wait">This usually takes 20–60 seconds.</p>}
    {!run && !busy && <p className="empty">No research yet. Click <b>Search the web</b> to look for construction dates, budget, and permits.</p>}
    {run && <div className="research-body">
      <p className="research-meta">{new Date(run.created_at).toLocaleString()} · {OUTCOMES[run.outcome] || run.outcome}</p>
      {run.findings?.length > 0 && <ul className="findings">{run.findings.map(f => { const [label, cls] = STATUS[f.review_status] || STATUS.pending; return <li key={f.id} className={f.review_status}>
        <div className="finding-head"><span className="finding-field">{fieldLabel(f.field)}</span><strong>{f.value}</strong><span className={`chip ${cls}`}>{label}</span></div>
        {f.supporting_passage && <blockquote>{f.supporting_passage}</blockquote>}
        <div className="finding-foot">
          <span className="finding-sources">{f.source_ids.map(id => sourceById.get(id)).filter(s => s && sourceUrl(s.url)).map(s => <a key={s.id} href={s.url} target="_blank" rel="noreferrer"><Icon name="external" size={11} />{hostname(s.url)}</a>)}</span>
          <span className="finding-actions">
            <button className="btn btn-sm" disabled={f.review_status === 'reviewed'} onClick={() => review(f, 'reviewed')}><Icon name="check" size={13} />Accept</button>
            <button className="btn btn-sm btn-ghost" disabled={f.review_status === 'rejected'} onClick={() => review(f, 'rejected')}>Reject</button>
          </span>
        </div>
        {f.scope_note && <small className="finding-note">{f.scope_note}</small>}
      </li> })}</ul>}
      {run.missing_fields?.length > 0 && <p className="research-missing">Not found: {run.missing_fields.map(fieldLabel).join(', ')}.</p>}
      {run.sources?.length > 0 && <details className="research-details"><summary>Sources ({run.sources.length})</summary><ul>{run.sources.filter(s => sourceUrl(s.url)).map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></details>}
      {run.report && <details className="research-details"><summary>Full research report</summary><p className="research-report">{run.report}</p></details>}
    </div>}
  </section>
}
