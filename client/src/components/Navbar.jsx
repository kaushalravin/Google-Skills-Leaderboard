/**
 * Navbar.jsx
 *
 * Replicates the exact header and navbar from the GDG MIT study jam page:
 *  - Header: GDG Logo (left), Title (center), Anna University Logo (right)
 *  - Navbar: Home, Leaderboard, Community, Resources (Dropdown), Contact
 */

import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import GDG_LOGO from '../assets/gdg_on_campus_logo.jpg.jpeg'
import AU_LOGO from '../assets/Anna_University.png'
import '../styles/Navbar.css'

const RESOURCES = [
  { label: 'Onboarding Guide', href: 'https://www.instagram.com/p/DAnGLEbNbgz/' },
  { label: 'GenAI Tutorials',  href: 'https://gen-ai-tutorials.netlify.app/' },
  { label: 'Syllabus',         href: 'https://docs.google.com/spreadsheets/d/1XoxkJ4OvDwN44iDJt6EUesfuJIYiBj8Y5vl_sVL_dKk/pubhtml?gid=0&single=true' },
]

export default function Navbar() {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(true)
  const dropdownRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <>
      {/* Top Header matching reference */}
      <header className="d-flex align-items-center justify-content-between bg-light p-3 site-header">
        <NavLink to="/" aria-label="GDG Home">
          <img src={GDG_LOGO} alt="GDG On Campus MIT logo" className="header-logo" />
        </NavLink>

        <h1 className="text-center m-0 d-none d-md-block header-title" style={{ color: '#4285F4' }}>
          Google Developer Groups On Campus <br />
          Madras Institute of Technology
        </h1>

        <img src={AU_LOGO} alt="Anna University Logo" className="header-logo d-none d-md-block" />

        <h1 className="text-center m-0 d-md-none header-title-mobile" style={{ color: '#4285F4' }}>
          GDG - MIT
        </h1>
      </header>

      {/* Main Navigation Bar */}
      <nav className="navbar navbar-expand-lg navbar-light bg-white site-navbar">
        <div className="container">
          <button
            type="button"
            className="navbar-toggler"
            aria-controls="navbarNav"
            aria-expanded={!navCollapsed}
            aria-label="Toggle navigation"
            onClick={() => setNavCollapsed(prev => !prev)}
          >
            <span className="navbar-toggler-icon" />
          </button>

          <div id="navbarNav" className={`collapse navbar-collapse ${navCollapsed ? '' : 'show'}`}>
            <ul className="navbar-nav mx-auto">
              <li className="nav-item">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setNavCollapsed(true)}
                >
                  Home
                </NavLink>
              </li>
              <li className="nav-item">
                <NavLink
                  to="/"
                  end
                  className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => setNavCollapsed(true)}
                >
                  Leaderboard
                </NavLink>
              </li>
              <li className="nav-item">
                <a
                  href="https://gdg.community.dev/gdg-on-campus-madras-institute-of-technology-chennai-india/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nav-link"
                  onClick={() => setNavCollapsed(true)}
                >
                  Community
                </a>
              </li>

              {/* Resources Dropdown */}
              <li className={`nav-item dropdown ${dropdownOpen ? 'show' : ''}`} ref={dropdownRef}>
                <button
                  type="button"
                  id="navbarDropdown"
                  className="nav-link dropdown-toggle btn-link-nav"
                  aria-expanded={dropdownOpen}
                  onClick={() => setDropdownOpen(prev => !prev)}
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
                </a>
              </li>
            </ul>
          </div>
        </div>
      </nav>
    </>
  )
}
