import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  swagTier,
  podiumEntries,
  placeLabel,
  initials,
  formatDate,
  formatDateTimeIST,
  plural,
  formatCredits,
  badgeSummary,
  badgeButtonLabel,
  relativeTime,
  formatTimeIST,
  nextUpdateEstimate,
  rankChange,
  nextGoals,
  missingBadges,
  normalizeTitle,
  peakDay,
  formatDayMonth,
  trackFill,
  formatShortDate,
} from './leaderboard.js'

const row = (rank, validBadgeCount, username = `user${rank}-${validBadgeCount}`) => ({ rank, validBadgeCount, username })

test('swagTier gives silver from 5 badges and gold from 10', () => {
  assert.equal(swagTier(0), null)
  assert.equal(swagTier(4), null)
  assert.equal(swagTier(5), 'silver')
  assert.equal(swagTier(9), 'silver')
  assert.equal(swagTier(10), 'gold')
  assert.equal(swagTier(11), 'gold')
})

test('podium keeps a tie at rank 1 (1, 1, 3)', () => {
  const rows = [row(1, 8, 'a'), row(1, 8, 'b'), row(3, 6, 'c'), row(4, 5, 'd')]
  const { entries, extraTied } = podiumEntries(rows)
  assert.deepEqual(entries.map((r) => r.rank), [1, 1, 3])
  assert.equal(extraTied, 0)
})

test('podium counts a 4-way tie at rank 3', () => {
  const rows = [row(1, 9), row(2, 7), row(3, 5, 'c'), row(3, 5, 'd'), row(3, 5, 'e'), row(3, 5, 'f'), row(7, 2)]
  const { entries, extraTied } = podiumEntries(rows)
  assert.deepEqual(entries.map((r) => r.username), ['user1-9', 'user2-7', 'c'])
  assert.equal(extraTied, 3)
})

test('podium shows only participants with at least one badge', () => {
  const rows = [row(1, 3), row(2, 1), row(3, 0), row(3, 0)]
  const { entries, extraTied } = podiumEntries(rows)
  assert.equal(entries.length, 2)
  assert.equal(extraTied, 0)
})

test('podium is empty when nobody has badges', () => {
  assert.deepEqual(podiumEntries([row(1, 0), row(1, 0), row(1, 0)]), { entries: [], extraTied: 0 })
  assert.deepEqual(podiumEntries([]), { entries: [], extraTied: 0 })
  assert.deepEqual(podiumEntries(undefined), { entries: [], extraTied: 0 })
})

test('placeLabel names the three podium places', () => {
  assert.equal(placeLabel(1), '1st')
  assert.equal(placeLabel(2), '2nd')
  assert.equal(placeLabel(3), '3rd')
})

test('initials takes the first letter of the first two words', () => {
  assert.equal(initials('Meera Iyer'), 'MI')
  assert.equal(initials('  ada  lovelace byron '), 'AL')
  assert.equal(initials('madonna'), 'M')
  assert.equal(initials(''), '?')
  assert.equal(initials(null), '?')
})

test('formatDate uses the calendar date', () => {
  assert.equal(formatDate('2026-10-26T00:00:00.000Z'), '26 October 2026')
  assert.equal(formatDate(null), null)
  assert.equal(formatDate('not a date'), null)
})

test('formatShortDate uses the calendar date', () => {
  assert.equal(formatShortDate('2026-10-27T00:00:00.000Z'), '27 Oct 2026')
  assert.equal(formatShortDate('2026-11-05T00:00:00.000Z'), '5 Nov 2026')
  assert.equal(formatShortDate('2026-09-05T00:00:00.000Z'), '5 Sep 2026')
  assert.equal(formatShortDate('not a date'), null)
  assert.equal(formatShortDate(null), null)
})

