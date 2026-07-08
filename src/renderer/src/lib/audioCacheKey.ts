// 오디오 파일의 "내용이 바뀌었는지" 판단하는 캐시 키.
// 웨이브폼 캐시(PlayerBar)와 분석 캐시(AnalysisPanel)가 동일한 키 규칙을 공유한다.
// fileHash(내용 기반 부분 해시)가 있으면 그것만으로 키를 만든다 — 파일 이름 변경/이동으로
// 경로가 바뀌어도 내용이 같으면 같은 키가 나와 기존 웨이브폼 캐시를 그대로 재사용할 수 있다.
// fileHash가 없는(아직 인덱싱 전이거나 구버전 DB) 경우에만 경로+크기+mtime로 폴백한다.
export interface AudioAccess {
  url: string;
  size: number;
  mtimeMs: number;
}

export function audioCacheKey(
  filePath: string,
  access: AudioAccess,
  fileHash?: string | null,
): string {
  if (fileHash) return `hash:${fileHash}`;
  return `${filePath}|${access.size}|${Math.round(access.mtimeMs)}`;
}
