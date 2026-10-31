import { useEffect, useRef, useState } from 'react'
import { fetchLeaderboard } from '../api.js'
import { badgeSummary, initials, placeLabel, podiumEntries } from '../lib/leaderboard.js'
import '../styles/Podium.css'

export default function Podium({ onViewBadges, refreshKey, onLoaded }) {
  const [rows, setRows] = useState(null)
  // Only refreshKey should trigger a fetch, not a new onLoaded function on every parent render
  const onLoadedRef = useRef(onLoaded)

  useEffect(() => {
    onLoadedRef.current = onLoaded
  })

  useEffect(() => {
    let cancelled = false
    fetchLeaderboard({ page: 1, limit: 10 })
      .then((data) => {
        if (cancelled) return
        setRows(data.rows)
        onLoadedRef.current(data)
      })
      .catch(() => {
        if (!cancelled) setRows(null)
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  if (!rows) return null
  const { entries, extraTied } = podiumEntries(rows)
  if (entries.length === 0) return null

  return (
    <div className="podium-section">
      <ol className="podium" aria-label="Top 3">
        {entries.map((row) => {
          const place = placeLabel(row.rank)
          return (
            <li key={row.userId} className={`podium__item podium__item--rank${row.rank}`}>
              <button
                type="button"
                className="podium__row"
                onClick={() => onViewBadges(row)}
              >
                <span className="podium__place">{place}<span className="visually-hidden"> place:</span></span>
                <span className="podium__avatar" aria-hidden="true">{initials(row.username)}</span>
                <span className="podium__text">
                  <span className="podium__name" title={row.username}>{row.username}</span>
                  <span className="podium__meta">{badgeSummary(row)}</span>
                </span>
                <span className="visually-hidden">. View badges</span>
              </button>
              <div className="podium__card">
                <span className="podium__place">{place}</span>
                <span className="podium__avatar" aria-hidden="true">{initials(row.username)}</span>
                <span className="podium__name" title={row.username}>{row.username}</span>
                <span className="podium__meta">
                  {badgeSummary(row)}
                </span>
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm podium__button"
                  aria-label={`View badges earned by ${row.username}`}
                  onClick={() => onViewBadges(row)}
                >
                  View badges
                </button>
              </div>
              <div className="podium__step" aria-hidden="true" />
            </li>
          )
        })}
      </ol>
      {extraTied > 0 && (
        <p className="podium__extra">+{extraTied} more tied on the podium; see the table below.</p>
      )}
    </div>
  )
}
