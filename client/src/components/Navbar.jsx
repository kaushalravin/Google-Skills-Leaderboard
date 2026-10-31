import { useState, useRef, useEffect } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import GDG_LOGO from '../assets/gdg-on-campus-mit.jpeg'
import AU_LOGO from '../assets/anna-university.png'
import GOOGLE_CLOUD_LOGO from '../assets/google-cloud.jpg'
import GDG from '../assets/gdg.png'
import ONBOARDING_GUIDE from '../assets/GDG_Learn_with_Communities_Onboarding_Guide.pdf'
import '../styles/Navbar.css'

const RESOURCES = [
  { label: 'Onboarding guide', href: ONBOARDING_GUIDE, download: 'GDG-On-Campus-MIT-Onboarding-Guide.pdf' },
  { label: 'Syllabus',         href: 'https://docs.google.com/spreadsheets/u/0/d/e/2PACX-1vTVMEFW24yi5IVcBblZFEK5xMdQyeF9pndf-wxE37BKu5hyOghhSkYiCHW6rSLjNJd5U3OI_E_I9vZi/pubhtml?gid=411469390&single=true&pli=1' },
]

export default function Navbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(true)
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

  return (
    <>
      <header className="d-flex align-items-center justify-content-between site-header">
        <Link to="/" aria-label="Home">
          <img
            src={GDG_LOGO}
            alt="GDG on Campus MIT logo"
            className="header-logo d-none d-md-block"
            width="105"
            height="105"
          />
          <img
            src={GDG}
            alt="Google Developer Groups logo"
            className="header-logo d-md-none"
            width="65"
            height="65"
          />
        </Link>

        <p className="text-center m-0 d-md-none header-title-mobile">
          <span className="header-title__blue">Google</span>{' '}
          <span className="header-title__red">Developer</span>{' '}
          <span className="header-title__yellow">Groups</span>{' '}
          <span className="header-title__green">on Campus</span> <br />
          <span className="header-title__blue">Madras Institute of Technology</span>
        </p>

        <p className="text-center m-0 d-none d-md-block header-title">
          <span className="header-title__blue">Google</span>{' '}
          <span className="header-title__red">Developer</span>{' '}
          <span className="header-title__yellow">Groups</span>{' '}
          <span className="header-title__green">on Campus</span> <br />
          <span className="header-title__blue">Madras Institute of Technology</span>
        </p>

        <img src={AU_LOGO} alt="Anna University logo" className="header-logo d-none d-md-block" width="105" height="104" />

        <img
          src={GOOGLE_CLOUD_LOGO}
          alt="Google Cloud logo"
          className="header-cloud-logo d-md-none"
          width="65"
          height="65"
        />
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
                <a
                  href="https://gdg.community.dev/gdg-on-campus-madras-institute-of-technology-chennai-india/"
                  className="nav-link"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setNavCollapsed(true)}
                >
                  Community
                </a>
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
                        target={item.download ? undefined : '_blank'}
                        rel={item.download ? undefined : 'noopener noreferrer'}
                        download={item.download}
                        className="dropdown-item"
                        onClick={() => {
                          setDropdownOpen(false)
                          setNavCollapsed(true)
                        }}
                      >
                        {item.label}
                        <span className="visually-hidden">
                          {item.download ? ' (downloads PDF)' : ' (opens in a new tab)'}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>

              <li className="nav-item">
                <NavLink
                  to="/contact"
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setNavCollapsed(true)}
                >
                  Contact
                </NavLink>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </>
  )
}
