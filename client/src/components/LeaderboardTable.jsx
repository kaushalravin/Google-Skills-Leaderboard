import { useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion.js'
import { swagTier, plural, formatCredits, rankChange, badgeButtonLabel } from '../lib/leaderboard.js'
import BadgeTrack from './BadgeTrack.jsx'
import GOOGLE_CLOUD_ICON from '../assets/google-cloud.jpg'
import '../styles/LeaderboardTable.css'

const SKELETON_ROWS = 6
const REORDER_MS = 300

function SwagPill({ count, fallback = null }) {
  const tier = swagTier(count)
  if (tier === 'gold') return <span className="swag-tag-gold">Gold</span>
  if (tier === 'silver') return <span className="swag-tag-silver">Silver</span>
  return fallback
}

function Movement({ row }) {
  const change = rankChange(row)
  if (!change || change.direction === 'same') return null
  if (change.direction === 'new') {
    return <span className="rank-move rank-move--new">New</span>
  }
  const up = change.direction === 'up'
  return (
    <span className={`rank-move rank-move--${change.direction}`}>
      <span aria-hidden="true">{up ? '▲︎' : '▼︎'}{change.by}</span>
      <span className="visually-hidden">{`${up ? 'up' : 'down'} ${plural(change.by, 'place')}`}</span>
    </span>
  )
}

function RankCell({ row, showMovement }) {
  return (
    <span className={`rank-cell${showMovement ? ' has-movement' : ''}`}>
      <span className="rank-cell__num">{row.rank}</span>
      {showMovement && <span className="rank-cell__move"><Movement row={row} /></span>}
    </span>
  )
}

function LoadMoreControl({ hasMore, loadingMore, loadMoreError, onLoadMore, total, loadedCount }) {
  if (loadingMore) {
    return (
      <div className="lb-load-more-wrap" role="status" aria-live="polite">
        <button type="button" className="lb-load-more-btn is-loading" disabled>
          <span className="lb-load-more-spinner" aria-hidden="true" />
          <span>Loading more participants...</span>
        </button>
      </div>
    )
  }

  if (loadMoreError) {
    return (
      <div className="lb-load-more-wrap">
        <button
          type="button"
          className="lb-load-more-btn is-error"
          onClick={onLoadMore}
        >
          <span className="lb-load-more-icon-wrap" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4v6h6M23 20v-6h-6" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
            </svg>
          </span>
          <span>Failed to load. Click to retry</span>
        </button>
      </div>
    )
  }

  if (hasMore) {
    const remaining = Math.max(0, total - loadedCount)
    return (
      <div className="lb-load-more-wrap">
        <button
          type="button"
          className="lb-load-more-btn"
          onClick={onLoadMore}
          aria-label={`Load more participants (${remaining} remaining)`}
        >
          <span className="lb-load-more-icon-wrap" aria-hidden="true">
            <svg className="lb-load-more-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </span>
          <span className="lb-load-more-label">Load more</span>
          <span className="lb-load-more-badge">{remaining} remaining</span>
        </button>
        <span className="lb-load-more-progress">
          Showing {loadedCount} of {total} participants
        </span>
      </div>
    )
  }

  if (!hasMore && loadedCount > 0 && total > 15) {
    return (
      <div className="lb-load-more-wrap">
        <div className="lb-all-loaded" role="status">
          <span className="lb-all-loaded__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </span>
          <span>All {total} participants loaded</span>
        </div>
      </div>
    )
  }

  return null
}

function TableHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="text-center col-rank">Rank</th>
        <th scope="col" className="col-name">Name</th>
        <th scope="col" className="text-center col-profile">Google Skills profile</th>
        <th scope="col" className="text-center col-badges">Badges</th>
        <th scope="col" className="text-center col-credits">No. of Credits</th>
        <th scope="col" className="text-center col-swags">Swag</th>
      </tr>
    </thead>
  )
}

function SkeletonTable() {
  return (
    <div className="wider-table-container" aria-busy="true">
      <table className="table table-bordered lb-table">
        <TableHead />
        <tbody>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <tr key={i}>
              <td className="text-center col-rank">
                <span className="rank-cell">
                  <span className="placeholder lb-ph lb-ph--rank" />
                </span>
              </td>
              <td className="col-name">
                <span className="name-cell">
                  <span className="lb-ph-line"><span className="placeholder lb-ph lb-ph--name" /></span>
                </span>
              </td>
              <td className="text-center col-profile"><span className="placeholder lb-ph lb-ph--icon" /></td>
              <td className="text-center col-badges">
                <span className="view-badges-btn is-placeholder">
                  <span className="placeholder lb-ph lb-ph--track" />
                </span>
              </td>
              <td className="text-center col-credits"><span className="placeholder lb-ph lb-ph--num" /></td>
              <td className="text-center col-swags"><span className="placeholder lb-ph lb-ph--pill" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NameCell({ row }) {
  return (
    <span className="name-cell">
      <span className="name-text">{row.username}</span>
      <a
        className="name-link"
        href={row.skillsUrl}
        target="_blank"
        rel="noopener noreferrer"
        title={row.username}
      >
        {row.username}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </a>
    </span>
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
      className="profile-cloud-link"
    >
      <img src={GOOGLE_CLOUD_ICON} alt="" width="26" height="26" className="skills-cloud-icon" />
    </a>
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
      // Only rows whose position in the list changed; a resize since the last load must not slide anything
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
    // Commit the starting position before transitioning back to the natural one
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
  onLoadMore,
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
      <div className="lb-message wider-table-container" role="alert">
        <p className="mb-3">Couldn't load the leaderboard. Please try again.</p>
        <button type="button" className="lb-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="lb-message wider-table-container">
        <p className="mb-0">{searching ? 'No participants match your search.' : 'No participants yet.'}</p>
      </div>
    )
  }

  // An old snapshot has no previousRank at all; then the movement slot is left out entirely.
  const showMovement = rows.some((row) => row.previousRank !== undefined)

  return (
    <>
      <div className="wider-table-container">
        <table className="table table-bordered table-hover lb-table">
          <TableHead />
          <tbody>
            {rows.map((row) => {
              const count = row.validBadgeCount ?? 0
              const label = badgeButtonLabel(row)
              return (
                <tr key={row.userId} ref={rowRef(row.userId)}>
                  <td className="text-center fw-medium col-rank"><RankCell row={row} showMovement={showMovement} /></td>
                  <td className="fw-medium col-name"><NameCell row={row} /></td>
                  <td className="text-center col-profile"><ProfileCell row={row} /></td>
                  <td className="text-center col-badges">
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
                  <td className="text-center col-credits">{formatCredits(row.validCredits)}</td>
                  <td className="text-center col-swags"><SwagPill count={count} fallback={<span className="lb-none">—</span>} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <LoadMoreControl
        hasMore={hasMore}
        loadingMore={loadingMore}
        loadMoreError={loadMoreError}
        onLoadMore={onLoadMore}
        total={total}
        loadedCount={loadedCount}
      />
    </>
  )
}