test('formatDateTimeIST shows the date and time in IST', () => {
  assert.match(formatDateTimeIST('2026-10-26T00:00:00.000Z'), /^26 October 2026.*05:30.*IST$/i)
  assert.equal(formatDateTimeIST(null), null)
  assert.equal(formatDateTimeIST('not a date'), null)
})

test('plural adds an s except for one', () => {
  assert.equal(plural(0, 'badge'), '0 badges')
  assert.equal(plural(1, 'badge'), '1 badge')
  assert.equal(plural(2, 'badge'), '2 badges')
})

test('relativeTime rounds down to minutes, hours or days', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z')
  const ago = (ms) => new Date(now - ms).toISOString()
  assert.equal(relativeTime(null, now), null)
  assert.equal(relativeTime('not a date', now), null)
  assert.equal(relativeTime(ago(30 * 1000), now), 'just now')
  assert.equal(relativeTime(ago(-5 * 1000), now), 'just now')
  assert.equal(relativeTime(ago(60 * 1000), now), '1 minute ago')
  assert.equal(relativeTime(ago(59 * 60 * 1000), now), '59 minutes ago')
  assert.equal(relativeTime(ago(2 * 3600 * 1000 + 59 * 60 * 1000), now), '2 hours ago')
  assert.equal(relativeTime(ago(24 * 3600 * 1000), now), '1 day ago')
  assert.equal(relativeTime(ago(3 * 24 * 3600 * 1000), now), '3 days ago')
})

test('trackFill clamps to 0-10', () => {
  assert.equal(trackFill(-1), 0)
  assert.equal(trackFill(0), 0)
  assert.equal(trackFill(7), 7)
  assert.equal(trackFill(10), 10)
  assert.equal(trackFill(14), 10)
  assert.equal(trackFill(null), 0)
  assert.equal(trackFill(undefined), 0)
})

test('badgeSummary leaves out unknown credits', () => {
  assert.equal(badgeSummary({ validBadgeCount: 7, validCredits: 41 }), '7 badges · 41 credits')
  assert.equal(badgeSummary({ validBadgeCount: 1, validCredits: 0 }), '1 badge · 0 credits')
  assert.equal(badgeSummary({ validBadgeCount: 3, validCredits: null }), '3 badges')
})

test('badgeButtonLabel describes the badge count without credits', () => {
  assert.equal(badgeButtonLabel({ validBadgeCount: 7, validCredits: 41, username: 'Asha Raman' }), '7 badges, view badges for Asha Raman')
  assert.equal(badgeButtonLabel({ validBadgeCount: 1, validCredits: 0, username: 'A' }), '1 badge, view badges for A')
  assert.equal(badgeButtonLabel({ validBadgeCount: 3, validCredits: null, username: 'B' }), '3 badges, view badges for B')
  assert.equal(badgeButtonLabel({ username: 'C' }), '0 badges, view badges for C')
})

test('formatCredits shows unknown credits as a dash', () => {
  assert.equal(formatCredits(41), 41)
  assert.equal(formatCredits(0), 0)
  assert.equal(formatCredits(null), '—')
  assert.equal(formatCredits(undefined), '—')
})

test('formatTimeIST shows a 24-hour IST time', () => {
  assert.equal(formatTimeIST('2026-10-30T12:00:00.000Z'), '17:30')
  assert.equal(formatTimeIST(null), null)
  assert.equal(formatTimeIST('nope'), null)
})

test('nextUpdateEstimate is one interval after the last update, or null once overdue', () => {
  const now = Date.parse('2026-10-30T12:00:00.000Z')
  assert.equal(nextUpdateEstimate('2026-10-30T10:00:00.000Z', now), '2026-10-30T16:00:00.000Z')
  assert.equal(nextUpdateEstimate('2026-10-30T06:00:00.000Z', now), null)
  assert.equal(nextUpdateEstimate('2026-10-30T05:00:00.000Z', now), null)
  assert.equal(nextUpdateEstimate(null, now), null)
  assert.equal(nextUpdateEstimate(undefined, now), null)
  assert.equal(nextUpdateEstimate('nope', now), null)
})

