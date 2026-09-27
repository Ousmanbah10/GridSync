// Coordination score (0–100) as a number plus a compact bar.
export default function ScoreBar({ value }) {
  const score = Math.round(value)
  return <span className="scorebar" title={`Coordination score ${score} of 100`}><span className="mono">{score}</span><i><b style={{width: `${Math.max(0, Math.min(100, score))}%`}} /></i></span>
}
