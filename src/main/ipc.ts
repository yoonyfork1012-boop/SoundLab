import { ipcMain, dialog, BrowserWindow, nativeImage } from 'electron'
import { readFile } from 'fs/promises'
import { scanLibrary } from './scanner'
import { getTracksByLibrary, toggleStarred, updateLastPlayed } from './db/queries'
import type { ScanProgress } from '../shared/types'

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('dialog:selectFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('library:scan', async (_event, rootPath: string) => {
    const library = await scanLibrary(rootPath, (progress: ScanProgress) => {
      mainWindow.webContents.send('library:scanProgress', progress)
    })
    const tracks = getTracksByLibrary(library.id)
    return { library, tracks }
  })

  ipcMain.handle('tracks:getByLibrary', (_event, libraryId: number) => {
    return getTracksByLibrary(libraryId)
  })

  ipcMain.handle('track:toggleStar', (_event, trackId: number) => {
    return toggleStarred(trackId)
  })

  ipcMain.handle('track:updateLastPlayed', (_event, trackId: number) => {
    updateLastPlayed(trackId)
  })

  ipcMain.handle('file:readAudio', async (_event, filePath: string) => {
    const buffer = await readFile(filePath)
    return new Uint8Array(buffer)
  })

  // 리스트에서 바로 끌어다 DAW/탐색기로 놓는 네이티브 드래그아웃 (Soundly 방식)
  // 16x16 반투명 사각형 PNG (Windows는 드래그 아이콘이 필수)
  const dragIcon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOElEQVR4nGNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMAgAWWAABlXHW4QAAAABJRU5ErkJggg=='
  )
  ipcMain.on('drag:start', (event, filePath: string) => {
    event.sender.startDrag({ file: filePath, icon: dragIcon })
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
