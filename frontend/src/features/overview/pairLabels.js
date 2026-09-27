import { PAIR_COLORS } from './model.js'
// Labels use actual endpoint coordinates; offsets only position the text.
export function showPairLabels(maps, map, opportunity, locations) {
  const entries = locations || (opportunity?.closest_substation_coordinates || []).map((point, index) => ({point, index}))
  class Label extends maps.OverlayView {
    constructor(point, index) { super(); this.point = point; this.index = index; this.setMap(map) }
    onAdd() {
      this.element = document.createElement('div')
      this.element.className = 'pair-map-label'
      this.element.style.borderColor = PAIR_COLORS[this.index ? 1 : 0]
      this.element.textContent = `${this.index ? 'B' : 'A'} · ${opportunity.project_names?.[this.index] || 'Project'}`
      this.element.title = this.element.textContent
      this.getPanes().floatPane.appendChild(this.element)
    }
    draw() {
      const p = this.getProjection().fromLatLngToDivPixel(new maps.LatLng(this.point[1], this.point[0]))
      this.element.style.left = `${p.x}px`
      this.element.style.top = `${p.y + (entries.some(entry => entry.index !== this.index && entry.point.every((n, i) => n === this.point[i])) && this.index ? 24 : -44)}px`
    }
    onRemove() { this.element?.remove() }
  }
  const labels = entries.map(({point, index}) => new Label(point, index))
  return () => labels.forEach(label => label.setMap(null))
}
