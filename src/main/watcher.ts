import { watch, FSWatcher } from 'fs'
import type { BrowserWindow } from 'electron'
import { scanLibrary } from './scanner'
import { getAllLibraries, getAllTracks } from './db/queries'
import type { ScanProgress } from '../shared/types'

// "Monitor for changes" — 라이브러리 루트를 감시하다 변경이 생기면(디바운스 후)
// 전체 재스캔해서 렌더러에 최신 라이브러리/트랙을 push
const watchers = new Map<number, FSWatcher>()
const debounceTimers = new Map<number, NodeJS.Timeout>()

export function startWatching(libraryId: number, rootPath: string, mainWindow: BrowserWindow): void {
  if (watchers.has(libraryId)) return
  try {
    const watcher = watch(rootPath, { recursive: true }, () => {
      const existing = debounceTimers.get(libraryId)
      if (existing) clearTimeout(existing)
      const timer = setTimeout(() => {
        debounceTimers.delete(libraryId)
        void scanLibrary(rootPath, (p: ScanProgress) => mainWindow.webContents.send('library:scanProgress', p))
          .then(() => {
            mainWindow.webContents.send('library:updated', {
              libraries: getAllLibraries(),
              tracks: getAllTracks()
            })
          })
          .catch((err) => console.error('monitor rescan failed:', (err as Error)?.message))
      }, 2500)
      debounceTimers.set(libraryId, timer)
    })
    watchers.set(libraryId, watcher)
  } catch (err) {
    console.error('watch failed for', rootPath, (err as Error)?.message)
  }
}

export function stopWatching(libraryId: number): void {
  watchers.get(libraryId)?.close()
  watchers.delete(libraryId)
  const timer = debounceTimers.get(libraryId)
  if (timer) clearTimeout(timer)
  debounceTimers.delete(libraryId)
}

export function stopAllWatching(): void {
  for (const id of [...watchers.keys()]) stopWatching(id)
}
