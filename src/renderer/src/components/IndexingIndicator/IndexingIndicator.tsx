import type { ScanProgress } from "@shared/types";

interface IndexingIndicatorProps {
  progress: ScanProgress | null;
}

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// 신규/변경/이동/삭제/건너뜀을 구분해 한 줄로 요약한다. 0인 항목은 빼서 짧게 유지.
function breakdown(progress: ScanProgress): string {
  const parts: string[] = [];
  if (progress.added) parts.push(`신규 ${progress.added.toLocaleString()}`);
  if (progress.updated) parts.push(`변경 ${progress.updated.toLocaleString()}`);
  if (progress.moved) parts.push(`이동 ${progress.moved.toLocaleString()}`);
  if (progress.removed) parts.push(`삭제 ${progress.removed.toLocaleString()}`);
  if (progress.skipped)
    parts.push(`건너뜀 ${progress.skipped.toLocaleString()}`);
  if (progress.errors) parts.push(`오류 ${progress.errors.toLocaleString()}`);
  return parts.join(" · ");
}

export default function IndexingIndicator({
  progress,
}: IndexingIndicatorProps): JSX.Element {
  const total = progress?.total ?? 0;
  const scanned = progress?.scanned ?? 0;
  const indeterminate = !progress || progress.phase !== "parsing" || total <= 0;
  const pct = indeterminate ? 0 : Math.min(100, (scanned / total) * 100);
  const offset = CIRCUMFERENCE * (1 - pct / 100);
  const detail = progress ? breakdown(progress) : "";

  const countText = (): string => {
    if (!progress) return "파일 검색 중…";
    if (progress.phase === "discovering") return "변경된 폴더 확인 중…";
    if (progress.phase === "finalizing") return "정리 중…";
    if (total <= 0) return "변경 없음";
    return `${scanned.toLocaleString()} / ${total.toLocaleString()}`;
  };

  return (
    <div className="indexing">
      <svg
        className={`indexing__ring${indeterminate ? " indexing__ring--indeterminate" : ""}`}
        width="34"
        height="34"
        viewBox="0 0 34 34"
      >
        <circle className="indexing__ring-track" cx="17" cy="17" r={RADIUS} />
        <circle
          className="indexing__ring-fill"
          cx="17"
          cy="17"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={indeterminate ? CIRCUMFERENCE * 0.75 : offset}
        />
      </svg>
      <div className="indexing__text">
        <span className="indexing__label">Indexing…</span>
        <span className="indexing__count">{countText()}</span>
        {detail && <span className="indexing__breakdown">{detail}</span>}
      </div>
    </div>
  );
}
