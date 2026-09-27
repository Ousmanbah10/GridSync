export const OWNER_COLORS = ['#2563eb', '#ea7a1a', '#7c3aed', '#0d9488', '#db2777', '#475569']
// Project A / project B of a selected pair, on the map and in every panel.
export const PAIR_COLORS = ['#2563eb', '#ea7a1a']
export const SIGNAL_COLOR = '#e0413a'
export const uniqueValues = (records, field) => [...new Set(records.map(p => p[field]).filter(v => v != null && v !== ''))].sort((a, b) => String(a).localeCompare(String(b)))
export function filterProjects(records, filters) {
  const query = filters.search.trim().toLowerCase()
  return records.filter(p => (!filters.owner || p.owner === filters.owner) &&
    (!filters.type || p.project_type === filters.type) && (!filters.year || String(p.in_service_year) === filters.year) &&
    (!filters.status || p.status === filters.status) && (!query ||
      [p.project_name, p.owner, p.record_id, ...(p.state_codes || [])].join(' ').toLowerCase().includes(query)))
}
export function filterOpportunities(records, projects) {
  const ids = new Set(projects.map(p => p.project_record_id))
  return records.filter(o => o.project_record_ids.some(id => ids.has(id)))
}
export function ownerColor(owner, owners) {
  const index = owners.indexOf(owner)
  return index < 0 ? '#7a8494' : OWNER_COLORS[index % OWNER_COLORS.length]
}
export const bandName = band => ({touching_crossing: 'Mapped route crossing', shared_substation: 'Shared substation', shared_land: 'Shared land candidate', shared_logistics: 'Shared logistics candidate', shared_crews_equipment: 'Shared crews & equipment'}[band] || 'Spatial candidate')

// Coordination score (proximity + timeline + compatibility); falls back to older saved rows.
export const scoreOf = o => o?.coordination_score ?? o?.distance_score ?? 0

// Human wording for a pair's separation. A shared substation is not "0.00 km apart".
export function distanceLabel(o) {
  if (!o) return ''
  const km = `${o.distance_km.toFixed(1)} km`
  if (o.shared_substations?.length) {
    const hub = `Shares ${o.shared_substations.join(', ')}`
    return o.distance_basis === 'other_endpoints' ? `${hub} · other ends ${km} apart` : hub
  }
  if (o.distance_basis === 'approximate_corridor') return o.corridor_crossing ? 'Corridors cross (approx.)' : `${km} (approx. corridor)`
  return km
}

export const basisLabel = o => ({route: 'Route geometry', other_endpoints: 'Shared substation; distance between the other ends',
  shared_substation_only: 'Shared substation; other ends not mapped', approximate_corridor: 'Straight line between terminal substations (approximate)',
  substation: 'Closest substations'}[o?.distance_basis] || 'Substation proximity')

export function timelineSummary(opportunity) {
  const timeline = opportunity?.timeline
  if (timeline?.overlap != null) return {
    title: 'Construction overlap',
    value: timeline.overlap ? `${timeline.overlap_days} days overlap` : 'No construction overlap',
    detail: timeline.overlap ? `${timeline.start_date} → ${timeline.end_date}` : 'Based on supplied construction dates.',
  }
  const years = opportunity?.in_service_years || []
  const valid = year => Number.isInteger(year) && year >= 1900 && year <= 2200
  if (years.length === 2 && years.every(valid)) {
    const [first, last] = [...years].sort((a, b) => a - b)
    return {title: 'Projected timeline',
      value: first === last ? `Both targeted for ${last}` : `${first}–${last}`,
      detail: `Both projected in service by ${last}. Completion targets only; construction overlap is unconfirmed.`}
  }
  if (years.some(valid)) return {title: 'Projected timeline',
    value: `One target: ${years.find(valid)}`, detail: 'The other project has no supplied in-service year. Construction overlap is unconfirmed.'}
  return {title: 'Projected timeline', value: 'Years not supplied',
    detail: 'Neither construction intervals nor both in-service targets are available.'}
}
export function timelineLabel(opportunity) { return timelineSummary(opportunity).value }

// Match the clicked endpoint, not another substation on the same long project.
export function opportunitiesAtLocation(opportunities, location) {
  if (!location) return []
  return opportunities.filter(o => o.project_record_ids.some((id, index) => {
    const point = o.closest_substation_coordinates?.[index]
    return location.projectIds.includes(id) && point &&
      Math.abs(point[0] - location.coordinates[0]) < 1e-6 &&
      Math.abs(point[1] - location.coordinates[1]) < 1e-6
  })).sort((a, b) => a.distance_km - b.distance_km || a.id.localeCompare(b.id))
}

export function selectedProjectLocations(data, opportunity) {
  if (!opportunity) return []
  const locations = []
  opportunity.project_record_ids.forEach((id, index) => {
    const seen = new Set()
    const points = (data?.project_locations?.features || [])
      .filter(f => f.properties.project_record_id === id && f.geometry.type === 'Point')
      .map(f => f.geometry.coordinates)
    const closest = opportunity.closest_substation_coordinates?.[index]
    if (closest) points.push(closest)
    points.forEach(point => {
      const key = point.join(',')
      if (!seen.has(key)) { seen.add(key); locations.push({point, index}) }
    })
  })
  return locations
}

// One label per project, preferring its own distinct mapped location.
export function pairDisplayLocations(locations) {
  return [0, 1].flatMap(index => {
    const own = locations.filter(location => location.index === index)
    const other = locations.filter(location => location.index !== index)
    const distinct = own.find(location => !other.some(candidate =>
      candidate.point.every((n, i) => n === location.point[i])))
    return distinct ? [distinct] : own.slice(0, 1)
  })
}

export const priorityLabel = o => (o?.priority ?? 9) <= 2 ? ['High priority', 'chip-signal'] : o?.priority === 3 ? ['Medium priority', 'chip-warn'] : ['Exploratory', 'chip']
// Short schedule line for list rows and the timeline card.
export function overlapLabel(o) {
  const t = o?.timeline
  if (t?.overlap && t.overlap_days != null) return `${Math.max(1, Math.round(t.overlap_days / 30.4))} months overlap`
  return timelineSummary(o).value
}
