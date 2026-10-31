import { Link } from 'react-router-dom'
import { GOLD_BADGES, SILVER_BADGES, UPDATE_INTERVAL_HOURS } from '../lib/leaderboard.js'
import { ACCEPTED_BADGES } from '../content/acceptedBadges.js'
import '../styles/CommunityPage.css'

export default function CommunityPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <div className="community-page">
        <header className="community-header">
          <p className="community-header__eyebrow">Community</p>
          <h1 className="community-header__title">GDG on Campus MIT</h1>
          <p className="community-header__desc">
            Students at MIT learning Google technologies together through study jams,
            workshops and coding events.
          </p>
        </header>

        <div className="community-grid">
          <article className="community-card">
            <div className="community-card__accent community-card__accent--blue" />
            <h2 className="community-card__title">About the campaign</h2>
            <p className="community-card__desc">
              The <strong>Google Cloud Study Jam</strong> lets students earn Google Cloud
              badges through hands-on labs on Google Skills. Earn {SILVER_BADGES} accepted
              badges for Silver swag, or all {GOLD_BADGES} for Gold.
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent community-card__accent--green" />
            <h2 className="community-card__title">How to participate</h2>
            <p className="community-card__desc">
              Register through the Google Form shared by GDG on Campus MIT. Keep your Google
              Skills profile public: new badges show on the leaderboard after the next update
              (every {UPDATE_INTERVAL_HOURS} hours).
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent community-card__accent--yellow" />
            <h2 className="community-card__title">Earn badges</h2>
            <p className="community-card__desc">
              Complete the labs for the accepted badges on Google Skills. Only
              the {ACCEPTED_BADGES.length} accepted badges count; see
              {' '}<Link to="/#leaderboard">How scoring works</Link> on the leaderboard
              for the list.
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent community-card__accent--red" />
            <h2 className="community-card__title">Stay connected</h2>
            <p className="community-card__desc">
              Follow{' '}
              <a
                href="https://gdg.community.dev/gdg-on-campus-madras-institute-of-technology-chennai-india/"
                target="_blank"
                rel="noopener noreferrer"
              >
                GDG on Campus MIT on the GDG community site
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
              {' '}for events, deadlines and resources. See the Resources menu
              for study materials.
            </p>
          </article>
        </div>

        <p className="community-disclaimer">
          Swag eligibility is based on confirmed campaign criteria.
          The leaderboard shows eligibility status only — it does not imply
          that swag has been awarded or guaranteed.
        </p>
      </div>
    </main>
  )
}