test('rankChange reports new, up, down or same', () => {
  assert.equal(rankChange({ rank: 3 }), null)
  assert.equal(rankChange(null), null)
  assert.deepEqual(rankChange({ rank: 3, previousRank: null }), { direction: 'new', by: 0 })
  assert.deepEqual(rankChange({ rank: 3, previousRank: 6 }), { direction: 'up', by: 3 })
  assert.deepEqual(rankChange({ rank: 4, previousRank: 3 }), { direction: 'down', by: 1 })
  assert.deepEqual(rankChange({ rank: 4, previousRank: 4 }), { direction: 'same', by: 0 })
})

test('nextGoals names the next swag tier and the gap to the participant ahead', () => {
  const me = (validBadgeCount, validCredits = 0) => ({ validBadgeCount, validCredits })
  assert.deepEqual(nextGoals(null, null), [])
  assert.deepEqual(nextGoals(me(3), null), ['2 badges to Silver'])
  assert.deepEqual(nextGoals(me(4), null), ['1 badge to Silver'])
  assert.deepEqual(nextGoals(me(7), null), ['3 badges to Gold'])
  assert.deepEqual(nextGoals(me(10), null), [])
  assert.deepEqual(nextGoals(me(undefined), null), ['5 badges to Silver'])
  assert.deepEqual(nextGoals(me(6, 20), { rank: 11, validBadgeCount: 7, validCredits: 30 }), ['4 badges to Gold', '1 badge to reach #11'])
  assert.deepEqual(nextGoals(me(6, 20), { rank: 11, validBadgeCount: 6, validCredits: 30 }), ['4 badges to Gold', 'Tied on badges with #11; credits decide'])
  assert.deepEqual(nextGoals(me(6, 30), { rank: 11, validBadgeCount: 6, validCredits: 30 }), ['4 badges to Gold', 'Tied on badges and credits with #11; the earlier finish decides'])
  assert.deepEqual(nextGoals(me(10, 50), { rank: 1, validBadgeCount: 10, validCredits: 60 }), ['Tied on badges with #1; credits decide'])
  assert.deepEqual(nextGoals({ validBadgeCount: 6, validCredits: null }, { rank: 4, validBadgeCount: 6, validCredits: null }), ['4 badges to Gold', 'Tied on badges and credits with #4; the earlier finish decides'])
  assert.deepEqual(nextGoals(me(2), { rank: 3, validBadgeCount: undefined }), ['3 badges to Silver', 'Tied on badges with #3; credits decide'])
})

test('missingBadges matches by normalized title', () => {
  const accepted = [{ title: 'Build a Website on Google Cloud' }, { title: 'Using the Google Cloud Speech API' }]
  assert.deepEqual(missingBadges([{ name: '  build a  website on Google Cloud ' }], accepted), [accepted[1]])
  assert.deepEqual(missingBadges([], accepted), accepted)
  assert.deepEqual(missingBadges(null, accepted), accepted)
  assert.deepEqual(missingBadges([{ name: null }], accepted), accepted)
  assert.deepEqual(missingBadges([{ name: 'x' }], null), [])
  assert.equal(normalizeTitle('  A   b '), 'a b')
})

test('peakDay picks the first day with the most badges', () => {
  assert.equal(peakDay(null), null)
  assert.equal(peakDay([{ date: '2026-10-26', count: 0 }]), null)
  assert.deepEqual(peakDay([{ date: '2026-10-26', count: 3 }, { date: '2026-10-27', count: 9 }, { date: '2026-10-28', count: 9 }]), { date: '2026-10-27', count: 9 })
})

test('formatDayMonth shows day and short month', () => {
  assert.equal(formatDayMonth('2026-10-28'), '28 Oct')
  assert.equal(formatDayMonth(null), null)
  assert.equal(formatDayMonth('nope'), null)
})
