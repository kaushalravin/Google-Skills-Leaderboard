import { useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion.js'
import { swagTier, plural, formatCredits, rankChange, badgeButtonLabel, initials } from '../lib/leaderboard.js'
import BadgeTrack from './BadgeTrack.jsx'
import GOOGLE_CLOUD_ICON from '../assets/google-cloud.jpg'
import '../styles/LeaderboardTable.css'

const SKELETON_ROWS = 6
const REORDER_MS = 300
const GOOGLE_AVATARS = ['#4285F4', '#EA4335', '#FBBC04', '#34A853', '#0F9D58', '#AB47BC', '#00ACC1', '#F4511E']

function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function getAvatarColor(username) {
  const index = hashStr(String(username || '?')) % GOOGLE_AVATARS.length
  return GOOGLE_AVATARS[index]
}

function SwagPill({ count, fallback = null, prefix = '' }) {
  const tier = swagTier(count)
  if (tier === 'gold') return <span className="swag-tag-gold">{prefix}Gold</span>
  if (tier === 'silver') return <span className="swag-tag-silver">{prefix}Silver</span>
  return fallback
}

function RankBadge({ rank }) {
  let tier = 'blue'
  if (rank === 1) tier = 'gold'
  else if (rank === 2) tier = 'silver'
  else if (rank === 3) tier = 'bronze'

  return <span className={`rank-circle rank-circle--${tier}`}>{rank}</span>
}

function MovementBadge({ row }) {
  const change = rankChange(row)
  if (!change || change.direction === 'same') {
    return <span className="rank-move rank-move--same">–</span>
  }
  if (change.direction === 'new') {
    return <span className="rank-move rank-move--same">–</span>
  }
  const up = change.direction === 'up'
  return (
    <span className={`rank-move rank-move--${change.direction}`}>
      <span aria-hidden="true">{up ? '▲ ' : '▼ '}{change.by}</span>
      <span className="visually-hidden">{`${up ? 'up' : 'down'} ${plural(change.by, 'place')}`}</span>
    </span>
  )
}

function RankCell({ row }) {
  return (
    <div className="rank-cell-wrapper">
      <RankBadge rank={row.rank} />
      <MovementBadge row={row} />
    </div>
  )
}

function NameCell({ row }) {
  const userInitials = initials(row.username)
  const bgColor = getAvatarColor(row.username)
  return (
    <div className="name-cell">
      <span className="user-avatar" style={{ backgroundColor: bgColor }} aria-hidden="true">
        {userInitials}
      </span>
      <a
        className="name-link-text"
        href={row.skillsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={row.username}
      >
        {row.username}
      </a>
    </div>
  )
}

function ProfileCell({ row }) {
  return (
    <a
      target="_blank"
      rel="noopener noreferrer"
      href={row.skillsUrl}
      title={`Open ${row.username}'s Google Skills profile`}
      aria-label={`Open ${row.username}'s Google Skills profile (opens in a new tab)`}
      className="skills-profile-link"
    >
      <img src={GOOGLE_CLOUD_ICON} alt="" width="20" height="20" className="skills-cloud-icon" />
      <span>skills profile</span>
    </a>
  )
}

function TableHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="col-rank">RANK</th>
        <th scope="col" className="col-name">NAME</th>
        <th scope="col" className="col-profile">GOOGLE SKILLS</th>
        <th scope="col" className="col-badges">BADGES</th>
        <th scope="col" className="text-center col-credits">CREDITS</th>
        <th scope="col" className="text-center col-swags">SWAG</th>
      </tr>
    </thead>
  )
}

function TableLegend() {
  return (
    <div className="lb-legend" aria-hidden="true">
      <span className="lb-legend-item">
        <span className="legend-up">▲</span> rank up
      </span>
      <span className="lb-legend-item">
        <span className="legend-down">▼</span> rank down
      </span>
      <span className="lb-legend-item">
        <span className="legend-badge">●</span> badges earned (of 10)
      </span>
    </div>
  )
}

