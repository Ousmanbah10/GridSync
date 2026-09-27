import { PAIR_COLORS, SIGNAL_COLOR } from './model.js'
// Proximity connectors, not surveyed transmission routes.
export function drawOpportunityLines(maps, map, opportunities, selectedId, onSelect, displayPoints = null) {
  const lines = opportunities.flatMap(opportunity => {
    const points = opportunity.id === selectedId && displayPoints?.length === 2 ? displayPoints : opportunity.closest_substation_coordinates
    if (!points || points.length !== 2 || points.some(p => p.length !== 2 || !p.every(Number.isFinite))) return []
    const selected = opportunity.id === selectedId
    if (points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
      // Shared coordinates have no drawable separation. Keep a clickable ring
      // at the true location rather than inventing a second project location.
      const line = new maps.Data({map})
      line.addGeoJson({type: 'Feature', geometry: {type: 'Point', coordinates: points[0]}, properties: {}})
      line.setStyle({icon: {path: maps.SymbolPath.CIRCLE, scale: selected ? 21 : 16,
        fillOpacity: 0, strokeColor: selected ? PAIR_COLORS[0] : SIGNAL_COLOR, strokeWeight: 3}, zIndex: 5})
      const listener = line.addListener('click', () => onSelect(opportunity.id))
      return [{line, listener}]
    }
    const line = new maps.Polyline({
      map, geodesic: true, path: points.map(([lng, lat]) => ({lng, lat})),
      strokeColor: selected ? PAIR_COLORS[0] : SIGNAL_COLOR, strokeOpacity: .18, strokeWeight: 3, zIndex: selected ? 7 : 4,
      icons: [{icon: {path: maps.SymbolPath.CIRCLE, scale: selected ? 3.5 : 2.8,
        fillColor: selected ? PAIR_COLORS[0] : SIGNAL_COLOR, fillOpacity: 1,
        strokeWeight: 0}, offset: '0', repeat: '9px'}],
    })
    const listener = line.addListener('click', () => onSelect(opportunity.id))
    return [{line, listener}]
  })
  return () => lines.forEach(({line, listener}) => {listener.remove(); line.setMap(null)})
}
