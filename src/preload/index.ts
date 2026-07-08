import { contextBridge, ipcRenderer } from 'electron'
import type { Collection, Library, ScanProgress, Track } from '../shared/types'

const api = {
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectFolder'),

  scanLibrary: (rootPath: string): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('library:scan', rootPath),

  loadAll: (): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('app:loadAll'),

  // 초기 데이터 로드가 끝났음을 메인 프로세스에 알려 스플래시 창을 닫고 메인 창을 보여주게 함
  notifyReady: (): void => ipcRenderer.send('app:renderer-ready'),

  removeLibrary: (libraryId: number): Promise<{ libraries: Library[]; tracks: Track[] }> =>
    ipcRenderer.invoke('library:remove', libraryId),

  renameLibrary: (libraryId: number, name: string): Promise<Library[]> =>
    ipcRenderer.invoke('library:rename', libraryId, name),

  scanNewFiles: (
    libraryId: number,
    rootPath: string
  ): Promise<{ libraries: Library[]; tracks: Track[]; addedCount: number }> =>
    ipcRenderer.invoke('library:scanNew', libraryId, rootPath),

  showInExplorer: (rootPath: string): Promise<void> => ipcRenderer.invoke('library:showInExplorer', rootPath),

  setLibraryMonitor: (libraryId: number, rootPath: string, on: boolean): Promise<Library[]> =>
    ipcRenderer.invoke('library:setMonitor', libraryId, rootPath, on),

  analyzeLibrary: (libraryId: number): Promise<{ libraries: Library[]; analyzedCount: number }> =>
    ipcRenderer.invoke('library:analyze', libraryId),

  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void =>
      callback(progress)
    ipcRenderer.on('library:scanProgress', listener)
    return () => ipcRenderer.removeListener('library:scanProgress', listener)
  },

  onLibraryUpdated: (
    callback: (data: { libraries: Library[]; tracks: Track[] }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { libraries: Library[]; tracks: Track[] }
    ): void => callback(data)
    ipcRenderer.on('library:updated', listener)
    return () => ipcRenderer.removeListener('library:updated', listener)
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
  renameCollection: (id: number, name: string): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:rename', id, name),
  setCollectionColor: (id: number, color: string | null): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:setColor', id, color),
  addTrackToCollection: (collectionId: number, trackId: number): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:addTrack', collectionId, trackId),
  addTracksToCollection: (collectionId: number, trackIds: number[]): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:addTracks', collectionId, trackIds),
  removeTrackFromCollection: (collectionId: number, trackId: number): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:removeTrack', collectionId, trackId),
  reorderCollectionTracks: (collectionId: number, orderedTrackIds: number[]): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:reorder', collectionId, orderedTrackIds),

  readAudioFile: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke('file:readAudio', filePath),

  getAudioAccess: (filePath: string): Promise<{ url: string; size: number; mtimeMs: number }> =>
    ipcRenderer.invoke('file:getAudioAccess', filePath),

  writeClipboardText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:writeText', text),

  // 리스트 우클릭 메뉴: 파일 시스템 액션
  removeTrack: (trackId: number): Promise<void> => ipcRenderer.invoke('track:remove', trackId),
  renameTrackFile: (
    trackId: number,
    filePath: string,
    newName: string
  ): Promise<{ filePath: string; filename: string }> =>
    ipcRenderer.invoke('track:rename', trackId, filePath, newName),
  openExternal: (filePath: string): Promise<void> => ipcRenderer.invoke('file:openExternal', filePath),
  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('file:showItemInFolder', filePath),
  copyToFolder: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('file:copyToFolder', filePath),

  // 커버 아트워크 (임베디드 우선 → 폴더 커버 → null)
  getTrackArtwork: (
    filePath: string,
    folderCoverPath: string | null
  ): Promise<{ url: string; source: 'embedded' | 'folder' } | null> =>
    ipcRenderer.invoke('artwork:getForTrack', filePath, folderCoverPath),
  getFolderCover: (
    folderPath: string
  ): Promise<{ url: string; source: 'folder' } | null> =>
    ipcRenderer.invoke('artwork:getFolderCover', folderPath),

  // 리스트 행을 OS 네이티브 드래그로 내보내기 (DAW/탐색기로 드롭)
  startDrag: (filePath: string): void => ipcRenderer.send('drag:start', filePath),

  // Waveform에서 선택한 구간만 잘라 임시 오디오로 만든 뒤 그 파일을 네이티브 드래그로 내보내기
  startDragFromBuffer: (bytes: Uint8Array, filename: string): void =>
    ipcRenderer.send('drag:startFromBuffer', bytes, filename),

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
  },

  // Dock Mode: 창을 화면 하단의 얇은 트랜스포트 바로 축소/복원
  setDockMode: (on: boolean): Promise<void> => ipcRenderer.invoke('window:setDockMode', on)
}

contextBridge.exposeInMainWorld('api', api)

export type SoundLibApi = typeof api
