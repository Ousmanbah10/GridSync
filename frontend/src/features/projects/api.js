export async function request(url, options = {}) {
  const response = await fetch(url, options)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}
export function post(url, data, csrf) {
  return request(url, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRFToken': csrf},
    body: JSON.stringify(data)})
}
export const sourceUrl = value => {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? value : null } catch { return null }
}
export const fieldLabel = value => ({
  construction_start: 'Construction start', construction_end: 'Construction end',
  in_service: 'In-service target', budget: 'Published budget', state_permitting: 'State permitting',
  federal_permitting: 'Federal permitting', project_status: 'Project status',
}[value] || value)
