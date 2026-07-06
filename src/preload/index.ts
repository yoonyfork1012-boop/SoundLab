import { contextBridge, ipcRenderer } from 'electron'
import type { Collection, Library, ScanProgress, Track } from '../shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),

  scanLibrary: (rootPath: string): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('library:scan', rootPath),

  loadAll: (): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('app:loadAll'),

  removeLibrary: (libraryId: number): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('library:remove', libraryId),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress)
    ipcRenderer.on('library:scanProgress', listener)
    return () => ipcRenderer.removeListener('library:scanProgress', listener)
  },

  toggleStar: (trackId: number): Promise<boolean> =>
    ipcRenderer.invoke('track:toggleStar', trackId),

  updateLastPlayed: (trackId: number): Promise<void> =>
    ipcRenderer.invoke('track:updateLastPlayed', trackId),

  // Collections
  getCollections: (): Promise<Collection[]> => ipcRenderer.invoke('collections:getAll'),
  createCollection: (name: string): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:create', name),
  deleteCollection: (id: number): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:delete', id),
  addTrackToCollection: (collectionId: number, trackId: number): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:addTrack', collectionId, trackId),
  removeTrackFromCollection: (collectionId: number, trackId: number): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:removeTrack', collectionId, trackId),

  readAudioFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('file:readAudio', filePath),

  // 리스트 행을 OS 네이티브 드래그로 내보내기 (DAW/탐색기로 드롭)
  startDrag: (filePath: string): void => ipcRenderer.send('drag:start', filePath),

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
