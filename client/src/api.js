/**
 * api.js — Leaderboard API service layer.
 *
 * All fetch calls live here, isolated from presentational components.
 * The base URL is read from VITE_API_BASE_URL (public, no secrets).
 * Admin endpoints are intentionally not called from this public client.
 *
 * API contract (GET /api/leaderboard):
 *   {
 *     lastSuccessfulUpdate: string|null,
 *     competitionStartDate: string|null,
 *     pagination: { page, limit, total, totalPages },
 *     rows: [{
 *       rank, userId, username, skillsUrl,
 *       validBadgeCount, validCredits,
 *       latestValidBadgeAt,
 *       badges: [{ name, imageUrl, earnedAt }]
 *     }]
 *   }
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

/**
 * Fetch a page of leaderboard entries.
 * @param {{ page?: number, limit?: number, search?: string }} opts
 */
export async function fetchLeaderboard({ page = 1, limit = 50, search = '' } = {}) {
  const params = new URLSearchParams({ page, limit });
  if (search) params.set('search', search);

  const res = await fetch(`${BASE_URL}/api/leaderboard?${params.toString()}`);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Leaderboard request failed: ${res.status}${text ? ' — ' + text : ''}`);
  }

  return res.json();
}
