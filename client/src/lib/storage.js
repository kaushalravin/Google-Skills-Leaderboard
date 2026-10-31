export const STORAGE_KEYS = {
  pinned: 'gdg-lb-pinned',
}

// Private browsing and blocked storage throw on access; the site must keep working without it.
export function getItem(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setItem(key, value) {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key) {
  try {
    window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}
