import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import GDG_LOGO from '../assets/gdg-on-campus-mit.jpeg'
import AU_LOGO from '../assets/anna-university.png'
import { STORAGE_KEYS, setItem } from '../lib/storage.js'
import '../styles/Navbar.css'

const RESOURCES = [
  { label: 'Onboarding guide', href: 'https://www.instagram.com/p/DAnGLEbNbgz/' },
  { label: 'GenAI tutorials',  href: 'https://gen-ai-tutorials.netlify.app/' },
  { label: 'Syllabus',         href: 'https://docs.google.com/spreadsheets/d/1XoxkJ4OvDwN44iDJt6EUesfuJIYiBj8Y5vl_sVL_dKk/pubhtml?gid=0&single=true' },
]

function currentTheme() {
  return document.documentElement.dataset.bsTheme === 'dark' ? 'dark' : 'light'
}

// The browser bar colour follows the chosen theme, not just the device setting the meta media queries see.
function syncThemeColor() {
  const headerBg = getComputedStyle(document.documentElement).getPropertyValue('--header-bg').trim()
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', headerBg)
  })
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="4.5" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
      </g>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" />
    </svg>
  )
}

export default function Navbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(true)
  const [theme, setTheme] = useState(currentTheme)
  const dropdownRef = useRef(null)
  const { pathname, hash } = useLocation()
  const onLeaderboard = pathname === '/' && hash === '#leaderboard'
  const onHome = pathname === '/' && !onLeaderboard

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    function handleEscape(event) {
      if (event.key === 'Escape') setDropdownOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  // The theme can also change from index.html's listener when the device setting flips.
  useEffect(() => {
    function sync() {
      setTheme(currentTheme())
      syncThemeColor()
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-bs-theme'] })
    return () => observer.disconnect()
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setItem(STORAGE_KEYS.theme, next)
    document.documentElement.dataset.bsTheme = next
  }

  const nextThemeLabel = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <>
      <header className="d-flex align-items-center justify-content-between site-header">
        <Link to="/" aria-label="Home">
          <img src={GDG_LOGO} alt="GDG on Campus MIT logo" className="header-logo" width="105" height="105" />
        </Link>

        <p className="text-center m-0 d-none d-md-block header-title">
          Google Developer Groups on Campus <br />
          Madras Institute of Technology
        </p>

        <img src={AU_LOGO} alt="Anna University logo" className="header-logo d-none d-md-block" width="105" height="104" />

        <p className="text-center m-0 d-md-none header-title-mobile">
          GDG MIT
        </p>
      </header>

      <nav className="navbar navbar-expand-lg site-navbar">
        <div className="container">
          <button
            type="button"
            className="navbar-toggler"
            aria-controls="navbarNav"
            aria-expanded={!navCollapsed}
            aria-label="Toggle navigation"
            onClick={() => setNavCollapsed((prev) => !prev)}
          >
            <span className="navbar-toggler-icon" />
          </button>

          <button
            type="button"
            className="theme-toggle order-lg-last"
            aria-label={nextThemeLabel}
            title={nextThemeLabel}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <div id="navbarNav" className={`collapse navbar-collapse ${navCollapsed ? '' : 'show'}`}>
            <ul className="navbar-nav mx-auto">
              <li className="nav-item">
                <Link
                  to="/"
                  className={`nav-link ${onHome ? 'active' : ''}`}
                  aria-current={onHome ? 'page' : undefined}
                  onClick={() => setNavCollapsed(true)}
                >
                  Home
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  to="/#leaderboard"
                  className={`nav-link ${onLeaderboard ? 'active' : ''}`}
                  aria-current={onLeaderboard ? 'location' : undefined}
                  onClick={() => setNavCollapsed(true)}
                >
                  Leaderboard
                </Link>
              </li>
              <li className="nav-item">
                <NavLink
                  to="/community"
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setNavCollapsed(true)}
                >
                  Community
                </NavLink>
              </li>

              <li className={`nav-item dropdown ${dropdownOpen ? 'show' : ''}`} ref={dropdownRef}>
                <button
                  type="button"
                  id="navbarDropdown"
                  className="nav-link dropdown-toggle btn-link-nav"
                  aria-expanded={dropdownOpen}
                  onClick={() => setDropdownOpen((prev) => !prev)}
                >
                  Resources
                </button>
                <ul
                  className={`dropdown-menu ${dropdownOpen ? 'show' : ''}`}
                  aria-labelledby="navbarDropdown"
                >
                  {RESOURCES.map((item) => (
                    <li key={item.label}>
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="dropdown-item"
                        onClick={() => {
                          setDropdownOpen(false)
                          setNavCollapsed(true)
                        }}
                      >
                        {item.label}
                        <span className="visually-hidden"> (opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>

              <li className="nav-item">
                <a
                  href="https://forms.gle/8fzdaf1Pz2YkBbnA8"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-link"
                  onClick={() => setNavCollapsed(true)}
                >
                  Contact
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </>
  )
}
