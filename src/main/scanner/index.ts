import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { beginScanBatch, endScanBatch, upsertLibrary, upsertTrack } from '../db/queries'
import type { Library, ScanProgress } from '../../shared/types'

// music-metadata v10은 ESM 전용. 패키징된 CJS 빌드에서 static import은 parseFile이
// undefined가 되어 매 파일 실패 → 동적 import로 로드해야 함.
let mmPromise: Promise<typeof import('music-metadata')> | null = null
function getMusicMetadata(): Promise<typeof import('music-metadata')> {
  if (!mmPromise) mmPromise = import('music-metadata')
  return mmPromise
}

const SUPPORTED_EXTENSIONS = new Set([
  '.wav',
  '.aiff',
  '.aif',
  '.mp3',
  '.m4a',
  '.ogg',
  '.flac'
])

async function collectAudioFiles(rootPath: string): Promise<string[]> {
  const results: string[] = []

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (SUPPORTED_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath)
      }
    }
  }

  await walk(rootPath)
  return results
}

export async function scanLibrary(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<Library> {
  const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath
  const library = upsertLibrary(rootPath, name)

  const files = await collectAudioFiles(rootPath)
  const { parseFile } = await getMusicMetadata()
  let loggedError = false

  beginScanBatch()
  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]
    const filename = filePath.split(/[\\/]/).pop() ?? filePath

    try {
      const meta = await parseFile(filePath, { skipCovers: true, duration: true })
      upsertTrack({
        libraryId: library.id,
        filePath,
        filename,
        durationMs: meta.format.duration ? Math.round(meta.format.duration * 1000) : null,
        sampleRate: meta.format.sampleRate ?? null,
        bitDepth: meta.format.bitsPerSample ?? null,
        channels: meta.format.numberOfChannels ?? null
      })
    } catch (err) {
      // 개별 파일 파싱 실패는 무시하되, 첫 오류는 진단용으로 남김
      if (!loggedError) {
        loggedError = true
        console.error('metadata parse failed:', filename, (err as Error)?.message)
      }
      upsertTrack({
        libraryId: library.id,
        filePath,
        filename,
        durationMs: null,
        sampleRate: null,
        bitDepth: null,
        channels: null
      })
    }

    onProgress?.({ scanned: i + 1, total: files.length, currentFile: filename })
  }
  endScanBatch()

  return library
}
