import BadgeTrack from './BadgeTrack.jsx'
import { ACCEPTED_BADGES } from '../content/acceptedBadges.js'
import { GOLD_BADGES, SILVER_BADGES, UPDATE_INTERVAL_HOURS, formatDate, normalizeTitle } from '../lib/leaderboard.js'
import '../styles/ScoringInfo.css'

const MAX_CREDITS = Math.max(...ACCEPTED_BADGES.map((badge) => badge.credits))

function earnedByMap(badgeStats) {
  if (!Array.isArray(badgeStats)) return null
  const map = new Map()
  for (const stat of badgeStats) {
    if (typeof stat?.earnedBy === 'number') map.set(normalizeTitle(stat.name), stat.earnedBy)
  }
  return map
}

export default function ScoringInfo({ competitionStartDate, badgeStats }) {
  const startDate = formatDate(competitionStartDate)
  const earnedBy = earnedByMap(badgeStats)
  const count = ACCEPTED_BADGES.length
  const summary = startDate
    ? `${count} accepted badges, earned from ${startDate}`
    : `${count} accepted badges`

  return (
    <details className="scoring-info">
      <summary className="scoring-info__summary">
        <span className="scoring-info__label">
          <span className="scoring-info__title">How scoring works</span>
          <span className="scoring-info__summary-text">{summary}</span>
        </span>
        <svg
          className="scoring-info__chevron"
          aria-hidden="true"
          focusable="false"
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </summary>

      <div className="scoring-info__body">
        <section className="scoring-info__block">
          <h2 className="scoring-info__heading">What counts</h2>
          <p className="scoring-info__note">
            {startDate
              ? `Only these ${count} badges count, earned on or after ${startDate}. `
              : `Only these ${count} badges count. `}
            The board updates every {UPDATE_INTERVAL_HOURS} hours.
          </p>
          <div className="scoring-info__badge-head" aria-hidden="true">
            <span>Badge</span>
            <span>Credits</span>
            {earnedBy && <span className="scoring-info__earned" />}
          </div>
          <ul className="scoring-info__badges">
            {ACCEPTED_BADGES.map((badge) => {
              const earners = earnedBy?.get(normalizeTitle(badge.title))
              return (
                <li key={badge.url} className="scoring-info__badge">
                  <a href={badge.url} target="_blank" rel="noopener noreferrer" className="scoring-info__badge-link">
                    {badge.title}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                  <span className="scoring-info__credits">
                    <span className="scoring-info__credits-value">
                      {badge.credits}
                      <span className="visually-hidden"> credits</span>
                    </span>
                    <span className="scoring-info__credits-bar" aria-hidden="true">
                      <span
                        className="scoring-info__credits-fill"
                        style={{ width: `${(badge.credits / MAX_CREDITS) * 100}%` }}
                      />
                    </span>
                  </span>
                  {earnedBy && (
                    <span className="scoring-info__earned">{earners !== undefined && `Earned by ${earners}`}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="scoring-info__block">
          <h2 className="scoring-info__heading">How ranks are decided</h2>
          <ol className="scoring-info__steps">
            <li>More badges.</li>
            <li>Then more credits.</li>
            <li>Then whoever finished their latest counted badge earlier.</li>
          </ol>
          <p className="scoring-info__note">Identical results share a rank.</p>
        </section>

        <section className="scoring-info__block">
          <h2 className="scoring-info__heading">Swag</h2>
          <div className="scoring-info__track">
            <span aria-hidden="true">
              <BadgeTrack count={SILVER_BADGES} size="md" />
            </span>
          </div>
          <ul className="scoring-info__tiers">
            <li>
              <span className="scoring-info__marker scoring-info__marker--silver" aria-hidden="true" />
              Silver: reach {SILVER_BADGES} accepted badges.
            </li>
            <li>
              <span className="scoring-info__marker scoring-info__marker--gold" aria-hidden="true" />
              Gold: reach all {GOLD_BADGES} accepted badges.
            </li>
          </ul>
        </section>
      </div>
    </details>
  )
}
