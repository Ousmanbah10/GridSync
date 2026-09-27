import { useEffect, useRef, useState } from 'react'
import Icon from './ui/Icon'
import './ImportWorkspace.css'


function ImportWorkspace({ onBack }) {
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

  const step = result ? 2 : preview ? 1 : 0
  return (
    <div className="import">
      <button className="btn btn-ghost btn-sm back-link" onClick={onBack}><Icon name="arrowLeft" size={14} />Project library</button>
      <header className="page-header"><div><span className="eyebrow">Data import</span><h1>Import a transmission workbook</h1><p>Extract projects and substations from an Excel workbook, review every record, then save it with its source attached.</p></div>
        <span className={`chip ${connection?.database_ready ? 'chip-ok' : 'chip-outline'}`}><i className="dot" style={{background: 'currentColor'}} />{connection?.database_ready ? 'MongoDB connected' : 'Database not connected'}</span></header>

      <section className="kpis import-kpis" aria-label="Current database records">
        <div><span>Project records</span><strong>{count('projects')}</strong><small>Projects and study concepts</small></div>
        <div><span>Substations</span><strong>{count('substations')}</strong><small>With coordinates</small></div>
        <div><span>Imported sources</span><strong>{count('sources')}</strong><small>Traceable workbooks</small></div>
      </section>

      <ol className="stepper" aria-label="Import progress">
        {['Choose workbook', 'Review extraction', 'Import'].map((label, index) => <li key={label} className={step > index ? 'done' : step === index ? 'current' : ''} aria-current={step === index ? 'step' : undefined}><span className="num">{step > index ? <Icon name="check" size={12} /> : index + 1}</span>{label}</li>)}
      </ol>

      {error && <div role="alert" className="notice notice-error">{error}</div>}
      {result && <div role="status" className="notice notice-success"><Icon name="check" /><span><strong>Import complete.</strong> {inserted.toLocaleString()} records added; {existing.toLocaleString()} already present. Source information is saved with every record.</span></div>}

      <div className="import-layout">
        <section className="card">
          <header className="card-header"><div><h2>Workbook</h2><p>Our Grid Future Excel format, .xlsx up to 10 MB</p></div></header>
          <div className="card-body">
            <div className={`dropzone ${busy ? 'disabled' : ''} ${file ? 'has-file' : ''}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (!busy) selectFile(e.dataTransfer.files[0]) }}>
              <span className="dropzone-icon"><Icon name={file ? 'file' : 'upload'} size={20} /></span>
              <div><strong>{file ? file.name : 'Drop a workbook here'}</strong><p>{file ? `${(file.size / 1024).toFixed(0)} KB · Excel workbook` : 'or choose a file from your computer'}</p></div>
              <input ref={input} type="file" accept=".xlsx" aria-label="Choose Excel workbook" disabled={!!busy} onChange={e => selectFile(e.target.files[0])} />
              <button className="btn btn-sm" disabled={!!busy} onClick={() => input.current.click()}>{file ? 'Change' : 'Browse'}</button>
            </div>
            <label className={`option ${!connection?.gemini_ready ? 'unavailable' : ''}`}><input type="checkbox" checked={useAI} disabled={!connection?.gemini_ready || !!busy} onChange={e => {setUseAI(e.target.checked); setPreview(null); setResult(null); setReviewed(false)}} /><span><strong>Match columns with Gemini</strong><small>{connection?.gemini_ready ? 'Only column headings are sent. Rows and credentials stay on the backend.' : 'Add a Gemini API key and model to backend/.env to enable.'}</small></span><span className={`chip ${connection?.gemini_ready ? 'chip-ok' : ''}`}>{connection?.gemini_ready ? 'Available' : 'Off'}</span></label>
            <div className="import-actions"><button className="btn btn-primary" disabled={!file || !!busy} onClick={() => extract()}>{busy === 'preview' ? 'Reading workbook…' : 'Extract & preview'}<Icon name="arrowRight" size={14} /></button><button className="link-button" disabled={!!busy} onClick={() => extract(true)}>Use the bundled June 2026 workbook</button></div>
            {busy && <p role="status" className="processing"><span className="spinner" />{busy === 'preview' ? 'Reading sheets and checking every record…' : 'Saving reviewed records to MongoDB…'}</p>}
          </div>
        </section>
        <aside className="card">
          <header className="card-header"><h2>How import works</h2></header>
          <ol className="howto">{[['Extract', 'Projects, owners, voltages, timelines, substations, and source links.'], ['Keep context', 'Original values and row references stay attached. Missing data stays unknown.'], ['Review, then save', 'Check records and warnings before anything is written.']].map(([title, text], i) => <li key={title}><span className="num">{i + 1}</span><div><strong>{title}</strong><p>{text}</p></div></li>)}</ol>
          <p className="bands-note">Re-importing the same file never duplicates records.</p>
        </aside>
      </div>

      <section className="card preview" aria-label="Extraction preview">
        <header className="card-header"><div><h2>{preview ? 'Review extracted records' : 'Preview'}</h2><p>{preview ? `${preview.filename} · ${total.toLocaleString()} records · ${preview.mode === 'gemini' ? 'Gemini column mapping' : 'Standard column mapping'}` : 'Records, column mappings, and data warnings appear here after extraction.'}</p></div></header>
        {!preview ? <p className="empty"><strong>Nothing extracted yet</strong>Nothing is saved until you review and confirm.</p> : <>
          <div className="preview-controls"><div className="segmented" role="tablist">{['projects', 'substations'].map(name => <button role="tab" aria-selected={tab === name} onClick={() => {setTab(name); setPage(0); setQuery('')}} key={name}>{name === 'projects' ? 'Projects' : 'Substations'} <span className="num">{preview.counts[name].toLocaleString()}</span></button>)}</div><span className="search-box"><Icon name="search" size={14} /><input className="control" aria-label="Search extracted records" placeholder="Search records…" value={query} onChange={e => {setQuery(e.target.value); setPage(0)}} /></span></div>
          <div className="table-wrap"><table className="table"><thead><tr>{(tab === 'projects' ? ['Record / project', 'Owner', 'Status', 'Voltage', 'In service', 'Row'] : ['Substation', 'State', 'Coordinates', 'Voltage', 'Type', 'Row']).map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.source_sheet}-${row.source_row}`}>{tab === 'projects' ? <><td><strong>{row.project_name}</strong><small className="num">{row.record_id} · {row.dataset_kind === 'study_concept' ? 'Study concept' : row.project_id}</small></td><td>{row.owner || <span className="muted">Unknown</span>}</td><td><span className="chip">{row.status || 'Unknown'}</span></td><td className="num">{row.voltage_max_kv ? `${row.voltage_max_kv} kV` : '—'}</td><td className="num">{row.in_service_year || row.in_service_year_raw || '—'}</td></> : <><td><strong>{row.name}</strong><small className="num">{row.substation_id}</small></td><td>{row.state_code || <span className="muted">Unknown</span>}</td><td className="num">{row.location ? `${row.location.coordinates[1].toFixed(4)}, ${row.location.coordinates[0].toFixed(4)}` : '—'}</td><td className="num">{row.voltage_max_kv ? `${row.voltage_max_kv} kV` : '—'}</td><td>{row.existing_or_new || <span className="muted">Unknown</span>}</td></>}<td className="num muted">{row.source_row}</td></tr>)}{!rows.length && <tr><td colSpan="6" className="empty">No matching records.</td></tr>}</tbody></table></div>
          <div className="pager"><span><span className="num">{records.length.toLocaleString()}</span> records · page {page + 1} of {pages}</span><div><button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="arrowLeft" size={13} />Prev</button><button className="btn btn-sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next<Icon name="arrowRight" size={13} /></button></div></div>
          <div className="review-details"><details><summary>Column mappings <span className="num">{preview.mappings.length} sheets</span></summary>{preview.mappings.map(mapping => <div className="mapping" key={mapping.sheet}><h3>{mapping.sheet}</h3><dl>{Object.entries(mapping.fields).map(([field, column]) => <div key={field}><dt>{column}</dt><dd className="num">{field}</dd></div>)}</dl>{mapping.unmapped_columns.length > 0 && <p>Unmapped columns are kept in the original data: {mapping.unmapped_columns.join(', ')}</p>}</div>)}</details><details><summary>Data warnings <span className="num">{preview.warning_count.toLocaleString()} to review</span></summary><ul className="warnings">{preview.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details>{preview.errors.length > 0 && <div className="notice notice-error"><div><strong>Import blocked until these issues are resolved:</strong><ul>{preview.errors.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div></div>}</div>
          <div className="confirm-bar"><label><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={!!busy || !!result} />I have reviewed the records, mappings, and warnings.</label><button className="btn btn-primary" disabled={!reviewed || !!busy || !!result || preview.errors.length > 0 || !connection?.database_ready} onClick={save}>{result ? <><Icon name="check" size={14} />Imported</> : busy === 'import' ? 'Importing…' : <>Import {total.toLocaleString()} records<Icon name="arrowRight" size={14} /></>}</button></div>
        </>}
      </section>
    </div>
  )
}
export default ImportWorkspace
