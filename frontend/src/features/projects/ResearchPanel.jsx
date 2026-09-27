import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { fieldLabel, post, sourceUrl } from './api'
import { hostname } from '../../ui/format'
import Markdown from '../../ui/Markdown'

// Google Search results come back as redirect links; show the page's own name instead.
const sourceName = src => /vertexaisearch|googleusercontent/.test(hostname(src.url) || '') ? (src.title || 'Source').replace(/^www\./, '').slice(0, 32) : hostname(src.url)

const OUTCOMES = {
  proposals: 'Found facts with sources. Review them below.',
  no_supported_findings: 'Searched, but found no facts that a source clearly supports.',
  report_only: 'Report saved; the facts could not be pulled out automatically.',
  no_evidence: 'No usable sources were returned.',
}

// Gemini + Google Search research for one project. Results are proposals; imported data is never changed.
export default function ResearchPanel({ projectId, runs: initialRuns, csrf, aiConfigured, running: initiallyRunning }) {
  const [runs, setRuns] = useState(initialRuns || [])
  const [busy, setBusy] = useState(false)
  // A search started earlier (e.g. before leaving this page) keeps running on the server; wait for it here.
  const [waiting, setWaiting] = useState(!!initiallyRunning)
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(async () => {
      try {
        const data = await fetch(`/api/projects/${projectId}/`).then(r => r.json())
        if (!data.research_running) { setRuns(data.runs || []); setWaiting(false) }
      } catch { /* keep waiting */ }
    }, 5000)
    return () => clearInterval(timer)
  }, [waiting, projectId])
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
      <button className="btn btn-primary" onClick={research} disabled={busy || waiting || !aiConfigured}>
        {busy || waiting ? <><span className="spinner light" />Searching…</> : <><Icon name={run ? 'refresh' : 'search'} size={15} />{run ? 'Search again' : 'Search the web'}</>}
      </button>
    </header>
    {error && <div className="notice notice-error research-notice" role="alert">{error}</div>}
    {(busy || waiting) && <p className="research-wait">{waiting && !busy ? 'A search is still running. Results appear here when it finishes.' : 'Takes about 20–60 seconds. You can leave this page; results are saved.'}</p>}
    {!run && !busy && !waiting && <p className="research-empty">No research yet.</p>}
    {run && <div className="research-body">
      {run.findings?.length > 0 ? <table className="facts-table">
        <tbody>{run.findings.map(f => { const sources = f.source_ids.map(id => sourceById.get(id)).filter(src => src && sourceUrl(src.url)); return <tr key={f.id} className={f.review_status}>
          <th>{fieldLabel(f.field)}</th>
          <td title={f.supporting_passage}><strong>{f.value}</strong>{f.scope_note && <small>{f.scope_note}</small>}</td>
          <td className="fact-source">{sources.slice(0, 2).map(src => <a key={src.id} href={src.url} target="_blank" rel="noreferrer" title={src.title}>{sourceName(src)}<Icon name="external" size={11} /></a>)}</td>
          <td className="fact-actions">
            <button className={`icon-button ${f.review_status === 'reviewed' ? 'is-on ok' : ''}`} aria-label="Accept" title="Accept" onClick={() => review(f, 'reviewed')}><Icon name="check" size={15} /></button>
            <button className={`icon-button ${f.review_status === 'rejected' ? 'is-on no' : ''}`} aria-label="Reject" title="Reject" onClick={() => review(f, 'rejected')}><Icon name="close" size={15} /></button>
          </td>
        </tr> })}</tbody>
      </table> : <p className="research-empty">{OUTCOMES[run.outcome] || 'No facts found.'}</p>}
      <p className="research-meta">Searched {new Date(run.created_at).toLocaleDateString()}{run.missing_fields?.length ? ` · Not found: ${run.missing_fields.map(fieldLabel).join(', ')}` : ''}</p>
      {run.report && <details className="research-details" open={!run.findings?.length}><summary>Read full report{run.sources?.length ? ` · ${run.sources.length} sources` : ''}</summary>
        <div className="research-report"><Markdown text={run.report} />
          {run.sources?.length > 0 && <><h4 className="sources-title">Sources</h4><ul className="sources-list">{run.sources.filter(src => sourceUrl(src.url)).map(src => <li key={src.id}><a href={src.url} target="_blank" rel="noreferrer">{src.title}</a></li>)}</ul></>}
        </div></details>}
    </div>}
  </section>
}
