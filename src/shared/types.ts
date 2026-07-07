export interface Track {
  id: number
  libraryId: number
  filePath: string
  filename: string
  durationMs: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  category: string | null
  subcategory: string | null
  description: string | null
  tags: string[]
  starred: boolean
  artworkPath: string | null
  artworkSource: 'embedded' | 'manual' | 'generated' | null
  addedAt: number
  lastPlayedAt: number | null
  fileSize: number | null
  publisher: string | null
  isFloat: boolean
}

export type PublisherMode = 'library-root-child' | 'file-parent-1' | 'file-parent-2' | 'file-parent-3' | 'custom'

export interface PublisherRule {
  mode: PublisherMode
  customPath: string | null
}

export interface Library {
  id: number
  rootPath: string
  name: string
  createdAt: number
  monitor: boolean
  analyzedAt: number | null
}

export interface ScanProgress {
  phase: 'discovering' | 'parsing'
  scanned: number
  total: number
  currentFile: string
}

export interface Collection {
  id: number
  name: string
  trackIds: number[]
  createdAt: number
  color: string | null
}
