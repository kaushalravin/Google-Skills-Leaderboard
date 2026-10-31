import { useState, useEffect, useLayoutEffect } from 'react'
import { fetchParticipant } from '../api.js'
import { nextGoals } from '../lib/leaderboard.js'
import { usePinned, unpin } from '../hooks/usePinned.js'
import BadgeTrack from './BadgeTrack.jsx'
import '../styles/MeBar.css'

const OFFSET = 'calc(var(--mebar-height) + env(safe-area-inset-bottom))'

export default function MeBar({ refreshKey, onOpen }) {
  const pinnedId = usePinned()
  const [loaded, setLoaded] = useState({ id: null, row: null, failed: false })
  const current = loaded.id === pinnedId ? loaded : null
  // A failed first load (not a 404) has nothing true to show, so the bar steps aside until a refresh succeeds
  const hidden = Boolean(current?.failed && !current.row)

  // Reserve the space before the data arrives so the page doesn't jump when the bar fills in
  useLayoutEffect(() => {
    if (!pinnedId || hidden) return
    const root = document.documentElement
    root.style.setProperty('--mebar-offset', OFFSET)
    return () => root.style.removeProperty('--mebar-offset')
  }, [pinnedId, hidden])

  useEffect(() => {
    if (!pinnedId) return
    let cancelled = false
    fetchParticipant(pinnedId)
      .then((row) => {
        if (!cancelled) setLoaded({ id: pinnedId, row, failed: false })
      })
      .catch((err) => {
        if (cancelled) return
        if (err.status === 404) unpin()
        else setLoaded((prev) => (prev.id === pinnedId && prev.row ? prev : { id: pinnedId, row: null, failed: true }))
      })
    return () => {
      cancelled = true
    }
  }, [pinnedId, refreshKey])

  if (!pinnedId || hidden) return null

  const row = current?.row ?? null

  if (!row) {
    return <div className="mebar" aria-hidden="true" />
  }

  const name = row.username
  const goals = nextGoals(row, row.ahead).join(' · ')

  return (
    <aside className="mebar" aria-label="Your position">
      <div className="mebar__inner">
        <button
          type="button"
          className="mebar__main"
          onClick={() => onOpen(row)}
          aria-label={`#${row.rank} ${name}, open your badges`}
          aria-describedby={goals ? 'mebar-goals' : undefined}
        >
          <span className="mebar__line">
            <span className="mebar__rank">#{row.rank}</span>
            <span className="mebar__name" title={name}>{name}</span>
            <BadgeTrack count={row.validBadgeCount ?? 0} size="sm" />
          </span>
          {goals && <span className="mebar__goals" id="mebar-goals">{goals}</span>}
        </button>
        <button
          type="button"
          className="mebar__dismiss"
          onClick={unpin}
          aria-label={`Unpin ${name}`}
        >
          ×
        </button>
      </div>
    </aside>
  )
}
