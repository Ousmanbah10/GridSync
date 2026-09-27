import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { ownerShort, scoreClass } from '../../ui/format'
import { bandName, distanceLabel, scoreOf, PAIR_COLORS } from '../overview/model'
import './HomePage.css'

const FEATURES = [
  ['map', 'National project map', 'Every planned transmission project and substation on one map, filterable by utility, type, year, and status.', 'overview'],
  ['link', 'Cross-utility pairs', 'Projects owned by different utilities within 40 km of each other, ranked by proximity, timing, and compatibility.', 'coordination'],
  ['chat', 'Grounded AI briefs', 'A coordination brief for any pair, written only from the source records, with risks and next steps.', 'consultation'],
  ['table', 'Traceable records', 'Each project links back to its source workbook row and the original utility or planning document.', 'projects'],
]
const STEPS = [
  ['Import', 'Load the planning workbook. Every record keeps its source sheet, row, and document links.'],
  ['Screen', 'GridSync measures the distance between projects from different utilities and scores each pair.'],
  ['Coordinate', 'Review the pair, generate a brief, and start the conversation before crews mobilize.'],
]
const BANDS = [['Under 1.6 km', 'Land & access', 'Shared rights-of-way, access roads, and permitting.'],
  ['Under 8 km', 'Site logistics', 'Staging areas, deliveries, and laydown yards.'],
  ['Under 40 km', 'Crews & equipment', 'Line crews, cranes, and heavy equipment mobilization.']]

export default function HomePage({ onNavigate }) {
  const [stats, setStats] = useState(null)
  const [top, setTop] = useState(null)
  useEffect(() => {
    const abort = new AbortController()
    const get = url => fetch(url, {signal: abort.signal}).then(r => r.ok ? r.json() : Promise.reject(new Error(r.status)))
    Promise.all([get('/api/projects/?page=1'), get('/api/opportunities/?limit=3')])
      .then(([projects, opportunities]) => {
        setStats({projects: projects.total, utilities: projects.filters.owners.length, states: projects.filters.states.length, pairs: opportunities.count})
        setTop(opportunities.results)
      }).catch(err => { if (err.name !== 'AbortError') { setStats(false); setTop([]) } })
    return () => abort.abort()
  }, [])
  const value = n => stats ? n.toLocaleString() : stats === false ? '—' : <span className="skeleton" />

  return <div className="home">
    <section className="hero"><div className="container hero-grid">
      <div className="hero-copy">
        <span className="eyebrow">Transmission coordination</span>
        <h1>Coordinate transmission projects before construction begins.</h1>
        <p>GridSync maps planned transmission work across utilities and flags projects that are close enough to share land, logistics, crews, and equipment.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => onNavigate('overview')}>Explore the map<Icon name="arrowRight" size={16} /></button>
          <button className="btn btn-lg" onClick={() => onNavigate('coordination')}>View opportunities</button>
        </div>
        <p className="hero-note"><Icon name="shield" size={15} />Built on public utility planning data. Every record links to its source.</p>
      </div>
      <aside className="hero-panel" aria-label="Top ranked coordination candidates">
        <header><span>Top ranked pairs</span><button className="link-button" onClick={() => onNavigate('coordination')}>See all<Icon name="arrowRight" size={13} /></button></header>
        <ol>{(top || [null, null, null]).map((o, i) => <li key={o?._id || i}>
          {o ? <>
            <div className="pair-names">{o.project_names?.map((name, index) => <span key={index}><i className="dot" style={{background: PAIR_COLORS[index]}} />{name}</span>)}</div>
            <div className="pair-meta"><span>{ownerShort(o.owners?.[0])} ↔ {ownerShort(o.owners?.[1])}</span><span>{distanceLabel(o)}</span><span className={`score-chip ${scoreClass(scoreOf(o))}`}>{Math.round(scoreOf(o))}/100</span></div>
            <small>{bandName(o.band)}</small>
          </> : <div className="pair-skeleton"><span className="skeleton" /><span className="skeleton" /></div>}
        </li>)}
        {top && !top.length && <li className="muted">Import data and rank opportunities to see pairs here.</li>}</ol>
      </aside>
    </div></section>

    <section className="stat-band" aria-label="Dataset summary"><div className="container stat-grid">
      <div><strong className="num">{value(stats?.projects)}</strong><span>Planned projects</span></div>
      <div><strong className="num">{value(stats?.utilities)}</strong><span>Utilities</span></div>
      <div><strong className="num">{value(stats?.states)}</strong><span>States</span></div>
      <div><strong className="num">{value(stats?.pairs)}</strong><span>Coordination candidates</span></div>
    </div></section>

    <section className="section"><div className="container">
      <div className="section-head"><span className="eyebrow">What GridSync does</span><h2>One place to see where plans overlap</h2><p>Utilities plan in parallel. GridSync puts their projects side by side so the overlaps are visible early.</p></div>
      <div className="feature-grid">{FEATURES.map(([icon, title, text, target]) => <button className="feature" key={title} onClick={() => onNavigate(target)}>
        <span className="feature-icon"><Icon name={icon} size={22} /></span><h3>{title}</h3><p>{text}</p><span className="feature-link">Open<Icon name="arrowRight" size={13} /></span>
      </button>)}</div>
    </div></section>

    <section className="section section-alt"><div className="container split">
      <div className="section-head left"><span className="eyebrow">How it works</span><h2>From spreadsheet to shared plan</h2><p>Three steps, with the source kept attached the whole way.</p></div>
      <ol className="steps">{STEPS.map(([title, text], i) => <li key={title}><span className="num">{String(i + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
    </div></section>

    <section className="section"><div className="container split">
      <div className="section-head left"><span className="eyebrow">Distance bands</span><h2>Closer projects share more</h2><p>Proximity is the starting point. Schedules, ownership, and engineering constraints still need confirming.</p></div>
      <div className="band-list">{BANDS.map(([distance, title, text]) => <div className="band" key={title}><span className="chip chip-accent">{distance}</span><h3>{title}</h3><p>{text}</p></div>)}</div>
    </div></section>

    <section className="cta"><div className="container cta-inner">
      <div><h2>See the coordination opportunities in your region</h2><p>Filter by utility or state, then open any pair to compare the projects.</p></div>
      <div className="hero-actions"><button className="btn btn-primary btn-lg" onClick={() => onNavigate('overview')}>Open the map<Icon name="arrowRight" size={16} /></button><button className="btn btn-lg btn-on-dark" onClick={() => onNavigate('import')}>Import data</button></div>
    </div></section>
  </div>
}
