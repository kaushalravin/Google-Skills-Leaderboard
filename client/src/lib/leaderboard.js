export const SILVER_BADGES = 5
export const GOLD_BADGES = 10
export const UPDATE_INTERVAL_HOURS = 6

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function swagTier(count) {
  if (count >= GOLD_BADGES) return 'gold'
  if (count >= SILVER_BADGES) return 'silver'
  return null
}

// Rows arrive in API rank order; tied ranks can push more than three people onto the podium.
export function podiumEntries(rows) {
  const qualifying = (rows ?? []).filter((row) => row.validBadgeCount >= 1 && row.rank <= 3)
  const entries = qualifying.slice(0, 3)
  return { entries, extraTied: qualifying.length - entries.length }
}

const PLACES = { 1: '1st', 2: '2nd', 3: '3rd' }

export function placeLabel(rank) {
  return PLACES[rank]
}

export function initials(name) {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0]).join('')
  return letters.toUpperCase() || '?'
}

// Every formatter returns null for a missing or unparseable date
function toDate(iso) {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTimeIST(iso) {
  const date = toDate(iso)
  if (!date) return null
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }) + ' IST'
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// A small clock skew can put the update slightly in the future; treat it as just now.
export function relativeTime(iso, now = Date.now()) {
  const date = toDate(iso)
  if (!date) return null
  const elapsed = now - date.getTime()
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${plural(Math.floor(elapsed / MINUTE_MS), 'minute')} ago`
  if (elapsed < DAY_MS) return `${plural(Math.floor(elapsed / HOUR_MS), 'hour')} ago`
  return `${plural(Math.floor(elapsed / DAY_MS), 'day')} ago`
}

export function formatTimeIST(iso) {
  const date = toDate(iso)
  if (!date) return null
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

// The crawl runs every UPDATE_INTERVAL_HOURS; a missed or late crawl leaves no honest estimate.
export function nextUpdateEstimate(lastSuccessfulUpdate, now = Date.now()) {
  const last = toDate(lastSuccessfulUpdate)
  if (!last) return null
  const next = last.getTime() + UPDATE_INTERVAL_HOURS * HOUR_MS
  if (next <= now) return null
  return new Date(next).toISOString()
}

// previousRank absent means the snapshot predates movement tracking; null means new since the last crawl.
export function rankChange(row) {
  if (!row || row.previousRank === undefined) return null
  if (row.previousRank === null) return { direction: 'new', by: 0 }
  const by = row.previousRank - row.rank
  if (by > 0) return { direction: 'up', by }
  if (by < 0) return { direction: 'down', by: -by }
  return { direction: 'same', by: 0 }
}

export function nextGoals(me, ahead) {
  if (!me) return []
  const count = me.validBadgeCount ?? 0
  const goals = []
  if (count < SILVER_BADGES) goals.push(`${plural(SILVER_BADGES - count, 'badge')} to Silver`)
  else if (count < GOLD_BADGES) goals.push(`${plural(GOLD_BADGES - count, 'badge')} to Gold`)
  if (ahead) {
    const gap = (ahead.validBadgeCount ?? 0) - count
    if (gap > 0) goals.push(`${plural(gap, 'badge')} to reach #${ahead.rank}`)
    else if (ahead.validCredits !== me.validCredits) goals.push(`Tied on badges with #${ahead.rank}; credits decide`)
    else goals.push(`Tied on badges and credits with #${ahead.rank}; the earlier finish decides`)
  }
  return goals.slice(0, 2)
}

// Same normalization the server uses for badge names: trim, collapse spaces, lowercase.
export function normalizeTitle(title) {
  return String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function missingBadges(earnedBadges, acceptedBadges) {
  const earned = new Set((earnedBadges ?? []).map((badge) => normalizeTitle(badge?.name)))
  return (acceptedBadges ?? []).filter((badge) => !earned.has(normalizeTitle(badge.title)))
}

export function peakDay(dailyCounts) {
  let peak = null
  for (const day of dailyCounts ?? []) {
    if (day.count > 0 && (!peak || day.count > peak.count)) peak = day
  }
  return peak
}

// dailyCounts dates are 'YYYY-MM-DD' calendar days
export function formatDayMonth(isoDate) {
  const date = toDate(isoDate)
  if (!date) return null
  return `${date.getUTCDate()} ${SHORT_MONTHS[date.getUTCMonth()]}`
}

export function trackFill(count) {
  return Math.min(GOLD_BADGES, Math.max(0, Math.floor(Number(count) || 0)))
}

// Profile dates are calendar dates stored as UTC midnight, so format them in UTC.
export function formatDate(iso) {
  const date = toDate(iso)
  if (!date) return null
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Built by hand because ICU versions disagree on short months ("Sep" vs "Sept")
export function formatShortDate(iso) {
  const dayMonth = formatDayMonth(iso)
  return dayMonth && `${dayMonth} ${toDate(iso).getUTCFullYear()}`
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// Credits are null on snapshots built before credits were ranked; leave them out rather than show 0.
function summaryParts(row) {
  const parts = [plural(row.validBadgeCount ?? 0, 'badge')]
  if (typeof row.validCredits === 'number') parts.push(plural(row.validCredits, 'credit'))
  return parts
}

export function badgeSummary(row) {
  return summaryParts(row).join(' · ')
}

// Starts with the visible "7 badges · 41 credits" so speech users can say what they see (WCAG 2.5.3).
export function badgeButtonLabel(row) {
  return `${summaryParts(row).join(', ')}, view badges for ${row.username}`
}

export function formatCredits(value) {
  return value == null ? '—' : value
}
