import { PAIR_COLORS } from './model.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { drawOpportunityLines } from './opportunityLines.js'

function mapStub() {
  const overlays = []
  class Overlay {
    constructor(options) { this.options = options; overlays.push(this) }
    addGeoJson(feature) { this.feature = feature }
    setStyle(style) { this.style = style }
    addListener(event, handler) {
      this.click = handler
      return {remove: () => { this.listenerRemoved = true }}
    }
    setMap(map) { this.map = map }
  }
  return {maps: {Polyline: Overlay, Data: Overlay, SymbolPath: {CIRCLE: 0}}, overlays}
}
test('connects both real endpoints, selects the exact pair, and removes overlays', () => {
  const {maps, overlays} = mapStub()
  let selected
  const cleanup = drawOpportunityLines(maps, {}, [
    {id: 'pair', closest_substation_coordinates: [[-82, 32], [-82.1, 32.1]]},
  ], 'pair', id => { selected = id })
  assert.deepEqual(overlays[0].options.path, [{lng: -82, lat: 32}, {lng: -82.1, lat: 32.1}])
  assert.equal(overlays[0].options.icons[0].icon.fillColor, PAIR_COLORS[0])
  overlays[0].click()
  assert.equal(selected, 'pair')
  cleanup()
  assert.equal(overlays[0].map, null)
  assert.equal(overlays[0].listenerRemoved, true)
})
test('shared coordinates get a ring without inventing a second location', () => {
  const {maps, overlays} = mapStub()
  drawOpportunityLines(maps, {}, [
    {id: 'shared', closest_substation_coordinates: [[0, 0], [0, 0]]},
    {id: 'missing', closest_substation_coordinates: null},
  ], 'shared', () => {})
  assert.equal(overlays.length, 1)
  assert.deepEqual(overlays[0].feature.geometry.coordinates, [0, 0])
  assert.equal(overlays[0].options.path, undefined)
})


test('selected visual connector uses the labeled locations without modifying measured coordinates', () => {
  const {maps, overlays} = mapStub()
  const pair = {id: 'shared', closest_substation_coordinates: [[0, 0], [0, 0]]}
  drawOpportunityLines(maps, {}, [pair], 'shared', () => {}, [[-97, 45], [-95, 46]])
  assert.deepEqual(overlays[0].options.path, [{lng: -97, lat: 45}, {lng: -95, lat: 46}])
  assert.deepEqual(pair.closest_substation_coordinates, [[0, 0], [0, 0]])
})
