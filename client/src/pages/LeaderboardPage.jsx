import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLeaderboard } from '../hooks/useLeaderboard.js'
import { fetchParticipant } from '../api.js'
import { formatDateTimeIST, formatTimeIST, nextUpdateEstimate, relativeTime, plural } from '../lib/leaderboard.js'
import { scrollBehavior } from '../lib/motion.js'
import LeaderboardTable from '../components/LeaderboardTable.jsx'
import BadgeModal from '../components/BadgeModal.jsx'
import Podium from '../components/Podium.jsx'
import ScoringInfo from '../components/ScoringInfo.jsx'
import ActivityChart from '../components/ActivityChart.jsx'
import MeBar from '../components/MeBar.jsx'
import GDG_LOGO from '../assets/gdg-on-campus-mit.jpeg'
import '../styles/LeaderboardPage.css'

const PAGE_SIZE_OPTIONS = [5, 15, 25, 50]
const DEFAULT_LIMIT = 25
const SEARCH_MAX = 100
const SEARCH_DEBOUNCE_MS = 350

function isTypingTarget(el) {
  return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function readPage(value) {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : 1
}

function readLimit(value) {
  const n = Number(value)
  return PAGE_SIZE_OPTIONS.includes(n) ? n : DEFAULT_LIMIT
}

// Defaults stay out of the URL so a plain link to the board is just "/"
function toSearchParams({ q, page, limit }) {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  if (limit !== DEFAULT_LIMIT) params.set('limit', String(limit))
  return params
}

function Freshness({ summary, now }) {
  const updated = summary.lastSuccessfulUpdate
  if (!updated) return <>{plural(summary.total, 'participant')}. Not updated yet.</>
  const next = nextUpdateEstimate(updated, now)
  return (
    <>
      {plural(summary.total, 'participant')}. Updated{' '}
      <time dateTime={updated} title={formatDateTimeIST(updated)}>{relativeTime(updated, now)}</time>.
      {next && (
        <>
          {' '}Next update expected around{' '}
          <time dateTime={next} title={formatDateTimeIST(next)}>{formatTimeIST(next)} IST</time>.
        </>
      )}
    </>
  )
}

export default function LeaderboardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { userId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()

  const search = (searchParams.get('q') ?? '').slice(0, SEARCH_MAX)
  const page = readPage(searchParams.get('page'))
  const limit = readLimit(searchParams.get('limit'))

  const [searchInput, setSearchInput] = useState(search)
  const [urlSearch, setUrlSearch] = useState(search)
  const [selected, setSelected] = useState(null)
  const [linked, setLinked] = useState(null)
  const [retryCount, setRetryCount] = useState(0)
  const [overview, setOverview] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [aboutOpen, setAboutOpen] = useState(false)
  const debounceRef = useRef(null)
  const searchRef = useRef(null)

  // Back/forward changes ?q= without typing; the field follows the URL
  if (search !== urlSearch) {
    setUrlSearch(search)
    setSearchInput(search)
  }

  const { data, dataKey, loading, error, retry, refreshCount } = useLeaderboard({ page, limit, search })
  const refreshKey = retryCount + refreshCount

  let participant = null
  if (userId) {
    if (selected && String(selected.userId) === userId) participant = selected
    else if (linked && String(linked.userId) === userId) participant = linked
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  // A pending keystroke must not overwrite a search the back button just restored
  useEffect(() => {
    clearTimeout(debounceRef.current)
  }, [search])

  useEffect(() => {
    if (!userId || (selected && String(selected.userId) === userId)) return
    let cancelled = false
    fetchParticipant(userId)
      .then((row) => {
        if (!cancelled) setLinked(row)
      })
      .catch(() => {
        if (cancelled) return
        navigate({ pathname: '/', search: window.location.search }, { replace: true })
      })
    return () => { cancelled = true }
  }, [userId, selected, navigate])

  // "/" must not pull focus out of the open badge popup
  const popupOpen = participant !== null
  useEffect(() => {
    if (popupOpen) return
    function handleKeyDown(e) {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [popupOpen])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const handleOverview = useCallback((overviewData) => {
    setOverview({ total: overviewData.pagination.total, lastSuccessfulUpdate: overviewData.lastSuccessfulUpdate })
    setNow(Date.now())
  }, [])

  const updateQuery = useCallback((changes, options) => {
    setSearchParams(toSearchParams({ q: search, page, limit, ...changes }), options)
  }, [setSearchParams, search, page, limit])

  // A shared link can point past the last page once the board shrinks
  const totalPages = data?.pagination.totalPages
  useEffect(() => {
    if (!loading && !error && totalPages >= 1 && page > totalPages) updateQuery({ page: totalPages }, { replace: true })
  }, [loading, error, totalPages, page, updateQuery])

  function handleSearchChange(val) {
    setSearchInput(val)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setUrlSearch(val)
      updateQuery({ q: val, page: 1 }, { replace: true })
    }, SEARCH_DEBOUNCE_MS)
  }

  function handleClearSearch() {
    clearTimeout(debounceRef.current)
    setSearchInput('')
    setUrlSearch('')
    updateQuery({ q: '', page: 1 }, { replace: true })
    searchRef.current?.focus()
  }

  function handleSearchKeyDown(e) {
    if (e.key === 'Escape' && searchInput !== '') {
      e.preventDefault()
      handleClearSearch()
    }
  }

  function handleLimitChange(e) {
    updateQuery({ limit: Number(e.target.value), page: 1 })
  }

  function handlePageChange(p) {
    updateQuery({ page: p })
    document.getElementById('leaderboard')?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
  }

  function handleRetry() {
    retry()
    setRetryCount((n) => n + 1)
  }

  const open = useCallback((row) => {
    setSelected(row)
    navigate(
      { pathname: `/p/${encodeURIComponent(row.userId)}`, search: window.location.search },
      { state: { fromApp: true } },
    )
  }, [navigate])

  // BadgeModal re-binds its listeners when onClose changes, so it gets one stable function
  const locationRef = useRef(location)
  useEffect(() => {
    locationRef.current = location
  })
  const closeModal = useCallback(() => {
    const current = locationRef.current
    if (current.state?.fromApp) navigate(-1)
    else navigate({ pathname: '/', search: current.search }, { replace: true })
  }, [navigate])

  const searching = search !== ''
  // The podium's unfiltered request is the source; an unfiltered table load covers a failed podium request
  const summary = overview ?? (!searching && data && !error
    ? { total: data.pagination.total, lastSuccessfulUpdate: data.lastSuccessfulUpdate }
    : null)
  const searchTotal = searching && data && !loading && !error ? data.pagination.total : null
  let searchStatus = ''
  if (searchTotal !== null) {
    searchStatus = summary
      ? `Showing ${searchTotal} of ${plural(summary.total, 'participant')}`
      : `Showing ${plural(searchTotal, 'participant')}`
  }
  // The cached copy carries its own crawl time, which matches the freshness line above it
  const cachedAt = !loading && data?.servedFromCacheAt
    ? formatDateTimeIST(data.lastSuccessfulUpdate ?? data.servedFromCacheAt)
    : null
  // A refresh while the popup is open must not leave it showing the counts it was opened with
  const refreshed = participant && data?.rows?.find((row) => String(row.userId) === String(participant.userId))
  const shown = refreshed ? { ...participant, ...refreshed } : participant

  return (
    <main id="main-content" tabIndex={-1} className="leaderboard-page-wrapper">
      <div className="container about-section">
        <div className="row align-items-center">
          <div className="col-lg-6 col-md-6 col-sm-12 text-center about-media">
            <img
              src={GDG_LOGO}
              alt="GDG on Campus MIT logo"
              width="320"
              height="320"
              className="img-fluid about-gdg-mit-img"
            />
          </div>
          <div className="col-lg-6 col-md-6 col-sm-12">
            <h2 className="about-title">About the Google Cloud Study Jam</h2>
            <p id="about-desc" className={`about-desc${aboutOpen ? ' is-open' : ''}`}>
              Google Cloud Learn with Communities, run at MIT as the Google Cloud Study Jam,
              gives students free hands-on labs on Google Skills. Complete the accepted labs to
              earn badges; this leaderboard ranks participants by badges, then credits.
            </p>
            <button
              type="button"
              className="about-toggle"
              aria-expanded={aboutOpen}
              aria-controls="about-desc"
              onClick={() => setAboutOpen((v) => !v)}
            >
              {aboutOpen ? 'Show less' : 'Read more'}
            </button>
          </div>
        </div>
      </div>

      <section id="leaderboard" className="leaderboard-wide-container my-4" aria-labelledby="leaderboard-heading">
        <h1 id="leaderboard-heading" className="leaderboard-heading">Google Cloud Study Jam leaderboard</h1>
        <div className="heading-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        {summary && (
          <p className="heading-meta">
            <Freshness summary={summary} now={now} />
          </p>
        )}

        <Podium onViewBadges={open} refreshKey={refreshKey} onLoaded={handleOverview} />

        <div className="leaderboard-toolbar">
          <div className="search-field">
            <svg className="search-field__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M16.5 16.5 21 21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              placeholder="Search by name"
              className="search-field__input"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              aria-label="Search participants by name"
              aria-keyshortcuts="/"
              maxLength={SEARCH_MAX}
              autoComplete="off"
              spellCheck="false"
            />
            {searchInput === '' ? (
              <kbd className="search-field__hint" aria-hidden="true">/</kbd>
            ) : (
              <button
                type="button"
                className="search-field__clear"
                onClick={handleClearSearch}
                aria-label="Clear search"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>

          <div className="page-size">
            <label htmlFor="page-size" className="page-size__label">Show</label>
            <select
              id="page-size"
              className="form-select form-select-sm page-size__select"
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
        </div>

        <p className="search-status" aria-live="polite">{searchStatus}</p>

        <p className="offline-note" role="status">
          {cachedAt && `Offline. Showing data from ${cachedAt}.`}
        </p>

        <LeaderboardTable
          data={data}
          dataKey={dataKey}
          loading={loading}
          error={error}
          onRetry={handleRetry}
          onPageChange={handlePageChange}
          onViewBadges={open}
          searching={searching}
        />

        <ActivityChart dailyCounts={data?.dailyCounts} />

        <ScoringInfo competitionStartDate={data?.competitionStartDate} badgeStats={data?.badgeStats} />
      </section>

      {shown && <BadgeModal participant={shown} onClose={closeModal} />}

      <MeBar refreshKey={refreshKey} onOpen={open} />
    </main>
  )
}
