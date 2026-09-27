import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { costTag, initials, money, ownerSite, placeLabel, publicContact } from '../../ui/format'
import { distanceLabel, overlapLabel, scheduleTag, timelineSummary, bandName, PAIR_COLORS } from './model'
import './CoordinationPlan.css'

const CONTACT_KEY = 'gridsync.contacts'
const readContacts = () => { try { return JSON.parse(localStorage.getItem(CONTACT_KEY)) || {} } catch { return {} } }
const writeContacts = value => { try { localStorage.setItem(CONTACT_KEY, JSON.stringify(value)) } catch { /* private mode */ } }

// Default invite: the next weekday at least a week out, 10:00 local time, as a datetime-local value.
function defaultInvite() {
  const day = new Date()
  day.setDate(day.getDate() + 7)
  while ([0, 6].includes(day.getDay())) day.setDate(day.getDate() + 1)
  day.setHours(10, 0, 0, 0)
  const pad = n => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T10:00`
}
const icsDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const fmtWhen = d => d.toLocaleString('en-US', {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'})

// Outreach for one pair: both companies with their public planning contacts, why they should talk,
// and a ready-to-send email plus calendar invite. Nothing is sent automatically.
export default function CoordinationPlan({ opportunity, projects, onClose }) {
  const [saved, setSaved] = useState(readContacts)
  const [when, setWhen] = useState(defaultInvite)
  const [analysis, setAnalysis] = useState(null)
  const [copied, setCopied] = useState(false)
  const meeting = new Date(when)
  const schedule = timelineSummary(opportunity)
  const resources = opportunity.shared_resources?.map(r => r.resource) || []
  useEffect(() => {
    const abort = new AbortController()
    fetch(`/api/opportunities/${opportunity.id}/analysis/`, {signal: abort.signal}).then(r => r.ok ? r.json() : null)
      .then(body => setAnalysis(body?.analysis || null)).catch(() => {})
    return () => abort.abort()
  }, [opportunity.id])
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const owners = projects.map(p => p?.owner || 'Owner unknown')
  // A contact is the user's saved edit, else the utility's published planning contact.
  const contactFor = owner => ({...(publicContact(owner) || {}), ...saved[owner]})
  function setContact(owner, field, value) {
    const next = {...saved, [owner]: {...saved[owner], [field]: value}}
    setSaved(next); writeContacts(next)
  }
  const subject = `Coordination opportunity: ${projects.map(p => p?.project_name).join(' / ')}`
  const body = ['Hello,', '',
    `GridSync flagged a possible coordination opportunity between ${owners.join(' and ')}:`,
    ...projects.map((p, i) => `- ${['A', 'B'][i]}: ${p?.project_name} (${p?.owner})`),
    '', `Distance: ${distanceLabel(opportunity)}`, `${schedule.title}: ${schedule.value}`,
    resources.length ? `Potential sharing: ${resources.join(', ')}` : '',
    '', `Would you be open to a short call? Suggested time: ${fmtWhen(meeting)} (60 minutes). Happy to adjust.`, '', 'Thank you,'].join('\n')
  const emails = owners.map(o => contactFor(o).email).filter(Boolean)
  const mailto = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  function downloadInvite() {
    if (Number.isNaN(meeting.getTime())) return
    const end = new Date(meeting.getTime() + 60 * 60 * 1000)
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GridSync//Coordination//EN', 'BEGIN:VEVENT',
      `UID:${opportunity.id}-${meeting.getTime()}@gridsync`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(meeting)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${subject.replace(/[,;]/g, ' ')}`, `DESCRIPTION:${body.replace(/\n/g, '\\n').replace(/[,;]/g, ' ')}`,
      ...emails.map(e => `ATTENDEE:mailto:${e}`), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const url = URL.createObjectURL(new Blob([ics], {type: 'text/calendar'}))
    const a = Object.assign(document.createElement('a'), {href: url, download: 'gridsync-coordination-call.ics'})
    a.click(); URL.revokeObjectURL(url)
  }
  async function copyEmail() {
    try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  return <div className="plan-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <aside className="plan-drawer" role="dialog" aria-modal="true" aria-label="Contact both utilities">
      <header className="plan-head">
        <div><span className="eyebrow">Contact both utilities</span><h2>{projects.map(p => p?.project_name).join(' · ')}</h2><p>{bandName(opportunity.band)} · {distanceLabel(opportunity)} · {overlapLabel(opportunity)}</p></div>
        <button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
      </header>
      <div className="plan-body">
        <section>
          <h3>Companies</h3>
          <div className="company-grid">{projects.map((p, i) => { const owner = owners[i], contact = contactFor(owner), site = ownerSite(owner); return <article className="company" key={i} style={{'--pair': PAIR_COLORS[i]}}>
            <header><span className="org-mark" style={{background: PAIR_COLORS[i]}}>{initials(owner)}</span><div><strong>{owner}</strong>{site && <a href={site} target="_blank" rel="noreferrer">{site.replace('https://www.', '')}<Icon name="external" size={11} /></a>}</div></header>
            <dl>
              <div><dt>Project</dt><dd>{p?.project_name}</dd></div>
              <div><dt>Location</dt><dd>{placeLabel(p)}</dd></div>
              <div><dt>Schedule</dt><dd>{p?.construction?.start_date ? `${String(p.construction.start_date).slice(0, 10)} → ${String(p.construction.end_date).slice(0, 10)}${scheduleTag(p.construction)}` : 'Not supplied'}</dd></div>
              <div><dt>Budget</dt><dd>{money(p?.project_cost) || 'Not published'}{costTag(p?.project_cost) && <span className="chip chip-warn tag">{costTag(p.project_cost)}</span>}</dd></div>
            </dl>
            <div className="contact-fields"><span>Coordination contact</span>
              {[['name', 'Team or name'], ['email', 'Email'], ['phone', 'Phone']].map(([field, label]) =>
                <input key={field} className="control" type={field === 'email' ? 'email' : 'text'} aria-label={`${owner} contact ${label}`} placeholder={label} value={contact[field] || ''} onChange={e => setContact(owner, field, e.target.value)} />)}
            </div>
          </article> })}</div>
        </section>

        <section>
          <h3>Why coordinate</h3>
          <ul className="why">
            <li><Icon name="ruler" size={16} /><span>{opportunity.shared_substations?.length ? <>Both projects connect at <b>{opportunity.shared_substations.join(', ')}</b>.</> : <><b>{distanceLabel(opportunity)}</b> apart, {bandName(opportunity.band).toLowerCase()}.</>}</span></li>
            <li><Icon name="calendar" size={16} /><span><b>{schedule.value}</b>. {schedule.detail}</span></li>
            {resources.length > 0 && <li><Icon name="truck" size={16} /><span>Potential sharing: <b>{resources.join(', ')}</b>.</span></li>}
            {analysis?.key_insights?.slice(0, 2).map((item, i) => <li key={i}><Icon name="bulb" size={16} /><span>{item}</span></li>)}
          </ul>
        </section>

        <section>
          <h3>Email</h3>
          <label className="field invite-when">Suggested call time (used in the email and the calendar invite)<input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
          <div className="email-preview"><div className="email-meta"><span><b>To:</b> {emails.join(', ') || 'add contact emails above'}</span><span><b>Subject:</b> {subject}</span></div><pre>{body}</pre></div>
        </section>
      </div>
      <footer className="plan-foot">
        <span>Nothing is sent automatically.</span>
        <div>
          <button className="btn" onClick={copyEmail}><Icon name={copied ? 'check' : 'list'} size={15} />{copied ? 'Copied' : 'Copy email'}</button>
          <button className="btn" onClick={downloadInvite}><Icon name="calendar" size={15} />Calendar invite</button>
          <a className="btn btn-primary" href={mailto}><Icon name="mail" size={15} />Open in email</a>
        </div>
      </footer>
    </aside>
  </div>
}
