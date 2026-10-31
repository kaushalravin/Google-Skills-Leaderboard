import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchLeaderboard } from '../api.js'

const STALE_MS = 5 * 60 * 1000
const DEFAULT_BATCH_SIZE = 25

export function useLeaderboard({ limit = DEFAULT_BATCH_SIZE, search = '' } = {}) {
  const [currentPage, setCurrentPage] = useState(1)
  const [reloadKey, setReloadKey] = useState(0)
  const [refreshCount, setRefreshCount] = useState(0)

  const [accumulatedRows, setAccumulatedRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [loadMoreError, setLoadMoreError] = useState(false)

  const loadedAtRef = useRef(0)
  const activeSearchRef = useRef(search)

  // When search query or reloadKey changes, reset to page 1
  useEffect(() => {
    activeSearchRef.current = search
    setCurrentPage(1)
    setAccumulatedRows([])
    setLoading(true)
    setError(null)
    setLoadMoreError(false)
  }, [search, reloadKey])

  // Fetch entries whenever page, search, reloadKey, or refreshCount changes
  useEffect(() => {
    let cancelled = false
    const isFirstPage = currentPage === 1

    if (isFirstPage) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
      setLoadMoreError(false)
    }

    fetchLeaderboard({ page: currentPage, limit, search })
      .then((data) => {
        if (cancelled) return
        loadedAtRef.current = Date.now()
        setMeta(data)
        setError(null)
        setLoadMoreError(false)

        setAccumulatedRows((prev) => {
          if (isFirstPage) {
            return data.rows ?? []
          }
          // Append new rows, avoiding duplicate user IDs if data shifted during crawl
          const existingIds = new Set(prev.map((r) => String(r.userId)))
          const newRows = (data.rows ?? []).filter((r) => !existingIds.has(String(r.userId)))
          return [...prev, ...newRows]
        })
      })
      .catch((err) => {
        if (cancelled) return
        if (isFirstPage) {
          setError('Request failed')
        } else {
          setLoadMoreError(true)
        }
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setLoadingMore(false)
      })

    return () => {
      cancelled = true
    }
  }, [currentPage, limit, search, reloadKey, refreshCount])

  // Periodic visibility refresh
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible' || loading || loadingMore) return
      if (Date.now() - loadedAtRef.current < STALE_MS) return
      setRefreshCount((n) => n + 1)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [loading, loadingMore])

  const total = meta?.pagination?.total ?? 0
  const totalPages = meta?.pagination?.totalPages ?? 1
  const hasMore = Boolean(meta) && currentPage < totalPages && accumulatedRows.length < total

  const canCollapse = accumulatedRows.length > limit

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    if (loadMoreError) {
      // Re-trigger fetch for the current page that failed
      setRefreshCount((n) => n + 1)
    } else {
      setCurrentPage((p) => p + 1)
    }
  }, [loading, loadingMore, hasMore, loadMoreError])

  const collapse = useCallback(() => {
    setCurrentPage(1)
    setAccumulatedRows((prev) => prev.slice(0, limit))
  }, [limit])

  const retry = useCallback(() => {
    setReloadKey((k) => k + 1)
  }, [])

  const mergedData = meta
    ? {
        ...meta,
        rows: accumulatedRows,
        pagination: {
          ...meta.pagination,
          page: currentPage,
          total,
          loadedCount: accumulatedRows.length,
          hasMore,
        },
      }
    : null

  return {
    data: mergedData,
    dataKey: `${search}-${accumulatedRows.length}`,
    loading,
    loadingMore,
    loadMoreError,
    hasMore,
    canCollapse,
    loadMore,
    collapse,
    total,
    loadedCount: accumulatedRows.length,
    error,
    retry,
    refreshCount,
  }
}