function LoadMoreControl({ hasMore, canCollapse, loadingMore, loadMoreError, onLoadMore, onCollapse }) {
  if (!hasMore && !canCollapse) return null

  return (
    <div className="lb-load-more-wrap">
      {hasMore && (
        <button
          type="button"
          className={`lb-load-more-btn ${loadingMore ? 'is-loading' : ''} ${loadMoreError ? 'is-error' : ''}`}
          onClick={onLoadMore}
          disabled={loadingMore}
          aria-label="Load more"
        >
          <span>{loadingMore ? 'Loading...' : loadMoreError ? 'Retry' : 'Load more'}</span>
          {loadingMore ? (
            <span className="lb-load-more-spinner" aria-hidden="true" />
          ) : (
            <svg
              className="lb-load-more-arrow"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M18 13l-6 6-6-6" />
            </svg>
          )}
        </button>
      )}

      {canCollapse && (
        <button
          type="button"
          className="lb-load-more-btn lb-collapse-btn"
          onClick={() => {
            onCollapse?.()
            document.getElementById('leaderboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }}
          aria-label="Collapse"
        >
          <span>Collapse</span>
          <svg
            className="lb-load-more-arrow is-up"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </button>
      )}
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="lb-table-card" aria-busy="true">
      <div className="table-responsive d-none d-md-block">
        <table className="table lb-table">
          <TableHead />
          <tbody>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <tr key={i}>
                <td className="col-rank">
                  <div className="rank-cell-wrapper">
                    <span className="placeholder lb-ph lb-ph--rank-circle" />
                  </div>
                </td>
                <td className="col-name">
                  <div className="name-cell">
                    <span className="placeholder lb-ph lb-ph--avatar" />
                    <span className="placeholder lb-ph lb-ph--name" />
                  </div>
                </td>
                <td className="col-profile"><span className="placeholder lb-ph lb-ph--link" /></td>
                <td className="col-badges"><span className="placeholder lb-ph lb-ph--track" /></td>
                <td className="text-center col-credits"><span className="placeholder lb-ph lb-ph--num" /></td>
                <td className="text-center col-swags"><span className="placeholder lb-ph lb-ph--pill" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="lb-mobile-list d-md-none">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="lb-mobile-card">
            <div className="lb-mobile-card__top">
              <span className="placeholder lb-ph lb-ph--rank-circle" />
              <div className="d-flex align-items-center gap-2 flex-grow-1 ms-2">
                <span className="placeholder lb-ph lb-ph--avatar" />
                <span className="placeholder lb-ph lb-ph--name" />
              </div>
            </div>
            <div className="lb-mobile-card__stats mt-3">
              <span className="placeholder lb-ph lb-ph--track" />
              <span className="placeholder lb-ph lb-ph--num" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// FLIP: rows that moved after a background refresh of the same query slide once from their old offset.
function useReorder(rows, dataKey) {
  const rowEls = useRef(new Map())
  const last = useRef({ rows: null, dataKey: null, offsets: new Map(), order: [] })

  useLayoutEffect(() => {
    const prev = last.current
    const animate = rows && prev.rows && prev.rows !== rows && prev.dataKey === dataKey && !prefersReducedMotion()
    const order = (rows ?? []).map((row) => row.userId)
    const offsets = new Map()
    const moved = []

    order.forEach((id, index) => {
      const el = rowEls.current.get(id)
      if (!el) return
      offsets.set(id, el.offsetTop)
      const before = prev.offsets.get(id)
      if (animate && before !== undefined && prev.order.indexOf(id) !== index && before !== el.offsetTop) {
        moved.push([el, before - el.offsetTop])
      }
    })
    last.current = { rows, dataKey, offsets, order }
    if (moved.length === 0) return

    for (const [el, delta] of moved) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
    }
    void document.body.offsetHeight
    for (const [el] of moved) {
      el.style.transition = `transform ${REORDER_MS}ms ease`
      el.style.transform = ''
    }
    const timer = setTimeout(() => {
      for (const [el] of moved) el.style.transition = ''
    }, REORDER_MS + 50)
    return () => clearTimeout(timer)
  }, [rows, dataKey])

  return (id) => (el) => {
    if (el) rowEls.current.set(id, el)
    else rowEls.current.delete(id)
  }
}

export default function LeaderboardTable({
  data,
  dataKey,
  loading,
  loadingMore,
  loadMoreError,
  hasMore,
  canCollapse,
  onLoadMore,
  onCollapse,
  total,
  loadedCount,
  error,
  onRetry,
  onViewBadges,
  searching,
}) {
  const rows = loading || error ? null : data?.rows ?? []
  const rowRef = useReorder(rows, dataKey)

  if (loading) return <SkeletonTable />

  if (error) {
    return (
      <div className="lb-message lb-table-card" role="alert">
        <p className="mb-3">Couldn't load the leaderboard. Please try again.</p>
        <button type="button" className="lb-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="lb-message lb-table-card">
        <p className="mb-0">{searching ? 'No participants match your search.' : 'No participants yet.'}</p>
      </div>
    )
  }

  return (
    <>
      <div className="lb-table-card">
        {/* Desktop Table View */}
        <div className="table-responsive d-none d-md-block">
          <table className="table lb-table">
            <TableHead />
            <tbody>
              {rows.map((row) => {
                const count = row.validBadgeCount ?? 0
                const label = badgeButtonLabel(row)
                return (
                  <tr key={row.userId} ref={rowRef(row.userId)}>
                    <td className="col-rank">
                      <RankCell row={row} />
                    </td>
                    <td className="col-name">
                      <NameCell row={row} />
                    </td>
                    <td className="col-profile">
                      <ProfileCell row={row} />
                    </td>
                    <td className="col-badges">
                      <button
                        type="button"
                        className="view-badges-btn"
                        onClick={() => onViewBadges(row)}
                        aria-label={label}
                        title={label}
                      >
                        <BadgeTrack count={count} size="sm" />
                      </button>
                    </td>
                    <td className="text-center col-credits">
                      <span className="credits-num">{formatCredits(row.validCredits)}</span>
                    </td>
                    <td className="text-center col-swags">
                      <SwagPill count={count} fallback={<span className="lb-none">—</span>} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards View */}
        <div className="lb-mobile-list d-md-none">
          {rows.map((row) => {
            const count = row.validBadgeCount ?? 0
            const label = badgeButtonLabel(row)
            const swag = swagTier(count)
            return (
              <div key={row.userId} className="lb-mobile-card" ref={rowRef(row.userId)}>
                <div className="lb-mobile-card__top">
                  <div className="lb-mobile-card__rank">
                    <RankBadge rank={row.rank} />
                    <MovementBadge row={row} />
                  </div>
                  <div className="lb-mobile-card__user">
                    <span
                      className="user-avatar"
                      style={{ backgroundColor: getAvatarColor(row.username) }}
                      aria-hidden="true"
                    >
                      {initials(row.username)}
                    </span>
                    <a
                      className="user-name"
                      href={row.skillsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {row.username}
                    </a>
                  </div>
                  <a
                    href={row.skillsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mobile-cloud-btn"
                    title={`Open ${row.username}'s Google Skills profile`}
                  >
                    <img src={GOOGLE_CLOUD_ICON} alt="" width="22" height="22" />
                  </a>
                </div>

                <div className="lb-mobile-card__stats">
                  <button
                    type="button"
                    className="view-badges-btn"
                    onClick={() => onViewBadges(row)}
                    aria-label={label}
                  >
                    <BadgeTrack count={count} size="sm" />
                  </button>
                  <span className="mobile-credits">{formatCredits(row.validCredits)} credits</span>
                </div>

                {swag && (
                  <div className="lb-mobile-card__swag">
                    <SwagPill count={count} prefix="Swag: " />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <TableLegend />

      <LoadMoreControl
        hasMore={hasMore}
        canCollapse={canCollapse}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onLoadMore={onLoadMore}
        onCollapse={onCollapse}
      />
    </>
  )
}
