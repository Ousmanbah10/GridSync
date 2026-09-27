import { useEffect, useMemo, useState } from 'react'
import CoordinationPanel from './CoordinationPanel'
import ConsultationPanel from './ConsultationPanel'
import OverviewMap from './OverviewMap'
import Icon from '../../ui/Icon'
import PageBanner from '../../ui/PageBanner'
import { ownerShort, scoreClass } from '../../ui/format'
import { basisLabel, distanceLabel, opportunitiesAtLocation, timelineSummary, timelineLabel, filterOpportunities, filterProjects, ownerColor, uniqueValues, scoreOf, bandName, PAIR_COLORS } from './model'
import './OverviewPage.css'

const EYEBROWS = {overview: 'Network map', coordination: 'Coordination', consultation: 'AI analysis'}
// Friendly names for imported workbooks; unknown files fall back to their name without the extension.
const datasetLabel = name => !name ? 'Dataset' : /overlap/i.test(name) ? 'Dominion × Georgia Power · challenge set' : /ourgridfuture/i.test(name) ? 'National planned projects' : name.replace(/\.xlsx$/i, '').replace(/_/g, ' ')
const EMPTY = { owner: '', type: '', year: '', status: '', search: '' }
const HEADINGS = {
  overview: ['Utility Projects Map', 'Planned transmission and substation projects across utilities, with nearby cross-utility pairs highlighted.'],
  coordination: ['Coordination Opportunities', 'Projects from different utilities that are near each other and may share land, logistics, crews, or equipment.'],
  consultation: ['AI Coordination Analysis', 'A grounded brief for a selected pair: shared resources, risks, and recommended next steps.'],
}

