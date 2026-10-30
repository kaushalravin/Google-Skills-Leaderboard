/**
 * CommunityPage.jsx — GDG MIT community landing page.
 */

import '../styles/CommunityPage.css'

export default function CommunityPage() {
  return (
    <main id="main-content" aria-label="Community">
      <div className="community-page">
        {/* Header */}
        <header className="community-header">
          <p className="community-header__eyebrow">GDG MIT</p>
          <h1 className="community-header__title">
            Google Developer Group<br />MIT Campus
          </h1>
          <p className="community-header__desc">
            A community of students passionate about learning Google technologies,
            collaborating on projects, and growing together through study jams,
            workshops, and coding events.
          </p>
        </header>

        {/* Info cards */}
        <div className="community-grid">
          <article className="community-card">
            <div className="community-card__accent" style={{ background: '#4285F4' }} />
            <h2 className="community-card__title">About the Campaign</h2>
            <p className="community-card__desc">
              The <strong>Google Cloud Learn with Communities</strong> (Google Cloud Study Jam)
              program lets students earn Google Cloud skill badges through hands-on labs.
              MIT students who earn 5 eligible badges qualify for Silver swag;
              10 badges qualifies for Gold.
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent" style={{ background: '#34A853' }} />
            <h2 className="community-card__title">How to Participate</h2>
            <p className="community-card__desc">
              Register through the Google Form shared by GDG MIT.
              Your public Google Skills profile will be crawled automatically every
              6 hours and your badge count will be reflected on this leaderboard.
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent" style={{ background: '#FBBC05' }} />
            <h2 className="community-card__title">Earn Your Badges</h2>
            <p className="community-card__desc">
              Complete eligible Google Cloud skill badge labs on
              Google Cloud Skills Boost. Only the specific badges defined by the
              campaign count towards your eligibility — check the Syllabus
              (available in Resources) for the complete badge list.
            </p>
          </article>

          <article className="community-card">
            <div className="community-card__accent" style={{ background: '#EA4335' }} />
            <h2 className="community-card__title">Stay Connected</h2>
            <p className="community-card__desc">
              Join GDG MIT channels to stay updated on events, deadlines, and
              resources. Community links will be listed here once confirmed.
              See the Resources menu for study materials.
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
