/**
 * App.jsx — Root component with routing.
 */

import { Routes, Route } from 'react-router-dom'
import Navbar from './components/Navbar.jsx'
import Footer from './components/Footer.jsx'
import LeaderboardPage from './pages/LeaderboardPage.jsx'
import CommunityPage from './pages/CommunityPage.jsx'

export default function App() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Navbar />

      {/* Skip to main content (accessibility) */}
      <a
        href="#main-content"
        style={{
          position: 'absolute', left: '-9999px', top: 'auto',
          width: '1px', height: '1px', overflow: 'hidden',
        }}
        onFocus={(e) => { e.currentTarget.style.cssText = 'position:fixed;left:16px;top:16px;z-index:9999;padding:8px 16px;background:var(--blue);color:#fff;border-radius:4px;font-weight:600;width:auto;height:auto;' }}
        onBlur={(e) => { e.currentTarget.style.cssText = 'position:absolute;left:-9999px;top:auto;width:1px;height:1px;overflow:hidden;' }}
      >
        Skip to main content
      </a>

      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<LeaderboardPage />} />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="*" element={
            <main id="main-content" className="container" style={{ padding: '64px 24px', textAlign: 'center' }}>
              <h1 style={{ fontSize: '2rem', marginBottom: 12 }}>404 — Page not found</h1>
              <p style={{ color: 'var(--mid)' }}>The page you're looking for doesn't exist.</p>
              <a href="/" style={{ display: 'inline-block', marginTop: 24, padding: '10px 24px', background: 'var(--blue)', color: '#fff', borderRadius: 8, fontWeight: 500, textDecoration: 'none' }}>
                Go to Leaderboard
              </a>
            </main>
          } />
        </Routes>
      </div>

      <Footer />
    </div>
  )
}
