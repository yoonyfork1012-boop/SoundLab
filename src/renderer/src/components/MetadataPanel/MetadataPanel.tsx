import { useEffect, useRef, useState } from "react";
import type {
  Library,
  PublisherRule,
  Track,
  TrackMetadataPatch,
} from "@shared/types";
import { colorForCategory } from "@shared/ucsCategories";
import { TAXONOMY } from "@shared/soundTaxonomy";
import { toTitleCase } from "@shared/textCase";
import { formatPublisherName, resolveTrackPublisher } from "@shared/publisher";

interface MetadataPanelProps {
  track: Track | null;
  libraries: Library[];
  publisherRule: PublisherRule;
  onToggleStar: (track: Track) => void;
  onUpdateMetadata: (trackId: number, patch: TrackMetadataPatch) => void;
}

type ArtworkResult = { url: string; source: string } | null;

const artworkCache = new Map<string, ArtworkResult>();

const CATEGORY_OPTIONS = TAXONOMY.map((r) => r.category);
const SUBCATEGORY_OPTIONS = Array.from(
  new Set(TAXONOMY.flatMap((r) => r.subcategories.map((s) => s.name))),
);

function artworkCacheKey(
  filePath: string,
  folderCoverPath: string | null,
): string {
  return `${filePath}|${folderCoverPath ?? ""}`;
}

