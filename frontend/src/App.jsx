import { useEffect, useRef, useState } from 'react'
import './App.css'

function App() {
  const [connection, setConnection] = useState(null)
  const [file, setFile] = useState(null)
  const [useAI, setUseAI] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [tab, setTab] = useState('projects')
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const input = useRef(null)

  async function refresh() {
    const response = await fetch('/api/status/')
    if (!response.ok) throw new Error('The backend is unavailable. Start the Django server and try again.')
    const data = await response.json()
    setConnection(data)
    return data
  }
  useEffect(() => {
    let cancelled = false
    fetch('/api/status/').then(response => {
      if (!response.ok) throw new Error('Backend unavailable')
      return response.json()
    }).then(data => { if (!cancelled) setConnection(data) })
      .catch(() => { if (!cancelled) setError('Start the Django backend to connect this workspace.') })
    return () => { cancelled = true }
  }, [])

  function selectFile(selected) {
    if (!selected) return
    setError('')
    if (!selected.name.toLowerCase().endsWith('.xlsx') || selected.size > 10 * 1024 * 1024) {
      setError('Please choose an .xlsx workbook smaller than 10 MB.')
      return
    }
    setFile(selected); setPreview(null); setResult(null); setReviewed(false)
  }
  async function request(url, options) {
    const response = await fetch(url, options)
    let data
    try { data = await response.json() } catch { throw new Error('The server returned an unreadable response. Check that Django is running.') }
    if (!response.ok) throw new Error(data.error || 'The request could not be completed. Please retry.')
    return data
  }
  async function extract(sample = false) {
    setBusy('preview'); setError(''); setResult(null); setPreview(null); setReviewed(false)
    try {
      const status = await refresh()
      const form = new FormData()
      if (sample) form.append('sample', 'true')
      else if (file) form.append('file', file)
      else throw new Error('Choose a workbook first.')
      form.append('use_ai', String(useAI))
      const data = await request('/api/import/preview/', { method: 'POST', body: form,
        headers: { 'X-CSRFToken': status.csrf_token } })
      setPreview(data); setPage(0); setQuery(''); setTab('projects')
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  async function save() {
    setBusy('import'); setError('')
    try {
      const status = await refresh()
      const data = await request('/api/import/commit/', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': status.csrf_token },
        body: JSON.stringify({ token: preview.token }) })
      setResult(data)
      await refresh().catch(() => {})
    } catch (e) { setError(e.message) } finally { setBusy('') }
  }
  const records = (preview?.records[tab] || []).filter(row =>
    JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
  const pages = Math.max(1, Math.ceil(records.length / 8))
  const rows = records.slice(page * 8, page * 8 + 8)
  const total = preview ? preview.counts.projects + preview.counts.substations : 0
  const count = (name) => connection?.counts?.[name]?.toLocaleString() ?? '—'
  const inserted = result ? Object.values(result.counts).reduce((n, value) => n + value.inserted, 0) : 0
  const existing = result ? Object.values(result.counts).reduce((n, value) => n + value.existing, 0) : 0

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#"><span className="brand-mark">G</span>GridSync<span className="brand-dot">.</span></a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <a className="nav-item active" href="#"><span aria-hidden="true">▦</span> Data workspace <span className="nav-arrow">↗</span></a>
        <div className="sidebar-note"><span className="small-label">THE FOUNDATION</span><h3>Better data.<br />Better coordination.</h3><p>Bring your utility projects together. Every opportunity starts here.</p><div className="grid-motif" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div></div>
        <div className="sidebar-footer"><span className="avatar">GS</span><div>GridSync workspace<small>Local development</small></div></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><span>Workspace <span className="slash">/</span> <strong>Data import</strong></span><span className="workspace-badge">TRANSMISSION INTELLIGENCE</span></header>
        <main>
          <div className="page-heading"><div><div className="eyebrow">YOUR DATA, CONNECTED</div><h1>Build your project foundation.</h1><p>Turn your transmission workbook into structured, traceable project data.</p></div><span className={`connection-pill ${connection?.database_ready ? 'connected' : ''}`}><i />{connection?.database_ready ? 'MongoDB connected' : 'Database not connected'}</span></div>
          <section className="stats" aria-label="Current database records">
            <article><span>Project records</span><strong>{count('projects')}</strong><small>Transmission projects & study concepts</small></article>
            <article><span>Substation records</span><strong>{count('substations')}</strong><small>Location data for your network</small></article>
            <article><span>Imported sources</span><strong>{count('sources')}</strong><small>Traceable to the original workbook</small></article>
          </section>
          <ol className="steps" aria-label="Import progress">
            {['Choose your workbook', 'Review extracted data', 'Import to GridSync'].map((label, index) => <li className={(result ? 2 : preview ? 1 : 0) >= index ? 'current' : ''} key={label}><span>{index + 1}</span>{label}</li>)}
          </ol>
          {error && <div role="alert" className="notice error">{error}</div>}
          {result && <div role="status" className="notice success"><strong>Import complete.</strong> {inserted.toLocaleString()} records added; {existing.toLocaleString()} already present. Your source information is saved with every record.</div>}
          <div className="import-layout">
            <section className="panel upload-panel">
              <div className="panel-heading"><div><h2>Bring your data in</h2><p>Start with your Our Grid Future Excel workbook.</p></div><span className="step-label">STEP 01</span></div>
              <div className={`dropzone ${busy ? 'disabled' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) selectFile(e.dataTransfer.files[0]) }}>
                <span className="file-icon" aria-hidden="true">↥</span><h3>{file ? file.name : 'One workbook. A connected workspace.'}</h3><p>{file ? `${(file.size / 1024).toFixed(0)} KB · Excel workbook` : 'Drop your Excel file here, or choose it from your computer.'}</p>
                <input ref={input} type="file" accept=".xlsx" aria-label="Choose Excel workbook" disabled={!!busy} onChange={e => selectFile(e.target.files[0])} />
                <button className="button secondary" disabled={!!busy} onClick={() => input.current.click()}>{file ? 'Change workbook' : 'Choose workbook'} <span>＋</span></button><small>.XLSX · UP TO 10 MB</small>
              </div>
              <label className={`ai-option ${!connection?.gemini_ready ? 'unavailable' : ''}`}><input type="checkbox" checked={useAI} disabled={!connection?.gemini_ready || !!busy} onChange={e => {setUseAI(e.target.checked); setPreview(null); setResult(null); setReviewed(false)}} /><span className="ai-symbol" aria-hidden="true">✦</span><span><strong>Let Gemini match your columns</strong><small>{connection?.gemini_ready ? 'AI matches headings. Original cell values stay intact.' : 'Ready to connect when you add your Gemini API key.'}</small></span><span className="tag">{connection?.gemini_ready ? 'AVAILABLE' : 'NOT CONNECTED'}</span></label>
              {useAI && <p className="privacy-note">Column headings are sent to Google Gemini for matching. Project rows and database credentials stay on the backend.</p>}
              <div className="upload-actions"><button className="button primary" disabled={!file || !!busy} onClick={() => extract()}>{busy === 'preview' ? 'Reading workbook…' : 'Extract & preview'} <span>→</span></button><button className="text-button" disabled={!!busy} onClick={() => extract(true)}>Use existing June 2026 workbook</button></div>
              {busy && <p role="status" className="processing"><span className="spinner" />{busy === 'preview' ? 'Reading the sheets and checking every record…' : 'Saving reviewed records to MongoDB…'}</p>}
            </section>
            <aside className="panel guide-panel"><div className="eyebrow">WHAT HAPPENS NEXT</div><h2>From spreadsheet<br />to project intelligence.</h2><div className="guide-item"><span>01</span><div><h3>Extract the essentials</h3><p>Projects, owners, voltages, timelines, substations, and sources.</p></div></div><div className="guide-item"><span>02</span><div><h3>Keep the context</h3><p>Original values and row references stay attached. Missing data stays unknown.</p></div></div><div className="guide-item"><span>03</span><div><h3>Review, then import</h3><p>Check the records and data warnings before saving to your database.</p></div></div><div className="guide-foot"><span aria-hidden="true">◎</span> Importing the same file again won’t duplicate your records.</div></aside>
          </div>
          <section className="panel preview-panel" aria-label="Extraction preview">
            <div className="panel-heading"><div><h2>{preview ? 'Your data, ready for review' : 'A clear view before you import'}</h2><p>{preview ? `${preview.filename} · ${total.toLocaleString()} records · ${preview.mode === 'gemini' ? 'Gemini column mapping' : 'Standard workbook mapping'}` : 'Extract a workbook to see its records, matched fields, and data warnings here.'}</p></div><span className="step-label">STEP 02</span></div>
            {!preview ? <div className="empty-preview"><div className="empty-table" aria-hidden="true"><i /><i /><i /></div><strong>Your preview will appear here</strong><p>Nothing is saved until you review and import.</p></div> : <>
              <div className="table-controls"><div className="tabs">{['projects', 'substations'].map(name => <button className={tab === name ? 'selected' : ''} onClick={() => {setTab(name); setPage(0); setQuery('')}} key={name}>{name === 'projects' ? 'Projects' : 'Substations'} <span>{preview.counts[name].toLocaleString()}</span></button>)}</div><input className="search" aria-label="Search extracted records" placeholder="Search extracted records…" value={query} onChange={e => {setQuery(e.target.value); setPage(0)}} /></div>
              <div className="table-scroll"><table><thead><tr>{(tab === 'projects' ? ['Record / project', 'Owner', 'Status', 'Voltage', 'In service', 'Source row'] : ['Substation', 'State', 'Coordinates', 'Voltage', 'Type', 'Source row']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.source_sheet}-${row.source_row}`}>{tab === 'projects' ? <><td><strong>{row.project_name}</strong><small>{row.record_id} · {row.dataset_kind === 'study_concept' ? 'Study concept' : row.project_id}</small></td><td>{row.owner || 'Unknown'}</td><td><span className="status-tag">{row.status || 'Unknown'}</span></td><td>{row.voltage_max_kv ? `${row.voltage_max_kv} kV` : 'Unknown'}</td><td>{row.in_service_year || row.in_service_year_raw || 'Unknown'}</td></> : <><td><strong>{row.name}</strong><small>{row.substation_id}</small></td><td>{row.state_code || 'Unknown'}</td><td>{row.location ? `${row.location.coordinates[1].toFixed(4)}, ${row.location.coordinates[0].toFixed(4)}` : 'Unknown'}</td><td>{row.voltage_max_kv ? `${row.voltage_max_kv} kV` : 'Unknown'}</td><td>{row.existing_or_new || 'Unknown'}</td></>}<td>{row.source_row}</td></tr>)}{!rows.length && <tr><td colSpan="6" className="no-results">No matching records.</td></tr>}</tbody></table></div>
              <div className="pagination"><span>{records.length.toLocaleString()} records · Page {page + 1} of {pages}</span><div><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button><button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next →</button></div></div>
              <div className="review-details"><details><summary>Column mappings <span>{preview.mappings.length} sheets</span></summary>{preview.mappings.map(mapping => <div className="mapping" key={mapping.sheet}><h3>{mapping.sheet}</h3><dl>{Object.entries(mapping.fields).map(([field, column]) => <div key={field}><dt>{column}</dt><dd>{field}</dd></div>)}</dl>{mapping.unmapped_columns.length > 0 && <p>Unmapped columns are retained in original data: {mapping.unmapped_columns.join(', ')}</p>}</div>)}</details><details><summary>Data warnings <span>{preview.warning_count.toLocaleString()} to review</span></summary><ul className="warnings">{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>{preview.errors.length > 0 && <div className="notice error"><strong>Import blocked until these issues are resolved:</strong><ul>{preview.errors.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>}</div>
              <div className="confirm-bar"><label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={!!busy || !!result} /> I’ve reviewed the records, mappings, and warnings.</label><button className="button primary" disabled={!reviewed || !!busy || !!result || preview.errors.length > 0 || !connection?.database_ready} onClick={save}>{result ? 'Imported ✓' : busy === 'import' ? 'Importing…' : `Import ${total.toLocaleString()} records`} {!result && '→'}</button></div>
            </>}
          </section>
          <footer className="page-footer"><span>GridSync · Built for a more connected grid.</span><span>Source-aware. Review-first.</span></footer>
        </main>
      </div>
    </div>
  )
}
export default App
