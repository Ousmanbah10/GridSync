// CSS animates the halos; no animation loop or extra API requests are needed.
export const PULSE_MIN_ZOOM = 9
const MAX_HALOS = 120

export function createSubstationPulse(map, maps) {
  let matchesFilter = () => true
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  class PulseOverlay extends maps.OverlayView {
    onAdd() {
      this.layer = document.createElement('div')
      this.layer.className = 'substation-pulse-layer'
      this.layer.setAttribute('aria-hidden', 'true')
      this.nodes = new Map()
      this.getPanes().overlayLayer.appendChild(this.layer)
      this.onScreen = true
      this.updateVisibility = () => {
        this.layer.hidden = document.hidden || !this.onScreen
      }
      document.addEventListener('visibilitychange', this.updateVisibility)
      this.motionChanged = () => this.draw()
      reducedMotion.addEventListener('change', this.motionChanged)
      this.zoomListener = map.addListener('zoom_changed', () => this.draw())
      if (window.IntersectionObserver) {
        this.observer = new IntersectionObserver(([entry]) => {
          this.onScreen = entry.isIntersecting
          this.updateVisibility()
        })
        this.observer.observe(map.getDiv())
      }
      this.updateVisibility()
    }

    draw() {
      if (!this.layer) return
      const projection = this.getProjection()
      const bounds = map.getBounds()
      const active = new Set()
      const positions = new Set()
      if (!reducedMotion.matches && map.getZoom() >= PULSE_MIN_ZOOM && projection && bounds) {
        map.data.forEach(feature => {
          if (active.size >= MAX_HALOS || !matchesFilter(feature)) return
          const geometry = feature.getGeometry()
          if (geometry?.getType() !== 'Point') return
          const point = geometry.get()
          if (!bounds.contains(point)) return
          // Coincident source records share a single halo.
          const positionKey = `${point.lat()},${point.lng()}`
          if (positions.has(positionKey)) return
          positions.add(positionKey)
          const pixel = projection.fromLatLngToDivPixel(point)
          if (!pixel) return
          const id = feature.getId()
          active.add(id)
          let node = this.nodes.get(id)
          if (!node) {
            node = document.createElement('span')
            node.className = 'substation-pulse'
            node.style.animationDelay = `${-(active.size % 8) * 0.2}s`
            this.layer.appendChild(node)
            this.nodes.set(id, node)
          }
          node.style.left = `${pixel.x}px`
          node.style.top = `${pixel.y}px`
        })
      }
      for (const [id, node] of this.nodes) {
        if (!active.has(id)) {
          node.remove()
          this.nodes.delete(id)
        }
      }
    }

    onRemove() {
      this.zoomListener?.remove()
      this.observer?.disconnect()
      document.removeEventListener('visibilitychange', this.updateVisibility)
      reducedMotion.removeEventListener('change', this.motionChanged)
      this.layer?.remove()
      this.nodes?.clear()
      this.layer = null
    }
  }

  const overlay = new PulseOverlay()
  overlay.setMap(map)
  return {
    setFilter(predicate) {
      matchesFilter = predicate
      overlay.draw()
    },
    destroy() { overlay.setMap(null) },
  }
}
