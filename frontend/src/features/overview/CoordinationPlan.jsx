import { useEffect, useState } from 'react'
import Icon from '../../ui/Icon'
import { costTag, initials, money, ownerSite, placeLabel } from '../../ui/format'
import { distanceLabel, overlapLabel, timelineSummary, bandName, PAIR_COLORS } from './model'
import './CoordinationPlan.css'

const CONTACT_KEY = 'gridsync.contacts'
const readContacts = () => { try { return JSON.parse(localStorage.getItem(CONTACT_KEY)) || {} } catch { return {} } }
const writeContacts = value => { try { localStorage.setItem(CONTACT_KEY, JSON.stringify(value)) } catch { /* private mode */ } }

// Next weekdays at 10:00, starting a week out, skipping weekends.
function meetingSlots(count = 3) {
  const slots = [], day = new Date()
  day.setDate(day.getDate() + 7)
  while (slots.length < count) {
    if (![0, 6].includes(day.getDay())) { const slot = new Date(day); slot.setHours(10, 0, 0, 0); slots.push(slot) }
    day.setDate(day.getDate() + 1)
  }
  return slots
}
const addDays = (date, days) => { const d = new Date(date); d.setDate(d.getDate() + days); return d }
const fmtDay = d => d.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})
const fmtSlot = d => `${fmtDay(d)} · ${d.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'})}`
const icsDate = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export default function CoordinationPlan({ opportunity, projects, onClose }) {
  const [contacts, setContacts] = useState(readContacts)
  const [slot, setSlot] = useState(0)
  const [analysis, setAnalysis] = useState(null)
  const [copied, setCopied] = useState(false)
  const slots = meetingSlots()
  const meeting = slots[slot]
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
  function setContact(owner, field, value) {
    const next = {...contacts, [owner]: {...contacts[owner], [field]: value}}
    setContacts(next); writeContacts(next)
  }
  const owners = projects.map(p => p.owner || 'Owner unknown')
  const agenda = [
    ['10 min', 'Introductions and project overviews', `${projects[0]?.project_name} and ${projects[1]?.project_name}.`],
    ['15 min', 'Location and schedule', `${distanceLabel(opportunity)} apart. ${schedule.title}: ${schedule.value}.`],
    ['20 min', 'Shared resources', resources.length ? `Review sharing ${resources.join(', ')}.` : 'Identify what could be shared.'],
    ['10 min', 'Risks and constraints', 'Outage windows, permitting, engineering standards, and cost allocation.'],
    ['5 min', 'Decisions and owners', 'Agree on a data exchange, a joint field review, and the next meeting.'],
  ]
  const plan = [
    [0, 'Kickoff meeting', 'Confirm contacts, scope, and mapped locations.'],
    [14, 'Exchange data', 'Share construction schedules, outage plans, and site layouts.'],
    [28, 'Joint field review', 'Walk shared corridors, staging, and laydown areas.'],
    [42, 'Coordination decision', 'Decide what to share and how costs are split; record it in writing.'],
  ]
  const subject = `Coordination meeting: ${projects.map(p => p?.project_name).join(' / ')}`
  const body = [`Hello,`, '',
    `GridSync flagged a coordination opportunity between ${owners.join(' and ')}:`,
    ...projects.map((p, i) => `- ${['A', 'B'][i]}: ${p?.project_name} (${p?.owner})`),
    '', `Distance: ${distanceLabel(opportunity)}`, `${schedule.title}: ${schedule.value}`,
    resources.length ? `Potential sharing: ${resources.join(', ')}` : '', '',
    `Proposed meeting: ${fmtSlot(meeting)} (60 minutes).`, '', 'Agenda:',
    ...agenda.map(([time, title]) => `- ${title} (${time})`), '', 'Please reply with a time that works or suggest another.', '', 'Thank you,'].join('\n')
  const emails = owners.map(o => contacts[o]?.email).filter(Boolean)
  const mailto = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  function downloadInvite() {
    const end = new Date(meeting.getTime() + 60 * 60 * 1000)
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GridSync//Coordination//EN', 'BEGIN:VEVENT',
      `UID:${opportunity.id}-${meeting.getTime()}@gridsync`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(meeting)}`, `DTEND:${icsDate(end)}`,
      `SUMMARY:${subject.replace(/[,;]/g, ' ')}`, `DESCRIPTION:${body.replace(/\n/g, '\\n').replace(/[,;]/g, ' ')}`,
      ...emails.map(e => `ATTENDEE:mailto:${e}`), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n')
    const url = URL.createObjectURL(new Blob([ics], {type: 'text/calendar'}))
    const a = Object.assign(document.createElement('a'), {href: url, download: 'gridsync-coordination-meeting.ics'})
    a.click(); URL.revokeObjectURL(url)
  }
  async function copyEmail() {
    try { await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* clipboard blocked */ }
  }

  return <div className="plan-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <aside className="plan-drawer" role="dialog" aria-modal="true" aria-label="Coordination plan and meeting">
      <header className="plan-head">
        <div><span className="eyebrow">Coordination plan & meeting</span><h2>{projects.map(p => p?.project_name).join(' · ')}</h2><p>{bandName(opportunity.band)} · {distanceLabel(opportunity)} · {overlapLabel(opportunity)}</p></div>
        <button className="icon-button" aria-label="Close" onClick={onClose}><Icon name="close" size={20} /></button>
      </header>
      <div className="plan-body">
        <section>
          <h3>Companies</h3>
          <div className="company-grid">{projects.map((p, i) => { const owner = owners[i], contact = contacts[owner] || {}, site = ownerSite(owner); return <article className="company" key={i} style={{'--pair': PAIR_COLORS[i]}}>
            <header><span className="org-mark" style={{background: PAIR_COLORS[i]}}>{initials(owner)}</span><div><strong>{owner}</strong>{site && <a href={site} target="_blank" rel="noreferrer">{site.replace('https://www.', '')}<Icon name="external" size={11} /></a>}</div></header>
            <dl>
              <div><dt>Project</dt><dd>{p?.project_name}</dd></div>
              <div><dt>Location</dt><dd>{placeLabel(p)}</dd></div>
              <div><dt>Schedule</dt><dd>{p?.construction?.start_date ? `${String(p.construction.start_date).slice(0, 10)} → ${String(p.construction.end_date).slice(0, 10)}` : 'Not supplied'}</dd></div>
              <div><dt>Budget</dt><dd>{money(p?.project_cost) || 'Not published'}{costTag(p?.project_cost) && <span className="chip chip-warn tag">{costTag(p.project_cost)}</span>}</dd></div>
            </dl>
            <div className="contact-fields"><span>Coordination contact</span>
              {[['name', 'Name and title'], ['email', 'Email'], ['phone', 'Phone']].map(([field, label]) =>
                <input key={field} className="control" type={field === 'email' ? 'email' : 'text'} aria-label={`${owner} contact ${label}`} placeholder={label} value={contact[field] || ''} onChange={e => setContact(owner, field, e.target.value)} />)}
            </div>
          </article> })}</div>
          <p className="plan-note">Contacts are saved in this browser only. Use each utility's published transmission planning or project contact.</p>
        </section>

        <section>
          <h3>Why coordinate</h3>
          <ul className="why">
            <li><Icon name="ruler" size={16} /><span><b>{distanceLabel(opportunity)}</b> apart, {bandName(opportunity.band).toLowerCase()}.</span></li>
            <li><Icon name="calendar" size={16} /><span><b>{schedule.value}</b>. {schedule.detail}</span></li>
            {resources.length > 0 && <li><Icon name="truck" size={16} /><span>Potential sharing: <b>{resources.join(', ')}</b>.</span></li>}
            {analysis?.key_insights?.slice(0, 2).map((item, i) => <li key={i}><Icon name="bulb" size={16} /><span>{item}</span></li>)}
          </ul>
        </section>

        <section>
          <h3>Proposed meeting</h3>
          <div className="slots" role="radiogroup" aria-label="Meeting time">{slots.map((d, i) => <button key={i} role="radio" aria-checked={slot === i} onClick={() => setSlot(i)}><Icon name="calendar" size={14} />{fmtSlot(d)}</button>)}</div>
          <ol className="agenda">{agenda.map(([time, title, detail]) => <li key={title}><span>{time}</span><div><strong>{title}</strong><p>{detail}</p></div></li>)}</ol>
        </section>

        <section>
          <h3>Coordination plan</h3>
          <ol className="plan-steps">{plan.map(([days, title, detail], i) => <li key={title}><span className="step-dot">{i + 1}</span><div><strong>{title}</strong><small>{fmtDay(addDays(meeting, days))}</small><p>{detail}</p></div></li>)}</ol>
          {analysis?.next_steps?.length > 0 && <div className="ai-steps"><strong><Icon name="chat" size={14} />From the AI analysis</strong><ul>{analysis.next_steps.slice(0, 4).map((s, i) => <li key={i}>{s}</li>)}</ul></div>}
        </section>
      </div>
      <footer className="plan-foot">
        <span>{emails.length ? `Invite goes to ${emails.join(', ')}` : 'Add contact emails to address the invite.'}</span>
        <div>
          <button className="btn" onClick={copyEmail}><Icon name={copied ? 'check' : 'list'} size={15} />{copied ? 'Copied' : 'Copy email'}</button>
          <button className="btn" onClick={downloadInvite}><Icon name="calendar" size={15} />Calendar invite</button>
          <a className="btn btn-primary" href={mailto}><Icon name="mail" size={15} />Draft email</a>
        </div>
      </footer>
    </aside>
  </div>
}
