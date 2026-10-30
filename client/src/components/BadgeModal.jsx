/**
 * BadgeModal.jsx
 *
 * Accessible popup modal displaying all badges earned by a participant.
 * Fetches detailed badges from /api/leaderboard/:userId if not present on row.
 */

import { useState, useEffect, useRef } from 'react'
import '../styles/BadgeModal.css'

const SILVER_THRESHOLD = 5
const GOLD_THRESHOLD   = 10

function EligibilityTag({ count }) {
  if (count >= GOLD_THRESHOLD) {
    return <span className="swag-tag-gold">🏅 Gold Swags Eligible ({count} badges)</span>
  }
  if (count >= SILVER_THRESHOLD) {
    return <span className="swag-tag-silver">🥈 Silver Swags Eligible ({count} badges)</span>
  }
  return null
}

function BadgeFallback({ name }) {
  return (
    <div className="badge-fallback" aria-label={`Badge: ${name}`} title={name}>
      🎖️
    </div>
  )
}

function BadgeItem({ badge }) {
  const earned = badge.earnedAt
    ? new Date(badge.earnedAt).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null

  return (
    <div className="badge-card">
      {badge.imageUrl ? (
        <img
          src={badge.imageUrl}
          alt={badge.name ?? 'Badge'}
          className="badge-card__img"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            if (e.currentTarget.nextSibling) {
              e.currentTarget.nextSibling.removeAttribute('hidden')
            }
          }}
        />
      ) : null}
      {!badge.imageUrl && <BadgeFallback name={badge.name ?? 'Badge'} />}
      <div hidden><BadgeFallback name={badge.name ?? 'Badge'} /></div>
      <p className="badge-card__name">{badge.name ?? 'Unnamed badge'}</p>
      {earned && <p className="badge-card__date">{earned}</p>}
    </div>
  )
}

export default function BadgeModal({ participant, onClose }) {
  const closeRef = useRef(null)
  const [badges, setBadges] = useState(participant.badges ?? [])
  const [loading, setLoading] = useState(
    (!participant.badges || participant.badges.length === 0) && Boolean(participant.userId)
  )

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    if (participant.badges && participant.badges.length > 0) {
      setBadges(participant.badges)
      setLoading(false)
      return
    }

    if (participant.userId) {
      setLoading(true)
      fetch(`/api/leaderboard/${participant.userId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && Array.isArray(data.badges)) {
            setBadges(data.badges)
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [participant])

  const count = participant.validBadgeCount ?? badges.length ?? 0

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Badges earned by ${participant.username}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal">
        <div className="modal__header">
          <div>
            <h2 className="modal__title" id="modal-title">
              {participant.username}
            </h2>
            <p className="modal__subtitle">
              {count} valid badge{count !== 1 ? 's' : ''} earned
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close badges popup"
          >
            ✕
          </button>
        </div>

        <div className="modal__body">
          <div className="modal__eligibility" aria-live="polite">
            <EligibilityTag count={count} />
            {count < SILVER_THRESHOLD && (
              <span className="modal__elig-note">
                {SILVER_THRESHOLD - count} more badge{SILVER_THRESHOLD - count !== 1 ? 's' : ''} needed for Silver swag eligibility.
              </span>
            )}
          </div>

          {loading ? (
            <div className="modal-empty">
              <span className="modal-empty-icon">⏳</span>
              <p className="modal-empty-title">Loading badges...</p>
            </div>
          ) : badges.length === 0 ? (
            <div className="modal-empty">
              <span className="modal-empty-icon">🎖️</span>
              <p className="modal-empty-title">No badge details found</p>
              <p className="modal-empty-desc">
                Completed badges will be synchronized during the scheduled crawl cycle.
              </p>
            </div>
          ) : (
            <div className="badges-grid" aria-label="Earned badges">
              {badges.map((badge, i) => (
                <BadgeItem key={badge.name ?? i} badge={badge} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
