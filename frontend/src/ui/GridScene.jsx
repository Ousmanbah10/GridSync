import { useId } from 'react'

// Animated transmission scene: lattice towers, conductors with current pulses, and a substation.
// Pure SVG + CSS; motion stops under prefers-reduced-motion.
const TOWERS = [[640, 1], [790, .86], [925, .74], [1045, .64]]
const ARMS = [[-34, 30], [-26, 52], [-18, 72]] // [half-span, height from top] per crossarm, at scale 1

function tower(x, s) {
  const base = 210, top = base - 150 * s, w = 26 * s, t = 5 * s
  const legs = `M${x - w},${base} L${x - t},${top} L${x + t},${top} L${x + w},${base}`
  let lattice = ''
  for (let i = 0; i < 6; i++) {
    const y1 = base - (i * 150 * s) / 6, y2 = base - ((i + 1) * 150 * s) / 6
    const hw1 = w - ((w - t) * i) / 6, hw2 = w - ((w - t) * (i + 1)) / 6
    lattice += `M${x - hw1},${y1} L${x + hw2},${y2} M${x + hw1},${y1} L${x - hw2},${y2} `
  }
  const arms = ARMS.map(([span, h]) => `M${x + span * s},${top + h * s} L${x - span * s},${top + h * s}`).join(' ')
  return {d: `${legs} ${lattice} ${arms}`, tips: ARMS.map(([span, h]) => [[x - span * s, top + h * s], [x + span * s, top + h * s]])}
}

export default function GridScene({ className = '' }) {
  const id = useId().replace(/:/g, '')
  const towers = TOWERS.map(([x, s]) => tower(x, s))
  const wires = []
  for (let i = 0; i < towers.length - 1; i++) {
    for (let arm = 0; arm < ARMS.length; arm++) for (let side = 0; side < 2; side++) {
      const [x1, y1] = towers[i].tips[arm][side], [x2, y2] = towers[i + 1].tips[arm][side]
      wires.push(`M${x1},${y1} Q${(x1 + x2) / 2},${Math.max(y1, y2) + 16} ${x2},${y2}`)
    }
  }
  // Lead-in wires from the left edge into the first tower.
  towers[0].tips.forEach(([, [x, y]]) => wires.push(`M300,${y + 30} Q${(300 + x) / 2},${y + 44} ${x},${y}`))
  return <svg className={`grid-scene ${className}`} viewBox="0 0 1200 220" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
    <defs>
      <linearGradient id={`fade-${id}`} x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".35" stopColor="#fff" stopOpacity="1" /></linearGradient>
      <mask id={`mask-${id}`}><rect width="1200" height="220" fill={`url(#fade-${id})`} /></mask>
      <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      <pattern id={`dots-${id}`} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#7aa2ff" opacity=".22" /></pattern>
    </defs>
    <g mask={`url(#mask-${id})`}>
      <rect width="1200" height="220" fill={`url(#dots-${id})`} />
      <path d="M0,210 H1200" stroke="#2b3f63" strokeWidth="1.5" />
      <g className="gs-wires" fill="none">{wires.map((d, i) => <path key={i} d={d} />)}</g>
      <g className="gs-pulses" fill="none" filter={`url(#glow-${id})`}>{wires.map((d, i) => <path key={i} d={d} style={{animationDelay: `${(i * 0.37) % 3}s`}} />)}</g>
      <g className="gs-towers" fill="none">{towers.map((t, i) => <path key={i} d={t.d} />)}</g>
      <g className="gs-substation" transform="translate(1085 150)">
        <path className="gs-frame" d="M0,60 V0 H100 V60 M0,18 H100 M25,0 V60 M50,0 V60 M75,0 V60" />
        {[8, 36, 64].map(x => <g key={x} transform={`translate(${x} 34)`}><rect width="22" height="26" rx="2" className="gs-transformer" /><path d="M4,-6 V0 M11,-9 V0 M18,-6 V0" className="gs-frame" /></g>)}
        {[14, 42, 70].map((x, i) => <circle key={x} cx={x + 5} cy={42} r="2.2" className="gs-light" style={{animationDelay: `${i * .6}s`}} />)}
      </g>
    </g>
  </svg>
}
