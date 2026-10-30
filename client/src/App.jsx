import { useEffect, useRef } from 'react'
import { Routes, Route, Link, useLocation, useNavigationType } from 'react-router-dom'
import { scrollBehavior } from './lib/motion.js'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import CommunityPage from './pages/CommunityPage.jsx'

// The popup route /p/:userId is the leaderboard with a participant open, not a separate page
function pageOf(pathname) {
  return pathname.startsWith('/p/') ? '/' : pathname
}

function useScrollOnNavigate() {
  const { pathname, search, hash, key } = useLocation()
  const navigationType = useNavigationType()
  const previous = useRef(null)

  // key changes on every navigation, so clicking the same hash link scrolls again
  useEffect(() => {
    const last = previous.current
    previous.current = { pathname, search }
    // Reloads and back/forward (POP) keep the browser's restored position unless there is a target
    if (navigationType === 'POP' && !hash) return
    // Opening or closing a popup, or changing ?q/page/limit, keeps the reader where they are
    if (!hash && last && pageOf(last.pathname) === pageOf(pathname)
      && (last.pathname !== pathname || last.search !== search)) return

    function scroll() {
      const target = hash ? document.getElementById(decodeURIComponent(hash.slice(1))) : null
      if (target) target.scrollIntoView({ behavior: scrollBehavior(), block: 'start' })
      else if (!hash) window.scrollTo({ top: 0, behavior: scrollBehavior() })
    }
    scroll()
    // On a cold load, images above the target can still shift it down
    if (hash && document.readyState !== 'complete') {
      window.addEventListener('load', scroll, { once: true })
      return () => window.removeEventListener('load', scroll)
    }
  }, [pathname, search, hash, key, navigationType])
}

function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="container not-found">
      <h1 className="not-found__title">404 — Page not found</h1>
      <p className="not-found__desc">The page you're looking for doesn't exist.</p>
      <Link to="/" className="not-found__link">Go to the leaderboard</Link>
    </main>
  )
}

export default function App() {
  useScrollOnNavigate()

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <Navbar />

      <div className="app-shell__content">
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/p/:userId" element={<LeaderboardPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      <Footer />
    </div>
  )
}
