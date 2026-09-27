import { useEffect, useRef, useState } from 'react'
import Icon from '../../ui/Icon'
import { ownerShort, scoreClass } from '../../ui/format'
import { bandName, distanceLabel, scoreOf, PAIR_COLORS } from '../overview/model'
import './HomePage.css'

const FEATURES = [
  ['map', 'Project map', 'Every planned transmission project and substation on one map.', 'overview', 'Open the map',
    ['Filter by utility, work type, year, and status', 'Red rings mark projects with a nearby partner', '2D and 3D views with tilt and rotation']],
  ['link', 'Coordination pairs', 'Projects from different utilities within 40 km, ranked by score.', 'coordination', 'View opportunities',
    ['Score out of 100: proximity, timeline, compatibility', 'Construction overlap from filed schedules', 'Shared land, logistics, crews, and equipment']],
  ['calendar', 'Plan & meeting', 'Turn a pair into a meeting with both utilities in one step.', 'coordination', 'Plan a meeting',
    ['Both companies side by side with contacts', 'Timed agenda and a four-step coordination plan', 'Draft email and calendar invite']],
  ['chat', 'AI analysis', 'A brief for any pair, written only from the records and filings.', 'consultation', 'Try the analysis',
    ['Executive summary and key insights', 'Risks and recommended next steps', 'Cites utility documents by page']],
  ['file', 'Utility filings', 'Budgets and dates read straight from utility planning documents.', 'projects', 'Browse projects',
    ['Dominion and Georgia Power filings parsed', 'Every value cites its document and page', 'Redacted values stay redacted']],
  ['table', 'Traceable records', 'Each project keeps its source workbook row and document links.', 'projects', 'See the library',
    ['Import any compatible Excel workbook', 'Review before anything is saved', 'Re-imports never duplicate records']],
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
  const [openCard, setOpenCard] = useState(null)
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
    <section className="hero">
      <div className="hero-media" aria-hidden="true" />
      <div className="container hero-grid">
        <div className="hero-copy">
          <span className="hero-kicker">Transmission coordination</span>
          <h1>Coordinate transmission projects before construction begins.</h1>
          <p>GridSync maps planned transmission work across utilities and flags projects close enough to share land, logistics, crews, and equipment.</p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate('overview')}>Explore the map<Icon name="arrowRight" size={16} /></button>
            <button className="btn btn-lg btn-on-dark" onClick={() => onNavigate('coordination')}>View opportunities</button>
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
      </div>
    </section>

    <section className="stat-band" aria-label="Dataset summary"><div className="container stat-grid">
      <div><strong className="num">{value(stats?.projects)}</strong><span>Planned projects</span></div>
      <div><strong className="num">{value(stats?.utilities)}</strong><span>Utilities</span></div>
      <div><strong className="num">{value(stats?.states)}</strong><span>States</span></div>
      <div><strong className="num">{value(stats?.pairs)}</strong><span>Coordination candidates</span></div>
    </div></section>

    <section className="section"><div className="container">
      <div className="section-head"><span className="eyebrow">What GridSync does</span><h2>One place to see where plans overlap</h2><p>Utilities plan in parallel. GridSync puts their projects side by side so the overlaps are visible early.</p></div>
      <div className="feature-grid">{FEATURES.map((feature, i) => <FeatureCard key={feature[1]} feature={feature} index={i} open={openCard === i} onToggle={() => setOpenCard(openCard === i ? null : i)} onNavigate={onNavigate} />)}</div>
    </div></section>

    <section className="section section-alt"><div className="container split">
      <div className="section-head left"><span className="eyebrow">How it works</span><h2>From spreadsheet to shared plan</h2><p>Three steps, with the source kept attached the whole way.</p>
        <figure className="site-photo"><img src="/substation-site.jpg" alt="Aerial view of a new substation under construction" loading="lazy" /><figcaption>Two projects this close can share crews, cranes, and laydown yards.</figcaption></figure></div>
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

// Expands in place on click; fades up once when scrolled into view.
function FeatureCard({ feature: [icon, title, text, target, action, points], index, open, onToggle, onNavigate }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node || !('IntersectionObserver' in window)) { setSeen(true); return }
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setSeen(true); observer.disconnect() } }, {threshold: .2})
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return <article ref={ref} className={`feature ${open ? 'open' : ''} ${seen ? 'seen' : ''}`} style={{'--delay': `${(index % 3) * 90}ms`}}>
    <button className="feature-toggle" aria-expanded={open} onClick={onToggle}>
      <span className="feature-icon"><Icon name={icon} size={22} /></span>
      <span className="feature-text"><h3>{title}</h3><p>{text}</p></span>
      <span className="feature-plus" aria-hidden="true" />
    </button>
    <div className="feature-more"><div>
      <ul>{points.map(point => <li key={point}><Icon name="check" size={14} />{point}</li>)}</ul>
      <button className="btn btn-sm btn-primary" tabIndex={open ? 0 : -1} onClick={() => onNavigate(target)}>{action}<Icon name="arrowRight" size={13} /></button>
    </div></div>
  </article>
}
