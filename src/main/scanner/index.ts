import { readdir } from 'fs/promises'
import { join, extname } from 'path'
import {
  beginScanBatch,
  deleteMissingTracks,
  endScanBatch,
  hasTrackFilePath,
  rollbackScanBatch,
  upsertLibrary,
  upsertTrack
} from '../db/queries'
import { categoryFromFilename } from '../../shared/ucsCatId'
import { classifySound } from '../../shared/soundTaxonomy'
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

async function collectAudioFiles(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<string[]> {
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
        // 파일 검색(discovering) 단계 — 폴더 트리를 도는 동안에도 진행 상황이 보이도록
        // 25개 단위로만 알려 IPC 전송 빈도를 억제
        if (onProgress && results.length % 25 === 0) {
          onProgress({ phase: 'discovering', scanned: results.length, total: 0, currentFile: entry.name })
        }
      }
    }
  }

  await walk(rootPath)
  onProgress?.({ phase: 'discovering', scanned: results.length, total: 0, currentFile: '' })
  return results
}

// 기존 메타데이터(UCS 파일명 CatID, 오디오 태그의 genre)가 있으면 그것을 우선 사용하고,
// 없을 때만 하이브리드 분류기로 자동 분류한다.
function resolveCategory(
  filename: string,
  folderPath: string,
  genre?: string
): { category: string | null; subcategory: string | null } {
  const ucs = categoryFromFilename(filename)
  if (ucs) return { category: ucs.category, subcategory: ucs.subcategory || null }
  if (genre) return { category: genre, subcategory: null }
  const guess = classifySound({ filename, folderPath })
  return { category: guess.category, subcategory: guess.subcategory || null }
}

// 라이브러리 루트 폴더명(벤더/브랜드명인 경우가 많음, 예: "Blastwave FX", "Boom Library")은
// 분류 입력에서 제외한다 — 브랜드명이 우연히 카테고리 키워드와 겹쳐(예: "Blastwave"의
// "blast") 라이브러리 전체가 엉뚱하게 분류되는 것을 방지하기 위함. 실제 사운드 성격을
// 나타내는 하위 폴더명만 분류에 사용한다.
function relativeFolderPath(filePath: string, rootPath: string): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const dir = norm(filePath.split(/[\\/]/).slice(0, -1).join('/'))
  const root = norm(rootPath)
  return dir.startsWith(root) ? dir.slice(root.length).replace(/^\/+/, '') : dir
}

async function parseAndUpsert(
  filePath: string,
  libraryId: number,
  rootPath: string,
  loggedErrorRef: { v: boolean }
): Promise<void> {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
  const folderPath = relativeFolderPath(filePath, rootPath)
  const { parseFile } = await getMusicMetadata()
  try {
    const meta = await parseFile(filePath, { skipCovers: true, duration: true })
    const genre = meta.common?.genre?.[0]
    const { category, subcategory } = resolveCategory(filename, folderPath, genre)
    upsertTrack({
      libraryId,
      filePath,
      filename,
      durationMs: meta.format.duration ? Math.round(meta.format.duration * 1000) : null,
      sampleRate: meta.format.sampleRate ?? null,
      bitDepth: meta.format.bitsPerSample ?? null,
      channels: meta.format.numberOfChannels ?? null,
      category,
      subcategory
    })
  } catch (err) {
    // 개별 파일 파싱 실패는 무시하되, 첫 오류만 진단용으로 기록
    if (!loggedErrorRef.v) {
      loggedErrorRef.v = true
      console.error('metadata parse failed:', filename, (err as Error)?.message)
    }
    const { category, subcategory } = resolveCategory(filename, folderPath)
    upsertTrack({
      libraryId,
      filePath,
      filename,
      durationMs: null,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      category,
      subcategory
    })
  }
}

export async function scanLibrary(
  rootPath: string,
  onProgress?: (progress: ScanProgress) => void
): Promise<Library> {
  const name = rootPath.split(/[\\/]/).filter(Boolean).pop() ?? rootPath
  const library = upsertLibrary(rootPath, name)

  const files = await collectAudioFiles(rootPath, onProgress)
  const loggedErrorRef = { v: false }
  const presentFilePaths = new Set<string>()

  beginScanBatch()
  try {
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i]
      presentFilePaths.add(filePath)
      await parseAndUpsert(filePath, library.id, rootPath, loggedErrorRef)
      onProgress?.({
        phase: 'parsing',
        scanned: i + 1,
        total: files.length,
        currentFile: filePath.split(/[\\/]/).pop() ?? filePath
      })
    }
    deleteMissingTracks(library.id, presentFilePaths)
    endScanBatch()
  } catch (err) {
    rollbackScanBatch()
    throw err
  }

  return library
}

// "Scan for new files" — 기존에 등록된 파일은 건드리지 않고, DB에 없는 새 파일만 추가.
// (삭제된 파일 정리는 하지 않는 non-destructive 스캔)
export async function scanNewFilesOnly(
  rootPath: string,
  libraryId: number,
  onProgress?: (progress: ScanProgress) => void
): Promise<number> {
  const files = await collectAudioFiles(rootPath, onProgress)
  const newFiles = files.filter((f) => !hasTrackFilePath(f))
  const loggedErrorRef = { v: false }

  beginScanBatch()
  try {
    for (let i = 0; i < newFiles.length; i++) {
      const filePath = newFiles[i]
      await parseAndUpsert(filePath, libraryId, rootPath, loggedErrorRef)
      onProgress?.({
        phase: 'parsing',
        scanned: i + 1,
        total: newFiles.length,
        currentFile: filePath.split(/[\\/]/).pop() ?? filePath
      })
    }
    endScanBatch()
  } catch (err) {
    rollbackScanBatch()
    throw err
  }

  return newFiles.length
}
