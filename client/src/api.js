const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

// Set by public/sw.js only when it answers from its cache because the network failed.
const CACHED_AT_HEADER = 'X-SW-Cached-At'

// The response body is never surfaced: the UI shows a generic message and details go to the console.
async function request(path) {
  try {
    return await fetch(`${BASE_URL}${path}`)
  } catch (err) {
    console.error('API request failed', { path, error: err })
    throw new Error('Request failed')
  }
}

// okStatuses: non-2xx answers that still carry a JSON body the caller wants
async function getJson(path, { okStatuses = [] } = {}) {
  const res = await request(path)
  if (!res.ok && !okStatuses.includes(res.status)) {
    console.error('API request failed', { path, status: res.status })
    const error = new Error('Request failed')
    error.status = res.status
    throw error
  }
  const data = await res.json()
  const cachedAt = res.headers.get(CACHED_AT_HEADER)
  if (cachedAt) data.servedFromCacheAt = cachedAt
  return data
}

export function fetchLeaderboard({ page = 1, limit = 50, search = '' } = {}) {
  const params = new URLSearchParams({ page, limit })
  if (search) params.set('search', search)
  return getJson(`/api/leaderboard?${params}`)
}

export function fetchParticipant(userId) {
  return getJson(`/api/leaderboard/${encodeURIComponent(userId)}`)
}

// The health endpoint answers 503 with a JSON body when the database is down; that is a status, not an error.
export function fetchHealth() {
  return getJson('/api/health', { okStatuses: [503] })
}
