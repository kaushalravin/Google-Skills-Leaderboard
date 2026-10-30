/**
 * LeaderboardPage.jsx
 *
 * Implements:
 *  - About Google Cloud Study Jam hero section (with GDG On Campus MIT logo)
 *  - Animated Google Cloud Study Jam Leaderboard heading
 *  - Search input with 'X' button
 *  - Profiles per page dropdown (5, 15, 25, 50)
 *  - Expanded wide LeaderboardTable
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { useLeaderboard } from '../hooks/useLeaderboard.js'
import LeaderboardTable from '../components/LeaderboardTable.jsx'
import GDG_MIT_IMG from '../assets/gdg_on_campus_logo.jpg.jpeg'
import '../styles/LeaderboardPage.css'

function formatUpdateTime(iso) {
  if (!iso) return 'not yet updated'
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }) + ' IST'
}

const PAGE_SIZE_OPTIONS = [5, 15, 25, 50]

export default function LeaderboardPage() {
  const [page, setPage]         = useState(1)
  const [limit, setLimit]       = useState(25)
  const [searchInput, setInput] = useState('')
  const [search, setSearch]     = useState('')
  const debounceRef             = useRef(null)

  function handleSearchChange(val) {
    setInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(val)
      setPage(1)
    }, 350)
  }

  function handleClearSearch() {
    setInput('')
    setSearch('')
    setPage(1)
  }

  function handleLimitChange(e) {
    setLimit(Number(e.target.value))
    setPage(1)
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  const { data, loading, error, retry } = useLeaderboard({ page, limit, search })

  const handlePageChange = useCallback((p) => {
    setPage(p)
    window.scrollTo({ top: 350, behavior: 'smooth' })
  }, [])

  return (
    <div className="leaderboard-page-wrapper">
      {/* About Google Cloud Study Jam Section */}
      <div className="container my-5">
        <div className="row align-items-center">
          <div className="col-lg-6 col-md-6 col-sm-12 mb-4 mb-md-0 text-center">
            <img
              src={GDG_MIT_IMG}
              alt="GDG On Campus MIT logo"
              className="img-fluid about-gdg-mit-img"
            />
          </div>
          <div className="col-lg-6 col-md-6 col-sm-12">
            <h3 className="about-title">About Google Cloud Learn with Communities Campaign</h3>
            <p className="about-desc">
              The Google Cloud Learn with Communities Campaign is a learning initiative designed
              to help students develop practical skills in cloud computing, artificial
              intelligence, and other Google Cloud technologies. Participants gain access to
              hands-on labs through Google Skills, explore industry-relevant tools and
              technologies, and earn Google Cloud skill badges and certificates that demonstrate
              their learning achievements. This program provides an opportunity to strengthen
              technical knowledge, gain practical experience, and enhance your academic and
              professional portfolio through structured, hands-on learning.
            </p>
          </div>
        </div>
      </div>

      {/* Main Leaderboard Section (Wider layout) */}
      <div id="leaderboard" className="leaderboard-wide-container my-4">
        {/* Animated heading */}
        <h1 className="genai-heading">Google Cloud Study Jam Leaderboard</h1>

        {/* Search Input Container */}
        <div className="col-12 d-flex justify-content-center mb-3">
          <div className="search-container d-flex align-items-center">
            <input
              type="text"
              placeholder="Search your name..."
              className="form-control me-2"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              aria-label="Search participants by name"
              autoComplete="off"
              spellCheck="false"
            />
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={handleClearSearch}
              aria-label="Clear search"
            >
              X
            </button>
          </div>
        </div>

        {/* Profiles Per Page Dropdown */}
        <div className="dropdowncont d-flex align-items-center justify-content-center mb-3">
          <label htmlFor="myDropdown" className="pagedrop me-2">
            Profiles per page:
          </label>
          <select
            id="myDropdown"
            className="form-select"
            value={limit}
            onChange={handleLimitChange}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* Last Updated Meta Text */}
        <p className="text-center text-muted small mb-3">
          Last updated: {formatUpdateTime(data?.lastSuccessfulUpdate)}
        </p>

        {/* Table Component */}
        <LeaderboardTable
          data={data}
          loading={loading}
          error={error}
          retry={retry}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  )
}