export default function OverviewPage({ mode, onNavigate, onOpenProject }) {
  const [data, setData] = useState(null)
  const [scope, setScope] = useState('demo')
  const [source, setSource] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState(EMPTY)
  const [clickedLocation, setClickedLocation] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [focusRequest, setFocusRequest] = useState(0)
  const [closeRequest, setCloseRequest] = useState(0)
  function closeSelection() { setSelectedId(null); setClickedLocation(null); setCloseRequest(n => n + 1) }
  const [fitRequest, setFitRequest] = useState(0)
  const [layers, setLayers] = useState({ projects: true, substations: true, overlaps: true, routes: true })
  useEffect(() => {
    const abort = new AbortController()
    fetch(`/api/map/overview/?scope=${scope}&source_id=${encodeURIComponent(source)}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Project data could not be loaded. Check the backend connection and retry.')
        return response.json()
      }).then(result => { setData(result); setLoading(false) })
      .catch(err => { if (err.name !== 'AbortError') {setError(err.message); setLoading(false)} })
    return () => abort.abort()
  }, [source, scope, refresh])
  const projects = useMemo(() => filterProjects(data?.projects || [], filters), [data, filters])
  const opportunities = useMemo(() => filterOpportunities(data?.opportunities || [], projects), [data, projects])
  const owners = useMemo(() => uniqueValues(data?.projects || [], 'owner'), [data])
  const leadingOwners = useMemo(() => {
    const counts = new Map()
    projects.forEach(p => { if (p.owner) counts.set(p.owner, (counts.get(p.owner) || 0) + 1) })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
  }, [projects])
  const nearby = opportunitiesAtLocation(opportunities, clickedLocation)
  const current = opportunities.find(o => o.id === selectedId)
  function selectLocation(location) {
    setFocusRequest(n => n + 1)
    setClickedLocation(location)
    setSelectedId(opportunitiesAtLocation(opportunities, location)[0]?.id || null)
  }
  const selected = opportunities.find(o => o.id === selectedId)
  function changeFilter(field, value) {
    setFilters(previous => ({ ...previous, [field]: value })); setSelectedId(null); setClickedLocation(null)
  }
  function resetFilters() { setFilters(EMPTY); setSelectedId(null); setClickedLocation(null) }
  function resetDataset() { setData(null); setLoading(true); setError(''); setFilters(EMPTY); setSelectedId(null); setClickedLocation(null) }
  function selectOpportunity(id) { setSelectedId(id); setFocusRequest(n => n + 1) }
  function reload() { setError(''); setLoading(true); setRefresh(value => value + 1) }
  const number = value => loading ? <span className="skeleton" /> : value.toLocaleString()
  const hasRoutes = !!data?.routes.features.length
  const filtered = Object.values(filters).some(Boolean)
  const [title, subtitle] = HEADINGS[mode] || HEADINGS.overview
  const stats = [
    ['Total projects', projects.length, 'map', 'var(--accent)'],
    ['Utilities', new Set(projects.map(p => p.owner).filter(Boolean)).size, 'building', 'var(--b)'],
    ['States', new Set(projects.flatMap(p => p.state_codes || []).map(c => c.toUpperCase())).size, 'pin', '#7c3aed'],
    ['Overlap opportunities', opportunities.length, 'target', 'var(--signal)'],
  ]

  return <div className="overview">
    <PageBanner eyebrow={EYEBROWS[mode] || EYEBROWS.overview} title={title} subtitle={subtitle} photo={mode === 'coordination' ? '/substation-site.jpg' : undefined}>
        {mode === 'overview'
          ? <select className="control compact dataset-select" aria-label="Dataset" value={`${source || data?.source_id || ''}|${scope}`} disabled={loading} onChange={e => { const [id, next] = e.target.value.split('|'); setSource(id); setScope(next); resetDataset() }}>
              {(data?.sources || []).flatMap(s => /overlap/i.test(s.name) ? [[`${s.id}|demo`, datasetLabel(s.name)]]
                : [[`${s.id}|demo`, `${datasetLabel(s.name)} · curated 100`], [`${s.id}|full`, `${datasetLabel(s.name)} · all projects`]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              {!data && <option value={`${source}|${scope}`}>Loading…</option>}
            </select>
          : null}
    </PageBanner>

    {error && <div className="notice notice-error" role="alert">{error}<button className="btn btn-sm" onClick={reload}>Retry</button></div>}

    {mode === 'overview' ? <>
      <div className="filters">
        {[['owner', 'Utility', 'All Utilities', owners], ['type', 'Project Type', 'All Types', uniqueValues(data?.projects || [], 'project_type')], ['year', 'Year', 'All Years', uniqueValues(data?.projects || [], 'in_service_year')], ['status', 'Status', 'All Statuses', uniqueValues(data?.projects || [], 'status')]].map(([field, label, all, options]) =>
          <label className="field" key={field}>{label}<select value={filters[field]} onChange={e => changeFilter(field, e.target.value)} disabled={loading}><option value="">{all}</option>{options.map(value => <option value={value} key={value}>{value}</option>)}</select></label>)}
        <label className="field">Search<span className="search-box"><Icon name="search" size={14} /><input aria-label="Search projects and locations" placeholder="Project, utility, state…" value={filters.search} onChange={e => changeFilter('search', e.target.value)} /></span></label>
      </div>
      <div className="legend">
        {leadingOwners.map(([owner]) => <span key={owner} title={owner}><i className="dot" style={{background: ownerColor(owner, owners)}} />{owner}</span>)}
        <span><i className="dot" style={{background: 'var(--signal)'}} />Overlap (&lt; 25 mi)</span>
        <span><i className="legend-line" />{hasRoutes ? 'Transmission line' : 'Transmission line (not supplied)'}</span>
        <span><i className="legend-substation" />Substation</span>
        {filtered && <button className="link-button" onClick={resetFilters}>Clear filters</button>}
      </div>

      <section className={`card map-card-shell ${current ? 'pair-focused' : ''}`} aria-label="Projects and opportunities map">
        <OverviewMap data={data} projects={projects} opportunities={opportunities} selected={selected} layers={layers} owners={owners} fitRequest={fitRequest} focusRequest={focusRequest} closeRequest={closeRequest} onClose={closeSelection} onLocation={selectLocation} onSelect={id => {setClickedLocation(null); selectOpportunity(id)}} />
        <div className="map-rail">
          {stats.map(([label, value, icon, color, full]) => <div className={`stat ${icon === 'target' ? 'stat-signal' : ''}`} key={label} title={full || label}>
            <span className="stat-icon" style={{color}}><Icon name={icon} size={20} /></span><div><strong className="num">{number(value)}</strong><small>{label}</small></div>
          </div>)}
          <div className="map-layers">
            {[['projects', 'Project Locations'], ['routes', 'Transmission Lines'], ['substations', 'Substations'], ['overlaps', 'Overlap Opportunities']].map(([field, label]) =>
              <label key={field} className={field === 'routes' && !hasRoutes ? 'unavailable' : ''} title={field === 'routes' && !hasRoutes ? 'Route geometry is not in the dataset' : undefined}><input type="checkbox" checked={field === 'routes' ? layers[field] && hasRoutes : layers[field]} disabled={field === 'routes' && !hasRoutes} onChange={e => setLayers(previous => ({...previous, [field]: e.target.checked}))} />{label}</label>)}
            <button className="link-button" onClick={() => setFitRequest(n => n + 1)}>Fit to projects</button>
          </div>
        </div>

        {clickedLocation && !current && !loading && !error && <article className="map-popup">
          <header><strong>{clickedLocation.name}</strong><button className="icon-button" aria-label="Close location and return to overview" onClick={closeSelection}><Icon name="close" /></button></header>
          <p className="popup-note">No saved candidate at this location matches the current filters. Pairs must be under 25 miles apart and owned by different utilities.</p>
          {clickedLocation.projectIds?.filter(id => data.projects.some(p => p.project_record_id === id)).map(id => <button key={id} className="btn btn-sm btn-block" onClick={() => onOpenProject(id)}>View project<Icon name="arrowRight" size={14} /></button>)}
        </article>}

        {current && !loading && !error && <article className="map-popup">
          <header><span className={`score-chip ${scoreClass(scoreOf(current))}`}>{Math.round(scoreOf(current))}/100</span><span className="chip chip-signal">{bandName(current.band)}</span><button className="icon-button" aria-label="Close opportunity and return to overview" onClick={closeSelection}><Icon name="close" /></button></header>
          {clickedLocation && nearby.length > 1 && <label className="field">{nearby.length} candidates here<select aria-label="Nearby opportunities at selected location" value={current.id} onChange={e => setSelectedId(e.target.value)}>{nearby.map(o => <option key={o.id} value={o.id}>{o.project_names.join(' / ')} · {distanceLabel(o)}</option>)}</select></label>}
          <ul className="popup-pair">{current.project_names?.map((name, index) => <li key={index}><i className="dot" style={{background: PAIR_COLORS[index]}} /><button className="link-plain" onClick={() => onOpenProject(current.project_record_ids[index])}><strong>{name}</strong> <span>({ownerShort(current.owners?.[index])})</span></button></li>)}</ul>
          <dl className="popup-facts">
            <div><dt><Icon name="ruler" size={14} />Distance</dt><dd>{distanceLabel(current)}</dd></div>
            <div><dt><Icon name="calendar" size={14} />Timeline</dt><dd title={timelineSummary(current).detail}>{timelineLabel(current)}</dd></div>
            <div><dt><Icon name="line" size={14} />Basis</dt><dd>{basisLabel(current)}</dd></div>
          </dl>
          {current.shared_substations?.length > 0 && <p className="popup-note">Both projects connect at {current.shared_substations.join(', ')}. The dotted line links the labeled locations; it is not a transmission route.</p>}
          <div className="popup-actions"><button className="btn btn-primary" onClick={() => {setSelectedId(current.id); onNavigate('coordination')}}>View Opportunity<Icon name="arrowRight" size={14} /></button><button className="btn" onClick={() => {setSelectedId(current.id); onNavigate('consultation')}}>Analyze</button></div>
        </article>}

        {!clickedLocation && !current && !loading && !error && <div className="map-hint"><Icon name="target" size={14} />Click a red ring, project, or substation to see its coordination candidates.</div>}
        {!loading && !error && !projects.length && <div className="map-empty">No projects match these filters. <button className="link-button" onClick={resetFilters}>Reset filters</button></div>}
      </section>
      <p className="map-caption">{loading ? 'Loading project data…' : `${projects.filter(p => p.has_location).length.toLocaleString()} of ${projects.length.toLocaleString()} projects have a mapped location. Distances are measured between the closest mapped points.`}</p>
    </> : <>
      {filtered && <div className="notice notice-info">Map filters are active, so only pairs involving matching projects are listed.<button className="btn btn-sm" onClick={resetFilters}>Clear filters</button></div>}
      {mode === 'coordination'
        ? <CoordinationPanel onOpenProject={onOpenProject} key={`${source}:${scope}`} data={data} loading={loading} opportunities={opportunities} selectedId={selectedId} onSelect={selectOpportunity} onMap={id => {setSelectedId(id); onNavigate('overview')}} onAnalyze={id => {setSelectedId(id); onNavigate('consultation')}} />
        : <ConsultationPanel data={data} loading={loading} opportunities={opportunities} selectedId={selectedId} onSelect={setSelectedId} onOpenProject={onOpenProject} />}
    </>}
  </div>
}
