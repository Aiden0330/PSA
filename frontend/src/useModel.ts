import { useReducer, useCallback } from 'react'
import type { ModelJson } from './model'

interface Hist<T> { past: T[]; present: T | null; future: T[] }
type Updater<T> = T | ((prev: T | null) => T | null)
type Action<T> =
  | { type: 'set'; m: Updater<T> }
  | { type: 'reset'; m: T | null }
  | { type: 'undo' }
  | { type: 'redo' }

function reducer<T>(s: Hist<T>, a: Action<T>): Hist<T> {
  switch (a.type) {
    case 'set': {
      const next = typeof a.m === 'function' ? (a.m as (p: T | null) => T | null)(s.present) : a.m
      return { past: s.present ? [...s.past, s.present] : s.past, present: next, future: [] }
    }
    case 'reset':
      return { past: [], present: a.m, future: [] }
    case 'undo': {
      if (!s.past.length) return s
      const prev = s.past[s.past.length - 1]
      return { past: s.past.slice(0, -1), present: prev, future: s.present ? [s.present, ...s.future] : s.future }
    }
    case 'redo': {
      if (!s.future.length) return s
      const next = s.future[0]
      return { past: s.present ? [...s.past, s.present] : s.past, present: next, future: s.future.slice(1) }
    }
  }
}

/** 通用 undo/redo 历史 hook(past/present/future)。set 支持值或更新函数。 */
export function useHistory<T>(initial: T | null) {
  const [s, dispatch] = useReducer(reducer<T>, { past: [], present: initial, future: [] })
  return {
    model: s.present,
    set: useCallback((m: Updater<T>) => dispatch({ type: 'set', m }), []),
    reset: useCallback((m: T | null) => dispatch({ type: 'reset', m }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
  }
}

export function useModel(initial: ModelJson | null) {
  return useHistory<ModelJson>(initial)
}
