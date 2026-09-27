import GridScene from './GridScene'
import './PageBanner.css'

// Dark page header with an optional photo and the animated grid scene; children render as controls on the right.
export default function PageBanner({ eyebrow, title, subtitle, photo, children }) {
  return <header className={`page-banner ${photo ? 'has-photo' : ''}`} style={photo ? {'--photo': `url('${photo}')`} : undefined}>
    <GridScene />
    <div className="page-banner-text">
      {eyebrow && <span className="page-banner-eyebrow">{eyebrow}</span>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    {children && <div className="page-banner-controls">{children}</div>}
  </header>
}
