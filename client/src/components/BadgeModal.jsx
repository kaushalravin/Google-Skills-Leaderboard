import { useState, useEffect, useRef } from 'react'
import { swagTier, plural, badgeSummary, formatShortDate, missingBadges, GOLD_BADGES, SILVER_BADGES } from '../lib/leaderboard.js'
import { ACCEPTED_BADGES } from '../content/acceptedBadges.js'
import { usePinned, pin, unpin } from '../hooks/usePinned.js'
import BadgeTrack from './BadgeTrack.jsx'
import { isCoarsePointer } from '../lib/motion.js'
import '../styles/BadgeModal.css'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
const STATUS_MS = 2000

function Eligibility({ count }) {
  const tier = swagTier(count)
  if (tier === 'gold') {
    return <span className="swag-tag-gold">Gold swag eligible</span>
  }
  if (tier === 'silver') {
    return (
      <>
        <span className="swag-tag-silver">Silver swag eligible</span>
        <span className="modal__elig-note">
          {plural(GOLD_BADGES - count, 'more badge')} needed for Gold swag.
        </span>
      </>
    )
  }
  return (
    <span className="modal__elig-note">
      {plural(SILVER_BADGES - count, 'more badge')} needed for Silver swag.
    </span>
  )
}

function BadgeOutline() {
  return (
    <svg className="badge-card__fallback" viewBox="0 0 48 48" width="44" height="44" aria-hidden="true" focusable="false">
      <circle cx="24" cy="19" r="13" fill="none" stroke="currentColor" strokeWidth="2" />
      <circle cx="24" cy="19" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 29 L12 44 L19 40 L24 45 L24 32 M32 29 L36 44 L29 40 L24 45" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}

function BadgeItem({ badge }) {
  const [imgFailed, setImgFailed] = useState(false)
  const earned = formatShortDate(badge.earnedAt)

  return (
    <div className="badge-card">
      <div className="badge-card__media">
        {badge.imageUrl && !imgFailed ? (
          <img
            src={badge.imageUrl}
            alt=""
            className="badge-card__img"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <BadgeOutline />
        )}
      </div>
      <p className="badge-card__name" title={badge.name}>{badge.name}</p>
      {earned && <p className="badge-card__date">{earned}</p>}
    </div>
  )
}

function NotEarned({ badges }) {
  if (badges.length === 0) return null
  return (
    <section className="modal__missing" aria-labelledby="badge-modal-missing">
      <h3 className="modal__section-title" id="badge-modal-missing">Not earned yet</h3>
      <ul className="missing-list">
        {badges.map((badge) => (
          <li key={badge.title} className="missing-list__item">
            <a className="missing-list__link" href={badge.url} target="_blank" rel="noopener noreferrer">
              {badge.title}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <span className="missing-list__credits">{plural(badge.credits, 'credit')}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function CopyLinkButton({ participant }) {
  const [status, setStatus] = useState(null)
  const timerRef = useRef(null)

  useEffect(() => () => clearTimeout(timerRef.current), [])

  function show(message) {
    clearTimeout(timerRef.current)
    setStatus(message)
    timerRef.current = setTimeout(() => setStatus(null), STATUS_MS)
  }

  async function handleClick() {
    const url = `${window.location.origin}/p/${encodeURIComponent(participant.userId)}`
    if (navigator.share && isCoarsePointer()) {
      try {
        await navigator.share({ title: `${participant.username} on the leaderboard`, url })
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      show('Link copied')
    } catch {
      show('Copy failed')
    }
  }

  return (
    <button type="button" className="modal__action" onClick={handleClick}>
      <span aria-live="polite">{status ?? 'Copy link'}</span>
    </button>
  )
}

function lockPageScroll() {
  const { body } = document
  const scrollY = window.scrollY
  const previous = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    overflow: body.style.overflow,
  }
  // position: fixed is the only lock iOS Safari honours; the saved offset keeps the page where it was
  Object.assign(body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', right: '0', overflow: 'hidden' })
  return () => {
    Object.assign(body.style, previous)
    window.scrollTo({ top: scrollY, left: 0, behavior: 'instant' })
  }
}

export default function BadgeModal({ participant, onClose }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const pinnedId = usePinned()
  const { badges, validBadgeCount: count } = participant
  const missing = missingBadges(badges, ACCEPTED_BADGES)
  const isPinned = pinnedId != null && pinnedId === String(participant.userId)

  useEffect(() => {
    const opener = document.activeElement
    const unlock = lockPageScroll()
    closeRef.current?.focus({ preventScroll: true })
    return () => {
      unlock()
      opener?.focus?.({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    function handler(e) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)]
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = dialogRef.current.contains(document.activeElement)
      if (!inside || (e.shiftKey && document.activeElement === first)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="badge-modal-title">
        <div className="modal__header">
          <div>
            <h2 className="modal__title" id="badge-modal-title">
              {participant.username}
            </h2>
            <div className="modal__track">
              <BadgeTrack count={count} size="md" />
            </div>
            <p className="modal__subtitle">{badgeSummary(participant)}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div
          className="modal__body"
          tabIndex={0}
          role="region"
          aria-label="Badge details"
        >
          <div className="modal__eligibility">
            <Eligibility count={count} />
          </div>

          {badges.length === 0 ? (
            <p className="modal-empty">No accepted badges yet.</p>
          ) : (
            <ul className="badges-grid">
              {badges.map((badge) => (
                <li key={badge.name}>
                  <BadgeItem badge={badge} />
                </li>
              ))}
            </ul>
          )}

          <NotEarned badges={missing} />
        </div>

        <div className="modal__footer">
          <button
            type="button"
            className={`modal__action${isPinned ? ' is-pinned' : ''}`}
            onClick={() => (isPinned ? unpin() : pin(participant.userId))}
          >
            {isPinned ? 'Not me' : 'This is me'}
          </button>
          <CopyLinkButton participant={participant} />
        </div>
      </div>
    </div>
  )
}
