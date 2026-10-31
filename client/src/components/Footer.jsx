import { useEffect, useState } from 'react'
import { fetchHealth } from '../api.js'
import { formatTimeIST } from '../lib/leaderboard.js'
import '../styles/Footer.css'

const CURRENT_YEAR = new Date().getFullYear()

function describeHealth(health) {
  if (health?.status === 'ok') {
    const time = formatTimeIST(health.lastSuccessfulUpdate)
    return { tone: 'ok', text: time ? `All systems normal. Last update ${time} IST` : 'All systems normal' }
  }
  if (health?.status === 'degraded') return { tone: 'degraded', text: 'Data may be out of date' }
  return { tone: 'unavailable', text: 'Status unavailable' }
}

export default function Footer() {
  const [health, setHealth] = useState(null)

  // Re-checked when the tab comes back, like the board, so the footer never trails the data above it
  useEffect(() => {
    let active = true
    function load() {
      fetchHealth()
        .then((body) => { if (active) setHealth(describeHealth(body)) })
        .catch(() => { if (active) setHealth(describeHealth(null)) })
    }
    function handleVisibility() {
      if (document.visibilityState === 'visible') load()
    }
    load()
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      active = false
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  return (
    <footer className="footer">
      <div className="footer__inner">
        <p className="footer__copy">
          © {CURRENT_YEAR} GDG on Campus MIT · Google Cloud Study Jam
          <br />
          Built by Kaushal N and Sharukesh Alagiri
        </p>
        {health && (
          <p className={`footer__status footer__status--${health.tone}`}>
            <span className="footer__status-dot" aria-hidden="true" />
            {health.text}
          </p>
        )}
        <div className="footer__links">
          <a href="https://www.skills.google" target="_blank" rel="noopener noreferrer">
            Google Skills
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </footer>
  )
}
