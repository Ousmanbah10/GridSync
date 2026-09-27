import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateSavings, DEFAULT_ASSUMPTIONS } from './savings.js'

const km = mi => mi * 1.609344
const projects = [{project_cost: {amount: 23787423}}, {project_cost: {amount: 9400000, basis: 'illustrative'}}]

test('3 miles apart with overlapping windows: crews and yard, no right-of-way', () => {
  const r = estimateSavings({distance_km: km(3), timeline: {overlap: true}}, projects)
  assert.deepEqual(r.levers.filter(l => l.on).map(l => l.id), ['mobilization', 'yard'])
  assert.equal(r.total, 9400000 * 0.06 + DEFAULT_ASSUMPTIONS.yardCost)
  assert.equal(r.illustrative, true)
  assert.ok(r.percent > 2 && r.percent < 3.5)
})

test('no schedule overlap keeps land savings but not crew or yard savings', () => {
  const r = estimateSavings({distance_km: km(0.5), timeline: {overlap: false}}, projects)
  assert.equal(r.levers.find(l => l.id === 'mobilization').realized, 0)
  assert.ok(r.levers.find(l => l.id === 'row').realized > 0)
  assert.ok(r.potential > r.total)
})

test('missing budget disables the budget-based lever and user toggles are respected', () => {
  const r = estimateSavings({distance_km: km(3), timeline: {overlap: true}}, [{}, projects[1]], undefined, {yard: false})
  assert.equal(r.total, 0)
  assert.equal(r.percent, null)
})
