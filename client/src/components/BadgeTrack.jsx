import { GOLD_BADGES, trackFill } from '../lib/leaderboard.js'
import '../styles/BadgeTrack.css'

const SEGMENTS = Array.from({ length: GOLD_BADGES }, (_, i) => i)

export default function BadgeTrack({ count, size = 'md' }) {
  const filled = trackFill(count)

  return (
    <span
      className={`badge-track badge-track--${size}`}
      role="img"
      aria-label={`${filled} of ${GOLD_BADGES} accepted badges`}
    >
      <span className="badge-track__bar">
        {SEGMENTS.map((i) => (
          <span key={i} className={`badge-track__segment${i < filled ? ' is-filled' : ''}`} />
        ))}
      </span>
      <span className="badge-track__count">{filled}</span>
    </span>
  )
}
