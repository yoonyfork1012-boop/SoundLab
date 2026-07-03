import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import { parseFile } from 'music-metadata'
import { beginScanBatch, endScanBatch, upsertLibrary, upsertTrack } from '../db/queries'
import type { Library, ScanProgress } from '../../shared/types'

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
    } catch {
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
