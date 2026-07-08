import type { ScanProgress } from "@shared/types";

interface IndexingIndicatorProps {
  progress: ScanProgress | null;
}

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function IndexingIndicator({
  progress,
}: IndexingIndicatorProps): JSX.Element {
  const total = progress?.total ?? 0;
  const scanned = progress?.scanned ?? 0;
  const indeterminate =
    !progress || progress.phase === "discovering" || total <= 0;
  const pct = indeterminate ? 0 : Math.min(100, (scanned / total) * 100);
  const offset = CIRCUMFERENCE * (1 - pct / 100);

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
        <span className="indexing__count">
          {indeterminate
            ? "파일 검색 중…"
            : `${scanned.toLocaleString()} / ${total.toLocaleString()}`}
        </span>
      </div>
    </div>
  );
}
