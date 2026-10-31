export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function isCoarsePointer() {
  return window.matchMedia('(pointer: coarse)').matches
}

export function scrollBehavior() {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
