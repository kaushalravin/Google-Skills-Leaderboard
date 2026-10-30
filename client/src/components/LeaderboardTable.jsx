/**
 * LeaderboardTable.jsx
 *
 * Implements the wide, streamlined table:
 *  - Columns: Rank | UserName | Google Skills profile | Badges Completed | Swags Eligibility
 *  - Email removed per request
 *  - Arcade Game Completion removed per request
 *  - Interactive 'View Badges' button in table which triggers the Badges popup modal
 *  - Clean green '✔' checkmark for swags eligibility
 *  - Centered numbered pagination
 */

import { useState, useCallback } from 'react'
import BadgeModal from './BadgeModal.jsx'
import IMAGE_GDG from '../assets/google-cloud.jpg'
import '../styles/LeaderboardTable.css'

const SILVER_THRESHOLD = 5

function SwagStatus({ isEligible }) {
  if (isEligible) {
    return <span className="status-icon green" title="Eligible for Swags">✔</span>
  }
  return <span className="status-icon text-muted">—</span>
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
    <div className="d-flex justify-content-center align-items-center mt-3">
      <button
        type="button"
        className="btn btn-outline-primary me-2"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>

      {pages[0] > 1 && (
        <>
          <button
            type="button"
            className="btn btn-outline-primary mx-1"
            onClick={() => onPageChange(1)}
          >
            1
          </button>
          {pages[0] > 2 && <span className="mx-1 text-muted">...</span>}
        </>
      )}

      {pages.map((p) => (
        <button
          key={p}
          type="button"
          className={`btn btn-outline-primary mx-1 ${p === page ? 'active' : ''}`}
          disabled={p === page}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}

      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && <span className="mx-1 text-muted">...</span>}
          <button
            type="button"
            className="btn btn-outline-primary mx-1"
            onClick={() => onPageChange(totalPages)}
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        type="button"
        className="btn btn-outline-primary ms-2"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  )
}

export default function LeaderboardTable({ data, loading, error, retry, onPageChange }) {
  const [modalParticipant, setModalParticipant] = useState(null)

  const openModal  = useCallback((row) => setModalParticipant(row), [])
  const closeModal = useCallback(() => setModalParticipant(null), [])

  if (loading) {
    return (
      <div className="table-responsive wider-table-container">
        <table className="table table-bordered table-hover">
          <thead className="table-primary">
            <tr>
              <th className="text-center" style={{ width: '90px' }}>Rank</th>
              <th>UserName</th>
              <th className="text-center" style={{ width: '180px' }}>Google Skills profile</th>
              <th className="text-center" style={{ width: '220px' }}>Badges Completed</th>
              <th className="text-center" style={{ width: '180px' }}>Swags Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="text-center"><span className="placeholder col-6" /></td>
                <td><span className="placeholder col-8" /></td>
                <td className="text-center"><span className="placeholder col-4" /></td>
                <td className="text-center"><span className="placeholder col-6" /></td>
                <td className="text-center"><span className="placeholder col-4" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-danger text-center p-4 my-3 wider-table-container" role="alert">
        <h5 className="alert-heading">Failed to load leaderboard data</h5>
        <p className="mb-3">{error}</p>
        <button type="button" className="btn btn-primary" onClick={retry}>
          Retry
        </button>
      </div>
    )
  }

  const rows = data?.rows ?? []
  const pagination = data?.pagination

  if (rows.length === 0) {
    return (
      <div className="alert alert-info text-center p-4 my-3 wider-table-container" role="alert">
        <h5 className="alert-heading">No participants found</h5>
        <p className="mb-0">
          {pagination?.total === 0
            ? 'The leaderboard is currently empty. Run a crawl from the server or check back later.'
            : 'No participants matched your search term.'}
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="table-responsive wider-table-container">
        <table className="table table-bordered table-hover">
          <thead className="table-primary">
            <tr>
              <th className="text-center" style={{ width: '90px' }}>Rank</th>
              <th>UserName</th>
              <th className="text-center" style={{ width: '180px' }}>Google Skills profile</th>
              <th className="text-center" style={{ width: '220px' }}>Badges Completed</th>
              <th className="text-center" style={{ width: '180px' }}>Swags Eligibility</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const count = row.validBadgeCount ?? 0
              const isSilver = count >= SILVER_THRESHOLD

              return (
                <tr key={row.userId ?? row.rank} className="highlight-row">
                  {/* Rank */}
                  <td className="text-center fw-medium text-dark">{row.rank}</td>

                  {/* UserName */}
                  <td className="fw-medium text-dark text-nowrap">{row.username}</td>

                  {/* Google Skills profile */}
                  <td className="text-center">
                    {row.skillsUrl ? (
                      <a
                        target="_blank"
                        rel="noopener noreferrer"
                        href={row.skillsUrl}
                        title={`Open ${row.username}'s Google Skills profile`}
                        className="profile-cloud-link"
                      >
                        <img
                          src={IMAGE_GDG}
                          alt="Google Skills profile"
                          width="26"
                          height="26"
                          className="skills-cloud-icon"
                        />
                      </a>
                    ) : (
                      <img
                        src={IMAGE_GDG}
                        alt="Google Skills profile"
                        width="26"
                        height="26"
                        style={{ opacity: 0.5 }}
                      />
                    )}
                  </td>

                  {/* Badges Completed - Interactive Button Opening Popup */}
                  <td className="text-center">
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm px-3 py-1 fw-medium view-badges-btn"
                      onClick={() => openModal(row)}
                      title={`Click to view all badges earned by ${row.username}`}
                    >
                      <span className="me-1">🎖️</span>
                      {count} Badges
                    </button>
                  </td>

                  {/* Swags Eligibility */}
                  <td className="text-center">
                    <SwagStatus isEligible={isSilver} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pagination && (
        <Pagination pagination={pagination} onPageChange={onPageChange} />
      )}

      {modalParticipant && (
        <BadgeModal participant={modalParticipant} onClose={closeModal} />
      )}
    </>
  )
}
