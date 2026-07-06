import { ipcMain, dialog, shell, clipboard, app, BrowserWindow, nativeImage } from 'electron'
import { readFile } from 'fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { scanLibrary, scanNewFilesOnly } from './scanner'
import { startWatching, stopWatching } from './watcher'
import {
  getAllLibraries,
  getAllTracks,
  deleteLibrary,
  toggleStarred,
  updateLastPlayed,
  getCollections,
  createCollection,
  deleteCollection,
  renameCollection,
  setCollectionColor,
  addTrackToCollection,
  addTracksToCollection,
  removeTrackFromCollection,
  hasTrackFilePath,
  renameLibrary,
  setLibraryMonitor,
  markLibraryAnalyzed,
  computeSimilarityKeys
} from './db/queries'
import type { ScanProgress } from '../shared/types'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // 폴더 추가 = 라이브러리 누적. 스캔 후 전체(모든 라이브러리/트랙)를 반환.
  ipcMain.handle('library:scan', async (_event, rootPath: string) => {
    await scanLibrary(rootPath, (progress: ScanProgress) => {
      mainWindow.webContents.send('library:scanProgress', progress)
    })
    return { libraries: getAllLibraries(), tracks: getAllTracks() }
  })

  // 앱 시작 시 저장돼 있던 전체 라이브러리/트랙 로드
  ipcMain.handle('app:loadAll', () => {
    return { libraries: getAllLibraries(), tracks: getAllTracks() }
  })

  ipcMain.handle('library:remove', (_event, libraryId: number) => {
    stopWatching(libraryId)
    deleteLibrary(libraryId)
    return { libraries: getAllLibraries(), tracks: getAllTracks() }
  })

  ipcMain.handle('library:rename', (_event, libraryId: number, name: string) => {
    renameLibrary(libraryId, name)
    return getAllLibraries()
  })

  // "Scan for new files" — DB에 없는 새 파일만 추가 (기존 파일/삭제 정리는 건드리지 않음)
  ipcMain.handle('library:scanNew', async (_event, libraryId: number, rootPath: string) => {
    const addedCount = await scanNewFilesOnly(rootPath, libraryId, (progress: ScanProgress) => {
      mainWindow.webContents.send('library:scanProgress', progress)
    })
    return { libraries: getAllLibraries(), tracks: getAllTracks(), addedCount }
  })

  ipcMain.handle('library:showInExplorer', async (_event, rootPath: string) => {
    const err = await shell.openPath(rootPath)
    if (err) console.error('openPath failed:', err)
  })

  // "Monitor for changes" On/Off — 켜면 폴더 변경 감시 시작, 끄면 감시 중단
  ipcMain.handle('library:setMonitor', (_event, libraryId: number, rootPath: string, on: boolean) => {
    setLibraryMonitor(libraryId, on)
    if (on) startWatching(libraryId, rootPath, mainWindow)
    else stopWatching(libraryId)
    return getAllLibraries()
  })

  // "Analyze for Find Similar" — 메타데이터(길이/채널/샘플레이트/비트뎁스) 기반 근사 유사도 키 생성
  ipcMain.handle('library:analyze', (_event, libraryId: number) => {
    const analyzedCount = computeSimilarityKeys(libraryId)
    markLibraryAnalyzed(libraryId, Date.now())
    return { libraries: getAllLibraries(), analyzedCount }
  })

  ipcMain.handle('track:toggleStar', (_event, trackId: number) => {
    return toggleStarred(trackId)
  })

  ipcMain.handle('track:updateLastPlayed', (_event, trackId: number) => {
    updateLastPlayed(trackId)
  })

  // Collections
  ipcMain.handle('collections:getAll', () => getCollections())
  ipcMain.handle('collections:create', (_event, name: string) => {
    createCollection(name)
    return getCollections()
  })
  ipcMain.handle('collections:delete', (_event, id: number) => {
    deleteCollection(id)
    return getCollections()
  })
  ipcMain.handle('collections:rename', (_event, id: number, name: string) => {
    renameCollection(id, name)
    return getCollections()
  })
  ipcMain.handle('collections:setColor', (_event, id: number, color: string | null) => {
    setCollectionColor(id, color)
    return getCollections()
  })
  ipcMain.handle('collections:addTrack', (_event, collectionId: number, trackId: number) => {
    addTrackToCollection(collectionId, trackId)
    return getCollections()
  })
  ipcMain.handle('collections:addTracks', (_event, collectionId: number, trackIds: number[]) => {
    addTracksToCollection(collectionId, trackIds)
    return getCollections()
  })
  ipcMain.handle('collections:removeTrack', (_event, collectionId: number, trackId: number) => {
    removeTrackFromCollection(collectionId, trackId)
    return getCollections()
  })

  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('file:readAudio', async (_event, filePath: string) => {
    if (!hasTrackFilePath(filePath)) {
      throw new Error('Audio file is not registered in the library')
    }
    const buffer = await readFile(filePath)
    return new Uint8Array(buffer)
  })

  // 리스트에서 바로 끌어다 DAW/탐색기로 놓는 네이티브 드래그아웃 (Soundly 방식)
  // Windows는 비어있지 않은 드래그 아이콘이 필수 (24x24 RGBA PNG)
  const dragIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJUlEQVR4nGOIWtV0gpaYYdSCUQtGLRi1YNSCUQtGLRi1YGhYAAAehC/M66tF4QAAAABJRU5ErkJggg=='
  )
  ipcMain.on('drag:start', (event, filePaths: string | string[]) => {
    const files = Array.isArray(filePaths) ? filePaths : [filePaths]
    if (files.length === 0) return
    try {
      event.sender.startDrag({
        file: files[0],
        files: files.length > 1 ? files : undefined,
        icon: dragIcon
      })
    } catch (err) {
      console.error('startDrag failed:', (err as Error)?.message)
    }
  })

  // Waveform에서 선택한 구간만 잘라 만든 임시 오디오를 DAW로 드래그 아웃.
  // 드래그 제스처가 끊기지 않도록 파일 쓰기부터 startDrag까지 전부 동기로 처리.
  const dragExportDir = join(app.getPath('temp'), 'soundlib-dragexports')
  ipcMain.on('drag:startFromBuffer', (event, bytes: Uint8Array, filename: string) => {
    try {
      if (!existsSync(dragExportDir)) mkdirSync(dragExportDir, { recursive: true })
      const filePath = join(dragExportDir, filename)
      writeFileSync(filePath, Buffer.from(bytes))
      event.sender.startDrag({ file: filePath, icon: dragIcon })
    } catch (err) {
      console.error('drag:startFromBuffer failed:', (err as Error)?.message)
    }
  })

  // 커스텀 타이틀바 창 제어
  ipcMain.on('window:minimize', () => mainWindow.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow.close())
  ipcMain.handle('window:isMaximized', () => mainWindow.isMaximized())
}
