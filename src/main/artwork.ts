import { nativeImage } from 'electron'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join, extname } from 'path'
import { createHash } from 'crypto'
import { ARTWORK_DIR } from './db'

// 앨범 커버 자동 적용. 원본 이미지는 절대 수정하지 않고, 512px로 리사이즈한 JPEG를
// ~/.soundlib/artwork 캐시에 저장해 재사용한다. 렌더러에는 data URL로 전달.

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp'])
// 우선순위 있는 커버 파일명 (확장자 제외, 소문자)
const COVER_BASENAMES = ['folder', 'cover', 'album', 'artwork', 'wallpaper', 'front']
const MAX_DIM = 512

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

function resizeToJpeg(buf: Buffer): Buffer | null {
  try {
    let img = nativeImage.createFromBuffer(buf)
    if (img.isEmpty()) return null
    const { width } = img.getSize()
    if (width > MAX_DIM) img = img.resize({ width: MAX_DIM })
    return img.toJPEG(82)
  } catch {
    return null
  }
}

function toDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`
}

// 폴더 안에서 커버로 쓸 이미지 경로를 찾는다 (명명된 커버 우선, 없으면 첫 이미지 파일)
export function findCoverInDir(dir: string): string | null {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  const images = entries.filter((e) => e.isFile() && IMG_EXT.has(extname(e.name).toLowerCase()))
  if (images.length === 0) return null
  for (const base of COVER_BASENAMES) {
    const hit = images.find((e) => e.name.toLowerCase().replace(/\.[^.]+$/, '') === base)
    if (hit) return join(dir, hit.name)
  }
  return join(dir, images[0].name)
}

// 폴더 커버 이미지 → 리사이즈된 data URL (캐시)
export function getFolderCoverDataUrl(coverPath: string): string | null {
  if (!coverPath || !existsSync(coverPath)) return null
  const cache = join(ARTWORK_DIR, `fld_${sha1(coverPath)}.jpg`)
  try {
    if (existsSync(cache)) return toDataUrl(readFileSync(cache))
    const jpeg = resizeToJpeg(readFileSync(coverPath))
    if (!jpeg) return null
    writeFileSync(cache, jpeg)
    return toDataUrl(jpeg)
  } catch {
    return null
  }
}

// 오디오 임베디드 아트워크 → 리사이즈된 data URL (캐시). 없으면 null.
export async function getEmbeddedArtworkDataUrl(
  filePath: string,
  parseFile: (p: string) => Promise<{ common?: { picture?: Array<{ data: Uint8Array }> } }>
): Promise<string | null> {
  const cache = join(ARTWORK_DIR, `emb_${sha1(filePath)}.jpg`)
  try {
    if (existsSync(cache)) return toDataUrl(readFileSync(cache))
    const meta = await parseFile(filePath)
    const pic = meta.common?.picture?.[0]
    if (!pic) return null
    const jpeg = resizeToJpeg(Buffer.from(pic.data))
    if (!jpeg) return null
    writeFileSync(cache, jpeg)
    return toDataUrl(jpeg)
  } catch {
    return null
  }
}
