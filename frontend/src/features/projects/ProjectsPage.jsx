import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import PageBanner from '../../ui/PageBanner'
import { costTag, hostname, money, orgColor, routeLabel, scheduleLabel } from '../../ui/format'
import { request, sourceUrl } from './api'
import { delayLabel } from '../overview/model'
import './ProjectsPage.css'

const PAGE_SIZE = 30
// Page numbers with ellipses: 1 … 4 5 6 … 25
function pageList(page, pages) {
  const set = [...new Set([1, page - 1, page, page + 1, pages].filter(n => n >= 1 && n <= pages))].sort((a, b) => a - b)
  return set.flatMap((n, i) => i && n - set[i - 1] > 1 ? ['…', n] : [n])
}

export default function ProjectsPage({ initialSearch = '', onOpen, onImport }) {
  const [filters, setFilters] = useState({search: initialSearch, owner: '', state: '', type: '', change: '', page: 1})
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      request('/api/projects/?' + new URLSearchParams(filters), {signal: controller.signal})
        .then(result => {setData(result); setError(''); setLoading(false)})
        .catch(err => {if (err.name !== 'AbortError') {setError(err.message); setLoading(false)}})
    }, 200)
    return () => {clearTimeout(timer); controller.abort()}
  }, [filters])
  function change(key, value) {
    setLoading(true); setError('')
    setFilters(current => ({...current, [key]: value, ...(key === 'page' ? {} : {page: 1})}))
  }
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const first = total ? (filters.page - 1) * PAGE_SIZE + 1 : 0
  const showCost = data?.projects.some(p => money(p.project_cost))
  return <div className="projects">
    <PageBanner eyebrow="Project library" title="All Utility Projects" subtitle="Browse and search every planned transmission project, with owner, location, schedule, and the source each record came from." photo="/hero-substation.jpg">
      <button className="btn btn-primary" onClick={onImport}><Icon name="upload" size={15} />Add / Import Data</button>
    </PageBanner>
    {error && <div className="notice notice-error" role="alert">{error}<button className="btn btn-sm" onClick={() => change('page', filters.page)}>Retry</button></div>}
    <div className="filters projects-filters">
      {[['owner', 'Utility', 'owners', 'All Utilities'], ['type', 'Project Type', 'types', 'All Types'], ['state', 'State', 'states', 'All States']].map(([key, label, options, all]) =>
        <label className="field" key={key}>{label}<select value={filters[key]} onChange={e => change(key, e.target.value)}><option value="">{all}</option>{data?.filters[options]?.map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label className="field">Schedule changes<select value={filters.change} onChange={e => change('change', e.target.value)}><option value="">Any</option><option value="delayed">Delayed</option><option value="advanced">Advanced</option></select></label>
      <label className="field">Search<span className="search-box"><Icon name="search" size={14} /><input value={filters.search} placeholder="Search projects…" onChange={e => change('search', e.target.value)} /></span></label>
    </div>
    <section className="card">
      <div className="table-wrap"><table className="table projects-table">
        <thead><tr><th>Project Name</th><th>Utility</th><th>Type</th><th>Location</th><th>Schedule</th>{showCost && <th>Est. Cost</th>}<th>Status</th><th>Source</th><th aria-label="Open" /></tr></thead>
        <tbody>{!loading && data?.projects.map(p => {
          const link = p.source_urls?.find(sourceUrl)
          return <tr key={p._id} className="clickable" onClick={() => onOpen(p._id)}>
            <td><strong>{p.project_name}</strong><small>{p.record_id}{p.segment ? ` · ${p.segment}` : ''}</small></td>
            <td><span className="owner-cell clamp" title={p.owner} style={{color: orgColor(p.owner)}}>{p.owner || 'Unknown'}</span></td>
            <td><span className="clamp" title={p.project_type}>{p.project_type?.split(';')[0] || <span className="muted">—</span>}</span></td>
            <td>{routeLabel(p) ? <><span className="clamp" title={routeLabel(p)}>{routeLabel(p)}</span><small>{p.state_codes?.join(', ')}</small></> : p.state_codes?.join(', ') || <span className="muted">—</span>}</td>
            <td className="nowrap num">{scheduleLabel(p)}</td>
            {showCost && <td className="num nowrap">{money(p.project_cost) || <span className="muted">{p.project_cost_note ? 'Redacted' : '—'}</span>}{costTag(p.project_cost) && <small className="illustrative">Illustrative</small>}</td>}
            <td>{p.status ? <span className="chip">{p.status}</span> : !p.schedule_flag && <span className="muted">—</span>}{p.schedule_flag && <span className={`chip delay-chip ${p.schedule_flag.kind}`} title={p.schedule_flag.text}>{delayLabel(p.schedule_flag)}</span>}</td>
            <td>{link ? <a href={link} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="source-link">{hostname(link)}<Icon name="external" size={12} /></a> : <span className="muted">—</span>}</td>
            <td className="right"><button className="link-button" onClick={e => {e.stopPropagation(); onOpen(p._id)}}>View</button></td>
          </tr>})}</tbody>
      </table></div>
      {loading && <p className="empty"><span className="spinner" /> Loading projects…</p>}
      {!loading && !error && !data?.projects.length && <p className="empty"><strong>No projects match</strong>Adjust the search or filters.</p>}
      <div className="pager" aria-live="polite"><span>{loading ? 'Loading…' : `Showing ${first.toLocaleString()}–${Math.min(total, filters.page * PAGE_SIZE).toLocaleString()} of ${total.toLocaleString()} projects`}</span>
        <div className="pages"><button aria-label="Previous page" disabled={loading || filters.page <= 1} onClick={() => change('page', filters.page - 1)}><Icon name="arrowLeft" size={14} /></button>
          {pageList(filters.page, pages).map((n, i) => n === '…' ? <span key={`gap${i}`}>…</span> : <button key={n} aria-current={n === filters.page ? 'page' : undefined} disabled={loading} onClick={() => change('page', n)}>{n}</button>)}
          <button aria-label="Next page" disabled={loading || filters.page >= pages} onClick={() => change('page', filters.page + 1)}><Icon name="arrowRight" size={14} /></button></div></div>
    </section>
  </div>
}
