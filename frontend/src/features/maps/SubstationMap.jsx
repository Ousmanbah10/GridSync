import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from './googleMapsLoader'
import { createSubstationPulse } from './substationPulse'
import './SubstationMap.css'

const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()

export default function SubstationMap() {
  const container = useRef(null)
  const controller = useRef(null)
  const [status, setStatus] = useState('Loading map and substations…')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [sources, setSources] = useState([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!apiKey) return
    let disposed = false
    let map, info, clickListener, pulse
    const abort = new AbortController()
    const oldAuthHandler = window.gm_authFailure
    window.gm_authFailure = () => {
      if (!disposed) setError('Google rejected the map credentials. Check billing, Maps JavaScript API access, and website restrictions in Google Cloud Console, then reload.')
    }
    const dataPromise = fetch('/api/map/substations/', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('Substation data could not be loaded. Check the Django server and MongoDB connection.')
      return response.json()
    })
    Promise.all([loadGoogleMaps(apiKey), dataPromise]).then(([maps, data]) => {
      if (disposed) return
      map = new maps.Map(container.current, {
        center: { lat: 38.5, lng: -97.5 }, zoom: 4, mapTypeId: 'roadmap',
        streetViewControl: false, mapTypeControl: true, fullscreenControl: true,
        gestureHandling: 'cooperative',
      })
      map.data.addGeoJson(data)
      map.data.setStyle({
        icon: { path: maps.SymbolPath.CIRCLE, scale: 5, fillColor: '#176bdf', fillOpacity: 0.85,
          strokeColor: '#ffffff', strokeWeight: 1.5 },
      })
      info = new maps.InfoWindow()
      clickListener = map.data.addListener('click', event => {
        const feature = event.feature
        const content = document.createElement('div')
        content.className = 'substation-info'
        const title = document.createElement('strong')
        title.textContent = feature.getProperty('name')
        content.appendChild(title)
        const voltage = feature.getProperty('voltage_max_kv')
        const detail = document.createElement('p')
        detail.textContent = `${feature.getProperty('substation_id') || 'Unknown ID'} · ${feature.getProperty('state_code') || 'Unknown state'} · ${voltage == null ? 'Unknown voltage' : `${voltage} kV`}`
        content.appendChild(detail)
        const provenance = document.createElement('small')
        provenance.textContent = `${feature.getProperty('source_sheet') || 'Source'} · row ${feature.getProperty('source_row') ?? 'unknown'}`
        content.appendChild(provenance)
        info.setContent(content)
        info.setPosition(event.latLng)
        info.open({ map, shouldFocus: false })
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) map.panTo(event.latLng)
      })
      pulse = createSubstationPulse(map, maps)
      controller.current = { map, maps, info, pulse }
      const uniqueSources = [...new Set(data.features.map(f => f.properties.source_id).filter(Boolean))]
      setSources(uniqueSources)
      setLoaded(true)
      setStatus(`${data.features.length.toLocaleString()} substation records loaded${data.skipped_coordinates ? ` · ${data.skipped_coordinates} omitted without valid coordinates` : ''}.`)
    }).catch(err => {
      if (!disposed && err.name !== 'AbortError') setError(err.message)
    })
    return () => {
      disposed = true
      abort.abort()
      window.gm_authFailure = oldAuthHandler
      clickListener?.remove()
      pulse?.destroy()
      info?.close()
      if (map) {
        map.data.forEach(feature => map.data.remove(feature))
        window.google.maps.event.clearInstanceListeners(map)
      }
      controller.current = null
    }
  }, [])

  useEffect(() => {
    const current = controller.current
    if (!current) return
    current.info.close()
    const matches = feature => {
      const searchable = `${feature.getProperty('name')} ${feature.getProperty('state_code')} ${feature.getProperty('substation_id')}`.toLowerCase()
      return searchable.includes(search.toLowerCase()) && (!source || source === feature.getProperty('source_id'))
    }
    current.map.data.forEach(feature => {
      current.map.data.overrideStyle(feature, { visible: matches(feature) })
    })
    current.pulse.setFilter(matches)
  }, [search, source, loaded])

  function fitVisible() {
    const current = controller.current
    if (!current) return
    const bounds = new current.maps.LatLngBounds()
    current.map.data.forEach(feature => {
      const searchable = `${feature.getProperty('name')} ${feature.getProperty('state_code')} ${feature.getProperty('substation_id')}`.toLowerCase()
      if (searchable.includes(search.toLowerCase()) && (!source || source === feature.getProperty('source_id'))) {
        bounds.extend(feature.getGeometry().get())
      }
    })
    if (!bounds.isEmpty()) current.map.fitBounds(bounds, 50)
  }

  return <section className="panel map-panel" id="substation-map" aria-label="Google substation map">
    <div className="panel-heading"><div><h2>Substation map</h2><p>Your recorded locations, on Google Maps. Zoom in for animated highlights. Click a point to see its details.</p></div><span className="step-label">GOOGLE MAPS</span></div>
    {!apiKey ? <div className="map-setup"><span aria-hidden="true">◎</span><h3>Ready for your Google Maps key</h3><p>Enable Maps JavaScript API in Google Cloud Console, then add your restricted browser key to <code>frontend/.env.local</code> as <code>VITE_GOOGLE_MAPS_API_KEY</code> and restart the frontend.</p><a href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noreferrer">Open Google Cloud Console ↗</a></div> : <>
      <div className="map-controls"><input aria-label="Filter substations by name, ID or state" placeholder="Search name, ID or state…" value={search} onChange={e => setSearch(e.target.value)} disabled={!loaded} />
        {sources.length > 1 && <select aria-label="Source snapshot" value={source} onChange={e => setSource(e.target.value)}><option value="">All source snapshots</option>{sources.map((s, i) => <option key={s} value={s}>Snapshot {i + 1} · {s.slice(5, 13)}</option>)}</select>}
        <button className="button secondary" onClick={fitVisible} disabled={!loaded}>Fit visible points</button>
      </div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <div ref={container} className="google-map-canvas" aria-label="Interactive map of substations" />
      <p className="map-caption" role="status">{error ? 'Map setup needs attention.' : status} Points show substations, not transmission routes. Source rows sharing coordinates can overlap.</p>
    </>}
  </section>
}
