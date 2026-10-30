import { useSyncExternalStore } from 'react'
import { STORAGE_KEYS, getItem, setItem, removeItem } from '../lib/storage.js'

const CHANGE_EVENT = 'gdg-lb-pinned-change'

// The popup and the MeBar both read the pin; the event keeps them in sync, and 'storage' syncs other tabs.
function subscribe(callback) {
  window.addEventListener(CHANGE_EVENT, callback)
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

function getPinnedId() {
  return getItem(STORAGE_KEYS.pinned)
}

export function pin(userId) {
  setItem(STORAGE_KEYS.pinned, String(userId))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function unpin() {
  removeItem(STORAGE_KEYS.pinned)
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

export function usePinned() {
  return useSyncExternalStore(subscribe, getPinnedId, () => null)
}
