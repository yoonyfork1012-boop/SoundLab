import type { Library, Track } from '@shared/types'

export interface ColumnCtx {
  libraries: Library[]
}

export interface ColumnDef {
  key: string
  label: string
  defaultWidth: number // 고정 px 폭 — 컬럼은 항상 독립적으로 리사이즈됨 (fr 사용 안 함)
  align?: 'right'
  icon?: boolean // 헤더에 텍스트 대신 아이콘을 그릴지 여부 (ResultList가 아이콘 매핑)
  value: (t: Track, ctx: ColumnCtx) => string
  sortValue?: (t: Track, ctx: ColumnCtx) => string | number
}

function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function ext(t: Track): string {
  return t.filename.split('.').pop()?.toLowerCase() ?? ''
}

function fmtFormat(t: Track): string {
  if (t.bitDepth && t.sampleRate) return `${Math.round(t.sampleRate / 1000)} ${t.bitDepth}`
  return ext(t)
}

function libraryPath(t: Track, ctx: ColumnCtx): string {
  const lib = ctx.libraries.find((l) => l.id === t.libraryId)
  if (!lib) return ''
  const root = norm(lib.rootPath)
  const rel = norm(t.filePath).slice(root.length).replace(/^\/+/, '')
  const folder = rel.split('/').slice(0, -1).join('/')
  return folder ? `${lib.name}/${folder}` : lib.name
}

function fmtDate(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString()
}

// Soundly 컬럼 순서/이름 그대로. 데이터가 없는 필드는 빈 값으로 표시.
export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', defaultWidth: 260, value: (t) => t.filename, sortValue: (t) => t.filename.toLowerCase() },
  {
    key: 'duration',
    label: 'Duration',
    defaultWidth: 78,
    align: 'right',
    icon: true,
    value: (t) => fmtDuration(t.durationMs),
    sortValue: (t) => t.durationMs ?? -1
  },
  {
    key: 'format',
    label: 'Format',
    defaultWidth: 84,
    icon: true,
    value: (t) => fmtFormat(t),
    sortValue: (t) => fmtFormat(t)
  },
  {
    key: 'channels',
    label: 'Channels',
    defaultWidth: 78,
    align: 'right',
    icon: true,
    value: (t) => (t.channels ? String(t.channels) : ''),
    sortValue: (t) => t.channels ?? -1
  },
  { key: 'library', label: 'Library', defaultWidth: 220, value: (t, c) => libraryPath(t, c), sortValue: (t, c) => libraryPath(t, c).toLowerCase() },
  { key: 'description', label: 'Description', defaultWidth: 200, value: (t) => t.description ?? '' },
  { key: 'originator', label: 'Originator', defaultWidth: 120, value: () => '' },
  { key: 'tape', label: 'Tape', defaultWidth: 100, value: () => '' },
  { key: 'scene', label: 'Scene', defaultWidth: 90, value: () => '' },
  { key: 'take', label: 'Take', defaultWidth: 80, value: () => '' },
  { key: 'note', label: 'Note', defaultWidth: 120, value: () => '' },
  { key: 'project', label: 'Project', defaultWidth: 120, value: () => '' },
  { key: 'category', label: 'Category', defaultWidth: 130, value: (t) => t.category ?? '', sortValue: (t) => (t.category ?? '').toLowerCase() },
  { key: 'subcategory', label: 'Sub Category', defaultWidth: 130, value: (t) => t.subcategory ?? '', sortValue: (t) => (t.subcategory ?? '').toLowerCase() },
  { key: 'reference', label: 'Reference', defaultWidth: 100, value: () => '' },
  { key: 'originationDate', label: 'Origination Date', defaultWidth: 140, value: () => '' },
  { key: 'dateAdded', label: 'Date Added', defaultWidth: 110, value: (t) => fmtDate(t.addedAt), sortValue: (t) => t.addedAt ?? 0 },
  { key: 'fileFormat', label: 'File Format', defaultWidth: 90, value: (t) => ext(t), sortValue: (t) => ext(t) },
  { key: 'filePath', label: 'File Path', defaultWidth: 240, value: (t) => t.filePath, sortValue: (t) => t.filePath.toLowerCase() },
  { key: 'smartDescription', label: 'Smart Description', defaultWidth: 200, value: () => '' },
  { key: 'ucsCategory', label: 'UCS Category', defaultWidth: 120, value: (t) => t.category ?? '' },
  { key: 'ucsSubcategory', label: 'UCS Subcategory', defaultWidth: 120, value: (t) => t.subcategory ?? '' },
  { key: 'ucsFxname', label: 'UCS Fxname', defaultWidth: 120, value: () => '' },
  { key: 'ucsCreatorid', label: 'UCS Creatorid', defaultWidth: 110, value: () => '' },
  { key: 'ucsSourceid', label: 'UCS Sourceid', defaultWidth: 110, value: () => '' },
  { key: 'ucsUsercategory', label: 'UCS Usercategory', defaultWidth: 130, value: () => '' },
  { key: 'ucsVendorcategory', label: 'UCS Vendorcategory', defaultWidth: 140, value: () => '' },
  { key: 'ucsUserdata', label: 'UCS Userdata', defaultWidth: 120, value: () => '' }
]

// 사진의 체크된 기본 컬럼
export const DEFAULT_VISIBLE = [
  'name',
  'duration',
  'format',
  'channels',
  'library',
  'category',
  'subcategory'
]

export function sortTracks(
  tracks: Track[],
  sortKey: string | null,
  sortDir: 'asc' | 'desc',
  ctx: ColumnCtx
): Track[] {
  if (!sortKey) return tracks
  const col = ALL_COLUMNS.find((c) => c.key === sortKey)
  if (!col) return tracks
  const getValue = col.sortValue ?? col.value
  const dir = sortDir === 'asc' ? 1 : -1
  return [...tracks].sort((a, b) => {
    const va = getValue(a, ctx)
    const vb = getValue(b, ctx)
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
}

// 트랙 id + seed로부터 안정적인 의사난수 가중치 생성 (동일 seed면 렌더마다 순서가 바뀌지 않음)
function hashInt(n: number): number {
  let x = n | 0
  x = ((x >> 16) ^ x) * 0x45d9f3b
  x = ((x >> 16) ^ x) * 0x45d9f3b
  x = (x >> 16) ^ x
  return x >>> 0
}

// Shuffle Mode — 현재 필터링된 리스트 자체의 표시 순서를 무작위로 섞는다 (재생 순서 전용이 아님).
// seed가 같으면 필터가 바뀌어도(검색어 입력 등) 매번 다시 섞이지 않고 안정적인 순서를 유지.
export function shuffleTracks(tracks: Track[], seed: number): Track[] {
  return [...tracks]
    .map((t) => ({ t, w: hashInt(t.id ^ seed) }))
    .sort((a, b) => a.w - b.w)
    .map((x) => x.t)
}
