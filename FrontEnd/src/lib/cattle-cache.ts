import { API_BASE_URL } from './api'
import type { Cattle } from '../types/cattle'

// A versioned, API-specific snapshot. This is a reading cache, never a write queue.
const CACHE_KEY = `farmbovi:cattle:v1:${API_BASE_URL}`

export interface CattleSnapshot {
  cattle: Cattle[]
  savedAt: string
}

export function readSnapshot(): CattleSnapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as CattleSnapshot
    if (!Array.isArray(value.cattle) || !Number.isFinite(Date.parse(value.savedAt))) return null
    if (!value.cattle.every((animal) =>
      typeof animal.id === 'number' && typeof animal.earTag === 'string' &&
      typeof animal.name === 'string' && typeof animal.breed === 'string' &&
      (animal.sex === 'Hembra' || animal.sex === 'Macho') &&
      (animal.birthDate === null || typeof animal.birthDate === 'string'),
    )) return null
    return value
  } catch {
    return null
  }
}

export function saveSnapshot(snapshot: CattleSnapshot): boolean {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    // Storage may be full or disabled. Live data must remain usable.
    return false
  }
}

export function clearSnapshot(): void {
  try { localStorage.removeItem(CACHE_KEY) } catch { /* Storage can be disabled. */ }
}
