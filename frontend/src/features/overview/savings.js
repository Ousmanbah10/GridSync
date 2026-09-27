// Rough cost/impact estimate for coordinating one pair. Every figure comes from an
// adjustable planning assumption below; nothing here is a utility number.
import { KM_PER_MILE } from './model.js'

const SQFT_PER_ACRE = 43560

export const DEFAULT_ASSUMPTIONS = {
  mobilizationPct: 6,      // % of the smaller project's budget spent on mobilizing crews and equipment
  yardCost: 350000,        // $ to lease, grade, fence, and restore one laydown yard
  yardAcres: 5,            // acres per laydown yard
  rowWidthFt: 150,         // right-of-way width for a shared corridor
  sharedRowMiles: 1,       // miles of corridor the two projects could share
  landPerAcre: 12000,      // $ per acre of easement
  substationOutage: 200000, // $ saved by one coordinated outage and bay work at a shared substation
}

export const ASSUMPTION_FIELDS = [
  ['mobilizationPct', 'Mobilization share of smaller budget', '%', 2, 12, 0.5],
  ['yardCost', 'Cost of one laydown yard', '$', 100000, 1000000, 25000],
  ['yardAcres', 'Laydown yard size', 'acres', 1, 15, 1],
  ['rowWidthFt', 'Right-of-way width', 'ft', 75, 250, 5],
  ['sharedRowMiles', 'Shared corridor length', 'mi', 0.25, 5, 0.25],
  ['landPerAcre', 'Easement cost per acre', '$', 3000, 50000, 1000],
  ['substationOutage', 'Coordinated substation outage', '$', 50000, 600000, 25000],
]

// How much of a saving is realistic given the schedules: overlapping windows make sharing practical.
export function scheduleFactor(timeline) {
  if (timeline?.overlap === true) return {factor: 1, label: 'Construction windows overlap'}
  if (timeline?.overlap === false) return {factor: 0, label: 'No overlap today; savings need one schedule to move'}
  return {factor: 0.5, label: 'Schedules unconfirmed; counted at half'}
}

export function estimateSavings(opportunity, projects, assumptions = DEFAULT_ASSUMPTIONS, enabled = {}) {
  const a = {...DEFAULT_ASSUMPTIONS, ...assumptions}
  const mi = (opportunity?.distance_km ?? Infinity) / KM_PER_MILE
  const shared = (opportunity?.shared_substations || []).length > 0
  const budgets = projects.map(p => Number(p?.project_cost?.amount)).filter(n => Number.isFinite(n) && n > 0)
  const smaller = budgets.length === 2 ? Math.min(...budgets) : null
  const combined = budgets.length === 2 ? budgets[0] + budgets[1] : null
  const rowAcres = a.rowWidthFt * a.sharedRowMiles * 5280 / SQFT_PER_ACRE
  const schedule = scheduleFactor(opportunity?.timeline)
  const levers = [
    {id: 'mobilization', title: 'Shared crews & equipment', applies: mi < 25 && smaller != null,
     reason: smaller == null ? 'Needs both budgets' : `One mobilization instead of two: ${a.mobilizationPct}% of the smaller budget`,
     amount: smaller == null ? 0 : smaller * a.mobilizationPct / 100, acres: 0, timed: true},
    {id: 'yard', title: 'Shared laydown yard', applies: mi < 5,
     reason: mi < 5 ? `One ${a.yardAcres}-acre staging yard instead of two` : 'Projects are more than 5 miles apart',
     amount: a.yardCost, acres: a.yardAcres, timed: true},
    {id: 'row', title: 'Shared right-of-way', applies: mi < 1,
     reason: mi < 1 ? `${a.sharedRowMiles} mi of ${a.rowWidthFt}-ft corridor = ${rowAcres.toFixed(1)} acres` : 'Projects are more than 1 mile apart',
     amount: rowAcres * a.landPerAcre, acres: rowAcres, timed: false},
    {id: 'substation', title: 'Coordinated substation outage', applies: shared,
     reason: shared ? `Both connect at ${opportunity.shared_substations.join(', ')}` : 'No shared substation',
     amount: a.substationOutage, acres: 0, timed: true},
  ].map(lever => {
    const on = lever.applies && enabled[lever.id] !== false
    // Land is saved regardless of timing; crew, yard, and outage sharing depend on overlapping schedules.
    const realized = on ? lever.amount * (lever.timed ? schedule.factor : 1) : 0
    return {...lever, on, realized}
  })
  const total = levers.reduce((sum, l) => sum + l.realized, 0)
  const potential = levers.reduce((sum, l) => sum + (l.on ? l.amount : 0), 0)
  const acres = levers.reduce((sum, l) => sum + (l.on ? l.acres : 0), 0)
  return {levers, total, low: total * 0.7, high: total * 1.3, potential, acres, combined,
          percent: combined ? total / combined * 100 : null, schedule, miles: mi,
          illustrative: projects.some(p => p?.project_cost?.basis === 'illustrative')}
}
