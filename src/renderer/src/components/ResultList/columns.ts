import type { Library, Track } from '@shared/types'

export interface ColumnCtx {
  library: Library | null
}

export interface ColumnDef {
  key: string
  label: string
  width: string // grid-template-columns 트랙 값 (예: '1fr', '80px')
  align?: 'right'
  value: (t: Track, ctx: ColumnCtx) => string
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
  if (!ctx.library) return ''
  const root = norm(ctx.library.rootPath)
  const rel = norm(t.filePath).slice(root.length).replace(/^\/+/, '')
  const folder = rel.split('/').slice(0, -1).join('/')
  return folder ? `${ctx.library.name}/${folder}` : ctx.library.name
}

function fmtDate(ms: number | null): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString()
}

// Soundly 컬럼 순서/이름 그대로. 데이터가 없는 필드는 빈 값으로 표시.
export const ALL_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', width: 'minmax(240px, 2fr)', value: (t) => t.filename },
  { key: 'duration', label: 'Duration', width: '78px', align: 'right', value: (t) => fmtDuration(t.durationMs) },
  { key: 'format', label: 'Format', width: '84px', value: (t) => fmtFormat(t) },
  { key: 'channels', label: 'Channels', width: '78px', align: 'right', value: (t) => (t.channels ? String(t.channels) : '') },
  { key: 'library', label: 'Library', width: 'minmax(200px, 2fr)', value: (t, c) => libraryPath(t, c) },
  { key: 'description', label: 'Description', width: 'minmax(160px, 1fr)', value: (t) => t.description ?? '' },
  { key: 'originator', label: 'Originator', width: '120px', value: () => '' },
  { key: 'tape', label: 'Tape', width: '100px', value: () => '' },
  { key: 'scene', label: 'Scene', width: '90px', value: () => '' },
  { key: 'take', label: 'Take', width: '80px', value: () => '' },
  { key: 'note', label: 'Note', width: '120px', value: () => '' },
  { key: 'project', label: 'Project', width: '120px', value: () => '' },
  { key: 'category', label: 'Category', width: 'minmax(120px, 1fr)', value: (t) => t.category ?? '' },
  { key: 'reference', label: 'Reference', width: '100px', value: () => '' },
  { key: 'originationDate', label: 'Origination Date', width: '120px', value: () => '' },
  { key: 'dateAdded', label: 'Date Added', width: '110px', value: (t) => fmtDate(t.addedAt) },
  { key: 'fileFormat', label: 'File Format', width: '90px', value: (t) => ext(t) },
  { key: 'filePath', label: 'File Path', width: 'minmax(200px, 2fr)', value: (t) => t.filePath },
  { key: 'smartDescription', label: 'Smart Description', width: 'minmax(160px, 1fr)', value: () => '' },
  { key: 'ucsCategory', label: 'UCS Category', width: '120px', value: (t) => t.category ?? '' },
  { key: 'ucsSubcategory', label: 'UCS Subcategory', width: '120px', value: (t) => t.subcategory ?? '' },
  { key: 'ucsFxname', label: 'UCS Fxname', width: '120px', value: () => '' },
  { key: 'ucsCreatorid', label: 'UCS Creatorid', width: '110px', value: () => '' },
  { key: 'ucsSourceid', label: 'UCS Sourceid', width: '110px', value: () => '' },
  { key: 'ucsUsercategory', label: 'UCS Usercategory', width: '130px', value: () => '' },
  { key: 'ucsVendorcategory', label: 'UCS Vendorcategory', width: '140px', value: () => '' },
  { key: 'ucsUserdata', label: 'UCS Userdata', width: '120px', value: () => '' }
]

// 사진의 체크된 기본 컬럼
export const DEFAULT_VISIBLE = ['name', 'duration', 'format', 'channels', 'library', 'category']
