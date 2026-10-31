import { useLayoutEffect, useRef } from 'react'
import { prefersReducedMotion } from '../lib/motion.js'
import { swagTier, plural, formatCredits, rankChange, badgeSummary, badgeButtonLabel } from '../lib/leaderboard.js'
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

function Pagination({ pagination, onPageChange }) {
  const { page, totalPages } = pagination
  if (totalPages <= 1) return null

  const delta = 1
  const pages = []
  for (let i = Math.max(1, page - delta); i <= Math.min(totalPages, page + delta); i++) {
    pages.push(i)
  }

  return (
    <nav className="lb-pagination mt-3" aria-label="Leaderboard pages">
      <button
        type="button"
        className="btn btn-outline-primary lb-pagination__step"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        <span className="lb-pagination__arrow" aria-hidden="true">‹ </span>Previous
      </button>

      <span className="lb-pagination__compact">
        <span aria-hidden="true">·</span>
        <span><span className="visually-hidden">Page </span>{page} of {totalPages}</span>
        <span aria-hidden="true">·</span>
      </span>

      <span className="lb-pagination__numbers">
        {pages[0] > 1 && (
          <>
            <button type="button" className="btn btn-outline-primary" onClick={() => onPageChange(1)}>
              1
            </button>
            {pages[0] > 2 && <span className="lb-pagination__gap">…</span>}
          </>
        )}

        {pages.map((p) => (
          <button
            key={p}
            type="button"
            className={`btn btn-outline-primary ${p === page ? 'active' : ''}`}
            disabled={p === page}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => onPageChange(p)}
          >
            {p}
          </button>
        ))}

        {pages[pages.length - 1] < totalPages && (
          <>
            {pages[pages.length - 1] < totalPages - 1 && <span className="lb-pagination__gap">…</span>}
            <button type="button" className="btn btn-outline-primary" onClick={() => onPageChange(totalPages)}>
              {totalPages}
            </button>
          </>
        )}
      </span>

      <button
        type="button"
        className="btn btn-outline-primary lb-pagination__step"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next<span className="lb-pagination__arrow" aria-hidden="true"> ›</span>
      </button>
    </nav>
  )
}

function TableHead() {
  return (
    <thead>
      <tr>
        <th scope="col" className="text-center col-rank">Rank</th>
        <th scope="col" className="col-name">Name</th>
        <th scope="col" className="text-center col-profile">Google Skills profile</th>
        <th scope="col" className="text-center col-badges">Badges</th>
        <th scope="col" className="text-center col-credits">Credits</th>
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
                  <span className="name-cell__swag"><span className="placeholder lb-ph lb-ph--pill" /></span>
                </span>
              </td>
              <td className="text-center col-profile"><span className="placeholder lb-ph lb-ph--icon" /></td>
              <td className="text-center col-badges">
                <span className="view-badges-btn is-placeholder">
                  <span className="placeholder lb-ph lb-ph--track" />
                  <span className="view-badges-btn__summary"><span className="placeholder lb-ph lb-ph--summary" /></span>
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
  const count = row.validBadgeCount ?? 0
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
      {swagTier(count) && <span className="name-cell__swag"><SwagPill count={count} /></span>}
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

export default function LeaderboardTable({ data, dataKey, loading, error, onRetry, onPageChange, onViewBadges, searching }) {
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

  const pagination = data?.pagination

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
                      <span className="view-badges-btn__summary" aria-hidden="true">{badgeSummary(row)}</span>
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

      {pagination && <Pagination pagination={pagination} onPageChange={onPageChange} />}
    </>
  )
}
