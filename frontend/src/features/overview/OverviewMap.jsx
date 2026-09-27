import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../maps/googleMapsLoader'
import { createSubstationPulse } from '../maps/substationPulse'
import { showPairLabels } from './pairLabels'
import { drawOpportunityLines } from './opportunityLines'
import { ownerColor, selectedProjectLocations, pairDisplayLocations, PAIR_COLORS, SIGNAL_COLOR } from './model'
import '../maps/SubstationMap.css'
const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

export default function OverviewMap({ data, projects, opportunities, selected, layers, owners, fitRequest, focusRequest, closeRequest, onClose, onLocation, onSelect }) {
  const canvas = useRef(null)
  const api = useRef(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  const select = useRef(onSelect)
  const locationSelect = useRef(onLocation)
  const perspective = useRef(true)
  const [is3D, setIs3D] = useState(true)
  const [vectorAvailable, setVectorAvailable] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { select.current = onSelect }, [onSelect])
  useEffect(() => { locationSelect.current = onLocation }, [onLocation])
  useEffect(() => {
    if (!key) return
    let cancelled = false, map, info, pulse, projectLayer, routeLayer, overlapLayer, selectedLayer
    let listeners = [], frameListener
    const previousAuth = window.gm_authFailure
    window.gm_authFailure = () => { if (!cancelled) setError('Google Maps could not authorize this key. Check billing and website restrictions, then reload.') }
    loadGoogleMaps(key).then(maps => {
      if (cancelled) return
      map = new maps.Map(canvas.current, {
        center: { lat: 37.4, lng: -96.5 }, zoom: 4, gestureHandling: 'cooperative',
        renderingType: maps.RenderingType.VECTOR, tilt: 45, heading: 0,
        tiltInteractionEnabled: true, headingInteractionEnabled: true,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
        fullscreenControlOptions: { position: maps.ControlPosition.RIGHT_TOP },
        zoomControlOptions: { position: maps.ControlPosition.RIGHT_BOTTOM }, scaleControl: true,
      })
      info = new maps.InfoWindow()
      projectLayer = new maps.Data({ map })
      routeLayer = new maps.Data({ map })
      overlapLayer = new maps.Data({ map })
      selectedLayer = new maps.Data({ map })
      pulse = createSubstationPulse(map, maps)
      const showInfo = event => {
        const feature = event.feature
        const point = feature.getGeometry().get()
        locationSelect.current({
          name: feature.getProperty('project_name') || feature.getProperty('name'),
          projectIds: feature.getProperty('project_record_ids') || [feature.getProperty('project_record_id')],
          coordinates: [point.lng(), point.lat()],
        })
        const content = document.createElement('div')
        content.className = 'substation-info'
        const title = document.createElement('strong')
        title.textContent = feature.getProperty('project_name') || feature.getProperty('name')
        const text = document.createElement('p')
        text.textContent = feature.getProperty('owner') || [feature.getProperty('substation_id'), feature.getProperty('state_code')].filter(Boolean).join(' · ')
        content.append(title, text)
        info.setContent(content); info.setPosition(event.latLng); info.open({ map })
      }
      const syncRendering = () => setVectorAvailable(map.getRenderingType() === maps.RenderingType.VECTOR)
      syncRendering()
      const frame = (bounds, padding) => {
        // fitBounds resets vector tilt. Restore the requested perspective after fitting.
        frameListener?.remove()
        frameListener = maps.event.addListenerOnce(map, 'idle', () => {
          if (!cancelled && perspective.current && map.getRenderingType() === maps.RenderingType.VECTOR) map.setTilt(45)
        })
        map.fitBounds(bounds, padding)
      }
      listeners = [map.addListener('renderingtype_changed', syncRendering), info.addListener('closeclick', () => close.current()), map.data.addListener('click', showInfo), projectLayer.addListener('click', showInfo), selectedLayer.addListener('click', showInfo),
        overlapLayer.addListener('click', event => {
          const point = event.feature.getGeometry().get()
          locationSelect.current({name: 'Selected nearby location', coordinates: [point.lng(), point.lat()],
            projectIds: event.feature.getProperty('project_record_ids') || []})
        })]
      api.current = { map, maps, frame, projectLayer, routeLayer, overlapLayer, selectedLayer, info, pulse }
      setReady(true)
    }).catch(err => { if (!cancelled) setError(err.message) })
    return () => {
      cancelled = true; window.gm_authFailure = previousAuth
      frameListener?.remove(); listeners.forEach(l => l.remove()); pulse?.destroy(); info?.close()
      selectedLayer?.setMap(null); projectLayer?.setMap(null); routeLayer?.setMap(null); overlapLayer?.setMap(null)
      if (map) { map.data.forEach(f => map.data.remove(f)); window.google.maps.event.clearInstanceListeners(map) }
      api.current = null
    }
  }, [])
  useEffect(() => {
    const current = api.current
    if (!current || !data) return
    for (const [layer, collection] of [[current.map.data, data.substations], [current.projectLayer, data.project_locations], [current.routeLayer, data.routes]]) {
      layer.forEach(f => layer.remove(f)); layer.addGeoJson(collection)
    }
    const bounds = new current.maps.LatLngBounds()
    current.map.data.forEach(f => bounds.extend(f.getGeometry().get()))
    if (!bounds.isEmpty()) current.frame(bounds, 55)
  }, [data, ready])
  useEffect(() => {
    const current = api.current
    if (!current || !data) return
    const ids = new Set(projects.map(p => p.project_record_id))
    const pairIds = selected?.project_record_ids || []
    pairIds.forEach(id => ids.add(id))
    const pairColor = feature => {
      const index = pairIds.indexOf(feature.getProperty('project_record_id'))
      return index >= 0 ? PAIR_COLORS[index] : ownerColor(feature.getProperty('owner'), owners)
    }
    const allProjects = projects.length === data.projects.length
    const stationVisible = feature => layers.substations && (allProjects || (feature.getProperty('project_record_ids') || []).some(id => ids.has(id)))
    current.map.data.setStyle(feature => ({ visible: stationVisible(feature), icon: {
      path: 'M 0,-5 5,4 -5,4 z', fillColor: '#fff', fillOpacity: 1, strokeColor: '#364152', strokeWeight: 1.5, scale: 1,
    }, zIndex: 2 }))
    current.pulse.setFilter(stationVisible)
    current.projectLayer.setStyle(feature => ({ visible: layers.projects && ids.has(feature.getProperty('project_record_id')), icon: {
      path: current.maps.SymbolPath.CIRCLE, fillColor: pairColor(feature),
      fillOpacity: 1, scale: 5.5, strokeColor: '#fff', strokeWeight: 1.5,
    }, zIndex: 3 }))
    current.routeLayer.setStyle(feature => ({ visible: layers.routes && ids.has(feature.getProperty('project_record_id')), strokeColor: pairColor(feature), strokeWeight: 2 }))
    current.overlapLayer.forEach(f => current.overlapLayer.remove(f))
    if (layers.overlaps) {
      // A single selectable highlight per coordinate.
      const seen = new Set()
      opportunities.forEach(o => (o.closest_substation_coordinates || []).forEach((point, index) => {
        const coordinateKey = point.join(',')
        if (seen.has(coordinateKey)) return
        seen.add(coordinateKey)
        current.overlapLayer.addGeoJson({ type: 'Feature', id: `${o.id}:${index}`, geometry: { type: 'Point', coordinates: point }, properties: { opportunity_id: o.id, project_record_ids: opportunities.flatMap(pair =>
          (pair.closest_substation_coordinates || []).flatMap((p, i) => p.join(',') === coordinateKey ? [pair.project_record_ids[i]] : [])) } })
      }))
    }
    current.overlapLayer.setStyle({ icon: { path: current.maps.SymbolPath.CIRCLE, scale: 13, fillColor: SIGNAL_COLOR, fillOpacity: .1, strokeColor: SIGNAL_COLOR, strokeWeight: 1.3 }, zIndex: 1 })
  }, [data, projects, opportunities, owners, layers, ready, selected])
  useEffect(() => {
    const current = api.current
    if (!current) return
    current.info.close()
    const locations = selectedProjectLocations(data, selected)
    const points = locations.map(location => location.point)
    current.selectedLayer.forEach(f => current.selectedLayer.remove(f))
    locations.forEach(({point, index}) => current.selectedLayer.addGeoJson({type: 'Feature', geometry: {type: 'Point', coordinates: point}, properties: {index, project_name: selected.project_names[index], project_record_id: selected.project_record_ids[index]}}))
    current.selectedLayer.setStyle(feature => ({icon: {path: current.maps.SymbolPath.CIRCLE, scale: points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1] ? (feature.getProperty('index') ? 8 : 15) : 10, fillColor: PAIR_COLORS[feature.getProperty('index')], fillOpacity: 1, strokeColor: PAIR_COLORS[feature.getProperty('index')], strokeWeight: 3}, zIndex: 8}))
    if (points.length) {
      const bounds = new current.maps.LatLngBounds()
      points.forEach(([lng, lat]) => bounds.extend({ lng, lat }))
      if (points.every(p => p[0] === points[0][0] && p[1] === points[0][1])) {
        current.map.setZoom(9)
        const target = {lng: points[0][0], lat: points[0][1]}
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) current.map.setCenter(target)
        else current.map.panTo(target)
      } else {
        const narrow = window.innerWidth <= 900
        current.frame(bounds, {top: 65, right: narrow ? 55 : 410, bottom: narrow ? 390 : 80, left: 55})
      }
    }
  }, [data, selected, focusRequest, ready])
  useEffect(() => {
    const current = api.current
    if (!current) return
    return drawOpportunityLines(current.maps, current.map, selected ? [selected] : layers.overlaps ? opportunities : [], selected?.id,
      id => select.current(id), selected ? pairDisplayLocations(selectedProjectLocations(data, selected)).map(location => location.point) : null)
  }, [data, opportunities, selected, layers.overlaps, ready])
  useEffect(() => {
    const current = api.current
    if (!current || !selected) return
    return showPairLabels(current.maps, current.map, selected, pairDisplayLocations(selectedProjectLocations(data, selected)))
  }, [data, selected, ready])
  useEffect(() => {
    const current = api.current
    if (!current || !closeRequest) return
    current.info.close()
    const bounds = new current.maps.LatLngBounds()
    current.projectLayer.forEach(feature => bounds.extend(feature.getGeometry().get()))
    current.map.data.forEach(feature => bounds.extend(feature.getGeometry().get()))
    if (!bounds.isEmpty()) current.frame(bounds, 55)
    else { current.map.setCenter({lat: 37.4, lng: -96.5}); current.map.setZoom(4) }
  }, [closeRequest])
  useEffect(() => {
    const current = api.current
    if (!current || !fitRequest) return
    const ids = new Set(projects.map(p => p.project_record_id))
    const bounds = new current.maps.LatLngBounds()
    current.projectLayer.forEach(f => { if (ids.has(f.getProperty('project_record_id'))) bounds.extend(f.getGeometry().get()) })
    if (!bounds.isEmpty()) current.frame(bounds, 70)
  }, [fitRequest, projects])
  function changePerspective(enabled) {
    perspective.current = enabled
    setIs3D(enabled)
    const current = api.current
    if (!current) return
    current.map.moveCamera({tilt: enabled ? 45 : 0, ...(!enabled ? {heading: 0} : {})})
  }
  function rotate(degrees) {
    const map = api.current?.map
    if (map) map.setHeading(((map.getHeading() || 0) + degrees + 360) % 360)
  }
  return <>
    {ready && <div className="map-perspective-controls" aria-label="Map perspective">
      <div><button aria-pressed={!is3D || !vectorAvailable} onClick={() => changePerspective(false)}>2D</button><button disabled={!vectorAvailable} aria-pressed={is3D && vectorAvailable} onClick={() => changePerspective(true)}>3D</button>
      <button disabled={!vectorAvailable} aria-label="Rotate map left" onClick={() => rotate(-30)}>↶</button><button disabled={!vectorAvailable} aria-label="Rotate map right" onClick={() => rotate(30)}>↷</button><button disabled={!vectorAvailable} onClick={() => api.current?.map.setHeading(0)}>North ↑</button></div>
      <small>{vectorAvailable ? 'Tilt & rotate · zoom closer for city detail' : 'This browser is using the 2D fallback'}</small>
    </div>}
    <div className="overview-canvas"  ref={canvas} aria-label="Utility projects Google map" />
    {(!key || error) && <div className="overview-map-message" role="status"><strong>{error ? 'Map unavailable' : 'Connect Google Maps'}</strong><p>{error || 'Add your Maps browser key to frontend/.env.local, then restart the frontend.'}</p></div>}
    {key && !ready && !error && <div className="overview-map-message" role="status">Loading Google Maps…</div>}
  </>
}
