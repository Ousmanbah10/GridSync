import { timelineSummary } from './model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { pairDisplayLocations, selectedProjectLocations, opportunitiesAtLocation, filterProjects, filterOpportunities, ownerColor, distanceLabel, byProximity, OWNER_COLORS } from './model.js'
const rows = [
  { project_record_id: '1', project_name: 'North upgrade', owner: 'A', project_type: 'Upgrade', in_service_year: 2030, status: 'Planning', state_codes: ['GA'] },
  { project_record_id: '2', project_name: 'South line', owner: 'B', project_type: 'New', in_service_year: 2031, status: 'Permitting', state_codes: ['SC'] },
]
const filters = { owner: '', type: '', year: '', status: '', search: '' }
test('project filters combine and search state metadata', () => {
  assert.deepEqual(filterProjects(rows, {...filters, owner: 'A', year: '2030', search: 'ga'}), [rows[0]])
  assert.deepEqual(filterProjects(rows, {...filters, owner: 'A', year: '2031'}), [])
  assert.deepEqual(filterProjects(rows, filters), rows)
})
test('opportunity remains when either project passes filters', () => {
  const pairs = [{project_record_ids: ['1', '2']}, {project_record_ids: ['3', '4']}]
  assert.deepEqual(filterOpportunities(pairs, rows), [pairs[0]])
  assert.deepEqual(filterOpportunities(pairs, [rows[0]]), [pairs[0]])
})
test('owner color stays stable across filtered subsets', () => {
  assert.equal(ownerColor('B', ['A', 'B']), OWNER_COLORS[1])
  assert.equal(ownerColor(null, ['A', 'B']), '#7a8494')
})


test('clicked substation selects only its endpoint pairs, sorted by distance', () => {
  const first = {id: 'a', project_record_ids: ['1', '2'], distance_km: 5,
    closest_substation_coordinates: [[-82, 32], [-82.01, 32]]}
  const closer = {...first, id: 'b', distance_km: 1}
  const elsewhere = {...first, id: 'c', closest_substation_coordinates: [[-84, 34], [-84.01, 34]]}
  const unrelated = {...first, id: 'd', project_record_ids: ['3', '4']}
  assert.deepEqual(opportunitiesAtLocation([first, elsewhere, unrelated, closer],
    {projectIds: ['1'], coordinates: [-82, 32]}), [closer, first])
  assert.deepEqual(opportunitiesAtLocation([first], {projectIds: ['2'], coordinates: [-82.01, 32]}), [first])
  assert.deepEqual(opportunitiesAtLocation([first], {projectIds: ['1'], coordinates: [0, 0]}), [])
  assert.deepEqual(opportunitiesAtLocation([first], null), [])
})


test('pair framing includes both projects beyond their shared closest station', () => {
  const feature = (id, coordinates) => ({properties: {project_record_id: id}, geometry: {type: 'Point', coordinates}})
  const data = {project_locations: {features: [
    feature('a', [-95, 46]), feature('a', [-97, 45]), feature('b', [-93, 44]), feature('other', [0, 0]),
  ]}}
  const pair = {project_record_ids: ['a', 'b'], closest_substation_coordinates: [[-95, 46], [-95, 46]]}
  assert.deepEqual(selectedProjectLocations(data, pair), [
    {point: [-95, 46], index: 0}, {point: [-97, 45], index: 0},
    {point: [-93, 44], index: 1}, {point: [-95, 46], index: 1},
  ])
  assert.deepEqual(selectedProjectLocations(data, null), [])
})


test('one label per project uses distinct real locations when available', () => {
  const sharedA = {point: [-95, 46], index: 0}
  const sharedB = {point: [-95, 46], index: 1}
  const ownA = {point: [-97, 45], index: 0}
  const ownB = {point: [-93, 44], index: 1}
  assert.deepEqual(pairDisplayLocations([sharedA, ownA, sharedB, ownB]), [ownA, ownB])
  assert.deepEqual(pairDisplayLocations([sharedA, sharedB]), [sharedA, sharedB])
  assert.deepEqual(pairDisplayLocations([]), [])
})

test('shared substation pairs are labeled, not shown as 0.00 mi', () => {
  const shared = {distance_km: 112.46, distance_basis: 'other_endpoints', shared_substations: ['Valley']}
  assert.equal(distanceLabel(shared), 'Shares Valley · other ends 69.9 mi apart')
  assert.equal(distanceLabel({distance_km: 0, distance_basis: 'shared_substation_only', shared_substations: ['Woodside']}), 'Shares Woodside')
  assert.equal(distanceLabel({distance_km: 0, distance_basis: 'approximate_corridor', corridor_crossing: true}), 'Corridors cross (approx.)')
  assert.equal(distanceLabel({distance_km: 3.24, distance_basis: 'substation'}), '2.0 mi')
})


test('projected timelines use both completion targets without inventing overlap', () => {
  assert.equal(timelineSummary({in_service_years: [2030, 2028]}).value, '2028–2030')
  assert.match(timelineSummary({in_service_years: [2030, 2028]}).detail, /by 2030/)
  assert.equal(timelineSummary({in_service_years: [2030, 2030]}).value, 'Both targeted for 2030')
  assert.equal(timelineSummary({in_service_years: [null, 2030]}).value, 'One target: 2030')
  assert.equal(timelineSummary({in_service_years: [null, null]}).value, 'Years not supplied')
  assert.equal(timelineSummary({timeline: {overlap: false}, in_service_years: [2030, 2030]}).value, 'No construction overlap')
  assert.equal(timelineSummary({timeline: {overlap: true, overlap_days: 60}}).value, '60 days overlap')
})

test('pairs rank by distance, and longer construction overlap breaks ties', () => {
  const far = {distance_km: 30}, near = {distance_km: 4}, nearLonger = {distance_km: 4, timeline: {overlap_days: 300}}
  assert.deepEqual([far, near, nearLonger].sort(byProximity), [nearLonger, near, far])
})
