// 오디오 파일의 "내용이 바뀌었는지" 판단하는 캐시 키 — 경로+크기+mtime 조합.
// 웨이브폼 캐시(PlayerBar)와 분석 캐시(AnalysisPanel)가 동일한 키 규칙을 공유한다.
export interface AudioAccess {
  url: string
  size: number
  mtimeMs: number
}

export function audioCacheKey(filePath: string, access: AudioAccess): string {
  return `${filePath}|${access.size}|${Math.round(access.mtimeMs)}`
}
