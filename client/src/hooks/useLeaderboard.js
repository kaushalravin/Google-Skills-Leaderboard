import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchLeaderboard } from '../api.js'

const STALE_MS = 5 * 60 * 1000

export function useLeaderboard({ page, limit, search }) {
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshCount, setRefreshCount] = useState(0)
  const [result, setResult] = useState({ key: null, data: null, error: null })
  const loadedAtRef = useRef(0)

  const key = JSON.stringify([page, limit, search, reloadKey])

  // refreshCount re-fetches the same key in the background: the old rows stay visible until new ones arrive.
  useEffect(() => {
    let cancelled = false
    fetchLeaderboard({ page, limit, search })
      .then((data) => {
        if (cancelled) return
        loadedAtRef.current = Date.now()
        setResult({ key, data, error: null })
      })
      .catch(() => {
        if (cancelled) return
        setResult((prev) => (prev.key === key && prev.data && !prev.error
          ? prev
          : { key, data: prev.data, error: 'Request failed' }))
      })
    return () => { cancelled = true }
  }, [key, page, limit, search, refreshCount])

  const loading = result.key !== key
  const loadingRef = useRef(loading)
  useEffect(() => {
    loadingRef.current = loading
  })

  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible' || loadingRef.current) return
      if (Date.now() - loadedAtRef.current < STALE_MS) return
      setRefreshCount((n) => n + 1)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  const retry = useCallback(() => setReloadKey((k) => k + 1), [])

  // data is kept from the previous request while loading, so the page meta doesn't flicker.
  return {
    data: result.data,
    dataKey: result.key,
    loading,
    error: loading ? null : result.error,
    retry,
    refreshCount,
  }
}