const IconPencil = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export default function MetadataPanel({
  track,
  libraries,
  publisherRule,
  onToggleStar,
  onUpdateMetadata,
}: MetadataPanelProps): JSX.Element {
  const [artwork, setArtwork] = useState<ArtworkResult>(null);
  // 편집 UI는 기본으로 접혀 있고, 연필 버튼을 눌러야 입력 필드로 바뀐다.
  // 평소에는 읽기 전용 표시라 패널이 조용하고, 실수로 값을 건드릴 일도 없다.
  const [editing, setEditing] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [subcategoryDraft, setSubcategoryDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [tagInput, setTagInput] = useState("");
  const trackRef = useRef(track);
  trackRef.current = track;

  // 다른 사운드로 넘어가면 편집 모드를 닫고 태그 입력을 비운다 — 열어둔 채 넘어가면
  // 어느 트랙을 고치는지 헷갈린다.
  useEffect(() => {
    setTagInput("");
    setEditing(false);
  }, [track?.id]);

  // 트랙의 메타데이터 값이 바뀌면 드래프트를 최신값으로 재동기화한다. 배치 편집이나 워처
  // 업데이트는 같은 id의 새 Track 객체로 교체하므로 [track?.id]만으로는 안 잡히고, 그러면
  // 편집을 열었을 때 stale 값이 보이고 Done이 더 새로운 값을 덮어쓴다. 단, 편집 중에는
  // 사용자가 입력 중인 값을 지우지 않도록 재동기화를 건너뛴다(편집을 닫으면 다시 맞춘다).
  useEffect(() => {
    if (editing) return;
    setCategoryDraft(track?.category ?? "");
    setSubcategoryDraft(track?.subcategory ?? "");
    setDescriptionDraft(track?.description ?? "");
  }, [
    track?.id,
    track?.category,
    track?.subcategory,
    track?.description,
    editing,
  ]);

  useEffect(() => {
    if (!track || !window.api?.getTrackArtwork) {
      setArtwork(null);
      return;
    }
    const key = artworkCacheKey(track.filePath, track.artworkPath);
    if (artworkCache.has(key)) {
      setArtwork(artworkCache.get(key) ?? null);
      return;
    }
    setArtwork(null);
    let cancelled = false;
    void window.api
      .getTrackArtwork(track.filePath, track.artworkPath)
      .then((res) => {
        artworkCache.set(key, res);
        if (!cancelled) setArtwork(res);
      });
    return () => {
      cancelled = true;
    };
  }, [track?.id, track?.filePath, track?.artworkPath]);

  if (!track) {
    return (
      <aside className="meta">
        <div className="meta__empty">Select a sound to show metadata.</div>
      </aside>
    );
  }

  const color = colorForCategory(track.category);
  const publisher = formatPublisherName(
    resolveTrackPublisher(track, libraries, publisherRule),
  );

  function commitCategory(): void {
    const next = categoryDraft.trim();
    if (next === (track!.category ?? "")) return;
    onUpdateMetadata(track!.id, { category: next || null });
  }

  function commitSubcategory(): void {
    const next = subcategoryDraft.trim();
    if (next === (track!.subcategory ?? "")) return;
    onUpdateMetadata(track!.id, { subcategory: next || null });
  }

  function commitDescription(): void {
    const next = descriptionDraft.trim();
    if (next === (track!.description ?? "")) return;
    onUpdateMetadata(track!.id, { description: next || null });
  }

  function addTag(): void {
    const next = tagInput.trim();
    setTagInput("");
    if (!next || track!.tags.includes(next)) return;
    onUpdateMetadata(track!.id, { addTags: [next] });
  }

  function removeTag(tag: string): void {
    onUpdateMetadata(track!.id, { removeTags: [tag] });
  }

  // 편집 모드를 닫을 때는 아직 커밋되지 않은 입력값을 먼저 반영한다. 보통은 버튼 클릭 전
  // 발생하는 blur가 처리하지만, 키보드로 닫는 경우처럼 blur가 없는 경로도 있어서다.
  function toggleEditing(): void {
    if (editing) {
      commitCategory();
      commitSubcategory();
      commitDescription();
      addTag();
    }
    setEditing((v) => !v);
  }

  return (
    <aside className="meta">
      <div
        className="meta__artwork"
        style={
          artwork
            ? undefined
            : { background: `linear-gradient(150deg, ${color}44, ${color}12)` }
        }
      >
        {artwork ? (
          <img className="meta__artwork-img" src={artwork.url} alt="" />
        ) : (
          <svg
            width="64"
            height="64"
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.9"
          >
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        )}
        {artwork && (
          <span className="meta__artwork-badge">{artwork.source}</span>
        )}
      </div>

      <div className="meta__title-row">
        <div className="meta__title">{track.filename}</div>
        <div className="meta__title-actions">
          <button
            className={`meta__edit-btn${editing ? " meta__edit-btn--on" : ""}`}
            onClick={toggleEditing}
            title={editing ? "Done editing" : "Edit metadata"}
          >
            <IconPencil />
          </button>
          <span
            className={`meta__star${track.starred ? " meta__star--on" : ""}`}
            onClick={() => onToggleStar(track)}
            title="Toggle favorite"
          >
            {track.starred ? "★" : "☆"}
          </span>
        </div>
      </div>

      {editing ? (
        <textarea
          className="meta__desc-input"
          placeholder="Description / notes"
          rows={2}
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onBlur={commitDescription}
        />
      ) : (
        track.description && (
          <div className="meta__desc">{track.description}</div>
        )
      )}

      <div className="meta__grid">
        <span className="meta__key">Category</span>
        {editing ? (
          <input
            className="meta__val-input"
            list="meta-category-options"
            value={categoryDraft}
            onChange={(e) => setCategoryDraft(e.target.value)}
            onBlur={commitCategory}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="—"
          />
        ) : (
          <span className="meta__val">
            {toTitleCase(track.category ?? "") || "—"}
          </span>
        )}
        <span className="meta__key">Subcategory</span>
        {editing ? (
          <input
            className="meta__val-input"
            list="meta-subcategory-options"
            value={subcategoryDraft}
            onChange={(e) => setSubcategoryDraft(e.target.value)}
            onBlur={commitSubcategory}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="—"
          />
        ) : (
          <span className="meta__val">
            {toTitleCase(track.subcategory ?? "") || "—"}
          </span>
        )}
        <span className="meta__key">Publisher</span>
        <span className="meta__val">{publisher}</span>
        <span className="meta__key">Duration</span>
        <span className="meta__val">{formatDuration(track.durationMs)}</span>
        <span className="meta__key">File Size</span>
        <span className="meta__val">{formatFileSize(track.fileSize)}</span>
        <span className="meta__key">Sample Rate</span>
        <span className="meta__val">
          {track.sampleRate
            ? `${(track.sampleRate / 1000).toFixed(1)} kHz`
            : ""}
        </span>
        <span className="meta__key">Bit Depth</span>
        <span className="meta__val">
          {track.bitDepth
            ? `${track.bitDepth} ${track.isFloat ? "float" : "bit"}`
            : ""}
        </span>
        <span className="meta__key">Channels</span>
        <span className="meta__val">
          {track.channels
            ? track.channels === 1
              ? "Mono"
              : track.channels === 2
                ? "Stereo"
                : `${track.channels}ch`
            : ""}
        </span>
      </div>

      <datalist id="meta-category-options">
        {CATEGORY_OPTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="meta-subcategory-options">
        {SUBCATEGORY_OPTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      <div className="meta__section-label">Tags</div>
      <div className="meta__tags">
        {track.tags.map((tag) => (
          <span
            className={`meta__tag${editing ? " meta__tag--editable" : ""}`}
            key={tag}
          >
            {tag}
            {editing && (
              <span
                className="meta__tag-remove"
                onClick={() => removeTag(tag)}
                title="Remove tag"
              >
                ×
              </span>
            )}
          </span>
        ))}
        {editing && (
          <input
            className="meta__tag-input"
            placeholder="Add tag…"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
            onBlur={addTag}
          />
        )}
      </div>
    </aside>
  );
}
