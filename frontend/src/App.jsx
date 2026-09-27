import { useEffect, useState } from 'react'
import HomePage from './features/home/HomePage'
import ProjectsPage from './features/projects/ProjectsPage'
import ProjectDetail from './features/projects/ProjectDetail'
import ImportWorkspace from './ImportWorkspace'
import OverviewPage from './features/overview/OverviewPage'
import Icon from './ui/Icon'
import { CONTACT, NAV } from './site'

export default function App() {
  const [page, setPage] = useState('home')
  const [projectId, setProjectId] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [api, setApi] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/status/').then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (!cancelled) setApi(data.database_ready ? 'ok' : 'down') })
      .catch(() => { if (!cancelled) setApi('down') })
    return () => { cancelled = true }
  }, [])
  function navigate(next) { setPage(next); setMenuOpen(false); window.scrollTo({top: 0, behavior: 'instant'}) }
  function openProject(id) { setProjectId(id); navigate('project-detail') }
  const active = ['project-detail', 'import'].includes(page) ? 'projects' : page
  const link = id => ({href: `#${id}`, onClick: e => {e.preventDefault(); navigate(id)}})
  return <div className="app">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="navbar"><div className="navbar-inner">
      <a className="brand" {...link('home')}><img src="/gridsync-mark.svg" alt="" /><span>GridSync</span></a>
      <nav className={`navlinks ${menuOpen ? 'open' : ''}`} id="main-nav" aria-label="Main navigation">{NAV.map(([id, title]) =>
        <a key={id} {...link(id)} aria-current={active === id ? 'page' : undefined}>{title}</a>)}</nav>
      <div className="navbar-actions">
        <span className={`api-status ${api || ''}`} title={api === 'ok' ? 'Backend and database connected' : 'Backend or database unavailable'}><i /><span>{api === 'ok' ? 'Live data' : api === 'down' ? 'Offline' : 'Connecting'}</span></span>
        <button className="btn btn-sm" onClick={() => navigate('import')}><Icon name="upload" size={14} />Import data</button>
        <button className="icon-button menu-toggle" aria-label="Open menu" aria-expanded={menuOpen} aria-controls="main-nav" onClick={() => setMenuOpen(o => !o)}><Icon name={menuOpen ? 'close' : 'menu'} size={20} /></button>
      </div>
    </div></header>

    <main className={page === 'home' ? 'home-main' : 'page'} id="main-content">{page === 'home' ? <HomePage onNavigate={navigate} /> :
      page === 'projects' ? <ProjectsPage onOpen={openProject} onImport={() => navigate('import')} /> :
      page === 'project-detail' ? <ProjectDetail key={projectId} projectId={projectId} onBack={() => navigate('projects')} /> :
      page === 'import' ? <ImportWorkspace onBack={() => navigate('projects')} /> :
      <OverviewPage mode={page} onNavigate={navigate} onOpenProject={openProject} />}</main>

    <footer className="footer"><div className="footer-inner">
      <div className="footer-brand">
        <a className="brand" {...link('home')}><img src="/gridsync-mark.svg" alt="" /><span>GridSync</span></a>
        <p>Find where planned transmission projects meet, so utilities can share land, crews, and equipment before construction begins.</p>
      </div>
      <nav className="footer-col" aria-label="Footer"><h3>Product</h3>{NAV.map(([id, title]) => <a key={id} {...link(id)}>{title}</a>)}<a {...link('import')}>Import data</a></nav>
      <div className="footer-col"><h3>Contact</h3>
        <a href={`tel:${CONTACT.phone.replace(/[^\d+]/g, '')}`}><Icon name="phone" size={15} />{CONTACT.phone}</a>
        <a href={`mailto:${CONTACT.email}`}><Icon name="mail" size={15} />{CONTACT.email}</a>
      </div>
    </div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} GridSync. All rights reserved.</span><span>Coordination candidates are screening results. Verify with each utility before acting.</span></div></footer>
  </div>
}
