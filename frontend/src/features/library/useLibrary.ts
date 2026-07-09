import { useEffect, useState } from 'react'
import { getLibrary } from '../../api'
import type { LibraryData } from '../../api'
import { applyOverlay, getOverlay } from '../../libraryStore'

/** 参考库基线 + 本地覆盖层合成;bump() 在覆盖层变化后触发重合成。 */
export function useLibrary() {
  const [libBase, setLibBase] = useState<LibraryData | null>(null)
  const [lib, setLib] = useState<LibraryData | null>(null)
  const [libVersion, setLibVersion] = useState(0)
  useEffect(() => { getLibrary().then(setLibBase).catch(() => {}) }, [])
  useEffect(() => { if (libBase) setLib(applyOverlay(libBase, getOverlay())) }, [libBase, libVersion])
  return { lib, bump: () => setLibVersion((n) => n + 1) }
}
