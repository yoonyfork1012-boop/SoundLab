// 어떤 파일을 라이브러리에 넣을지 판단하는 규칙. 스캐너와 실시간 감시(watcher)가 반드시
// 같은 기준을 써야 한다 — 기준이 어긋나면 "감시가 넣은 파일을 스캔이 지우는" 진동이 생긴다.
// electron/fs에 의존하지 않는 순수 모듈이라 단위 테스트로 고정해 둔다.

export const SUPPORTED_EXTENSIONS = new Set([
  ".wav",
  ".aiff",
  ".aif",
  ".mp3",
  ".m4a",
  ".ogg",
  ".flac",
]);

/** 경로에서 파일명만 뽑는다 (Windows 백슬래시/POSIX 슬래시 모두 처리) */
export function basenameOf(pathOrName: string): string {
  return pathOrName.split(/[\\/]/).filter(Boolean).pop() ?? pathOrName;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/**
 * 인덱싱에서 제외할 파일명인가 — 숨김 파일과 "아직 복사가 끝나지 않은" 임시 파일.
 * 이런 파일을 인덱싱하면 복사 도중의 반쪽짜리 오디오가 라이브러리에 들어가고,
 * 복사가 끝나 이름이 바뀌는 순간 유령 항목으로 남는다.
 */
export function isIgnoredFilename(name: string): boolean {
  // 숨김 파일(.DS_Store), macOS AppleDouble(._foo.wav), Office 임시 잠금(~$foo)
  if (name.startsWith(".") || name.startsWith("~$") || name.startsWith("._"))
    return true;
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".tmp") ||
    lower.endsWith(".temp") ||
    lower.endsWith(".part") ||
    lower.endsWith(".partial") ||
    lower.endsWith(".download") ||
    lower.endsWith(".crdownload")
  );
}

/** 인덱싱 대상 오디오 파일인가 — 지원 확장자이면서 임시/숨김 파일이 아닌 것 */
export function isIndexableAudioFile(nameOrPath: string): boolean {
  const name = basenameOf(nameOrPath);
  if (isIgnoredFilename(name)) return false;
  return SUPPORTED_EXTENSIONS.has(extensionOf(name));
}

// 순회에서 통째로 제외할 폴더 — 시스템/숨김 폴더는 오디오 라이브러리일 수 없고,
// 접근 권한 오류만 발생시킨다.
const SKIP_DIR_NAMES = new Set([
  "$recycle.bin",
  "system volume information",
  "node_modules",
  ".git",
]);

export function isSkippedDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name.toLowerCase());
}
