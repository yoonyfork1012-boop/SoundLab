import { contextBridge, ipcRenderer } from 'electron'
import type { Library, ScanProgress, Track } from '../shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),

  scanLibrary: (rootPath: string): Promise<{ library: Library; tracks: Track[] }> =>
    ipcRenderer.invoke('library:scan', rootPath),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress)
    ipcRenderer.on('library:scanProgress', listener)
    return () => ipcRenderer.removeListener('library:scanProgress', listener)
  },

  getTracksByLibrary: (libraryId: number): Promise<Track[]> =>
    ipcRenderer.invoke('tracks:getByLibrary', libraryId),

  toggleStar: (trackId: number): Promise<boolean> =>
    ipcRenderer.invoke('track:toggleStar', trackId),

  updateLastPlayed: (trackId: number): Promise<void> =>
    ipcRenderer.invoke('track:updateLastPlayed', trackId),

  readAudioFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('file:readAudio', filePath),

  // 창 제어 (커스텀 타이틀바)
  windowMinimize: (): void => ipcRenderer.send('window:minimize'),
  windowToggleMaximize: (): void => ipcRenderer.send('window:toggleMaximize'),
  windowClose: (): void => ipcRenderer.send('window:close'),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, maximized: boolean): void =>
      callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type SoundLibApi = typeof api
