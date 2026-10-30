import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getItem, setItem, removeItem, STORAGE_KEYS } from './storage.js'

function memoryStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

const throwing = {
  getItem() { throw new Error('SecurityError') },
  setItem() { throw new Error('QuotaExceededError') },
  removeItem() { throw new Error('SecurityError') },
}

beforeEach(() => {
  globalThis.window = { localStorage: memoryStorage() }
})

test('reads back what it stores', () => {
  assert.equal(setItem(STORAGE_KEYS.theme, 'dark'), true)
  assert.equal(getItem(STORAGE_KEYS.theme), 'dark')
  assert.equal(removeItem(STORAGE_KEYS.theme), true)
  assert.equal(getItem(STORAGE_KEYS.theme), null)
})

test('never throws when storage is blocked', () => {
  globalThis.window = { localStorage: throwing }
  assert.equal(getItem(STORAGE_KEYS.pinned), null)
  assert.equal(setItem(STORAGE_KEYS.pinned, 'x'), false)
  assert.equal(removeItem(STORAGE_KEYS.pinned), false)
})

test('never throws when there is no storage at all', () => {
  globalThis.window = {}
  assert.equal(getItem(STORAGE_KEYS.pinned), null)
  assert.equal(setItem(STORAGE_KEYS.pinned, 'x'), false)
})
