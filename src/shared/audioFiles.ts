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

// 파일 내용으로 판별하는 컨테이너 종류 -------------------------------------
//
// 확장자만 믿으면 안 되는 실제 사례가 라이브러리에 대량으로 있다:
//  - macOS에서 복사된 라이브러리에는 파일마다 AppleDouble 사이드카(4KB짜리 메타데이터
//    껍데기)가 딸려 온다. 이게 .wav 확장자를 달고 있어 오디오로 색인되면 클릭해도
//    소리가 날 수 없다. 이름이 "._foo.wav"면 isIgnoredFilename이 거르지만, 압축을
//    풀거나 복사하는 과정에서 "__foo.wav"로 바뀐 것들은 이름으로 구분할 방법이 없다.
//  - 내용은 AIFF인데 이름이 .wav인 파일들이 있다. 확장자대로 WAV로 다루면
//    music-metadata가 빈 결과를 돌려주고(예외도 안 던진다) 메타데이터가 통째로 빈다.
export type AudioContainerKind =
  | "riff" // RIFF/WAVE — 일반적인 wav
  | "aiff" // FORM/AIFF|AIFC — 확장자가 .wav여도 이쪽일 수 있다
  | "appledouble" // macOS 사이드카. 오디오가 아니다
  | "empty" // 0바이트
  | "unknown";

/** AppleDouble 매직 (0x00051607). 뒤이어 "Mac " 같은 홈 파일시스템 문자열이 온다. */
const APPLEDOUBLE_MAGIC = 0x00051607;

/**
 * 파일 앞부분 12바이트로 컨테이너 종류를 판별한다. 파일 전체를 읽지 않으므로
 * 메타데이터 파싱이 비어 있을 때만 불러도 비용이 거의 없다.
 */
export function sniffAudioContainer(
  head: Uint8Array,
  fileSize?: number,
): AudioContainerKind {
  if (fileSize === 0) return "empty";
  if (head.length < 12) return head.length === 0 ? "empty" : "unknown";
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(0, false) === APPLEDOUBLE_MAGIC) return "appledouble";
  const magic = String.fromCharCode(...head.subarray(0, 4));
  const form = String.fromCharCode(...head.subarray(8, 12));
  if (magic === "RIFF" && form === "WAVE") return "riff";
  if (magic === "FORM" && (form === "AIFF" || form === "AIFC")) return "aiff";
  return "unknown";
}

/** 오디오로 색인할 가치가 있는가 — 껍데기 파일과 빈 파일을 걸러낸다. */
export function isPlayableContainer(kind: AudioContainerKind): boolean {
  return kind !== "appledouble" && kind !== "empty";
}
