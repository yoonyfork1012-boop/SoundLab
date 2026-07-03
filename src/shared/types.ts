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
}

export interface Library {
  id: number
  rootPath: string
  name: string
  createdAt: number
}

export interface ScanProgress {
  scanned: number
  total: number
  currentFile: string
}
