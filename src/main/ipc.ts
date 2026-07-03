import { ipcMain, dialog, BrowserWindow } from 'electron'
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
}
