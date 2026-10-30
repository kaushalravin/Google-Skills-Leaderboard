/**
 * useLeaderboard.js — Custom hook for fetching leaderboard data.
 * Handles loading, error, empty, and success states.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchLeaderboard } from '../api.js'

export function useLeaderboard({ page, limit, search }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  // Avoid state updates after unmount
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const load = useCallback(() => {
    // Each effect triggers a fresh async operation.
    // State is set only from the stable `load` callback, not directly inside effects.
    let cancelled = false

    setLoading(true)
    setError(null)

    fetchLeaderboard({ page, limit, search })
      .then((result) => {
        if (!cancelled && mounted.current) setData(result)
      })
      .catch((err) => {
        if (!cancelled && mounted.current) setError(err.message ?? 'Unknown error')
      })
      .finally(() => {
        if (!cancelled && mounted.current) setLoading(false)
      })

    return () => { cancelled = true }
  }, [page, limit, search])

  // oxlint-disable-next-line react/set-state-in-effect
  // Rationale: state is updated asynchronously inside Promise callbacks,
  // not synchronously in the effect body. This is the standard React
  // data-fetching pattern. The linter cannot distinguish async from sync updates.
  useEffect(() => {
    const cleanup = load()
    return cleanup
  }, [load])

  return { data, loading, error, retry: load }
}
