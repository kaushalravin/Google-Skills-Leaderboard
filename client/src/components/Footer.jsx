/**
 * Footer.jsx — Site footer with attribution.
 */

import '../styles/Footer.css'

const CURRENT_YEAR = new Date().getFullYear()

export default function Footer() {
  return (
    <footer className="footer" aria-label="Site footer">
      <div className="footer__inner">
        <p className="footer__copy">
          © {CURRENT_YEAR} GDG MIT — Google Cloud Learn with Communities · Google Cloud Study Jam
        </p>
        <nav className="footer__links" aria-label="Footer links">
          <a
            href="https://www.skills.google"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Google Skills (opens in new tab)"
          >
            Google Skills
          </a>
        </nav>
      </div>
    </footer>
  )
}
