import { useEffect, useState } from "react";
import type { Library, PublisherRule, Track } from "@shared/types";
import { colorForCategory } from "@shared/ucsCategories";
import { toTitleCase } from "@shared/textCase";
import { formatPublisherName, resolveTrackPublisher } from "@shared/publisher";

interface MetadataPanelProps {
  track: Track | null;
  libraries: Library[];
  publisherRule: PublisherRule;
  onToggleStar: (track: Track) => void;
}

type ArtworkResult = { url: string; source: string } | null;

const artworkCache = new Map<string, ArtworkResult>();

function artworkCacheKey(
  filePath: string,
  folderCoverPath: string | null,
): string {
  return `${filePath}|${folderCoverPath ?? ""}`;
}

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
}: MetadataPanelProps): JSX.Element {
  const [artwork, setArtwork] = useState<ArtworkResult>(null);

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
        <span
          className={`meta__star${track.starred ? " meta__star--on" : ""}`}
          onClick={() => onToggleStar(track)}
          title="Toggle favorite"
        >
          {track.starred ? "★" : "☆"}
        </span>
      </div>

      {track.description && (
        <div className="meta__desc">{track.description}</div>
      )}

      <div className="meta__grid">
        <span className="meta__key">Category</span>
        <span className="meta__val">
          {track.category ? toTitleCase(track.category) : ""}
        </span>
        <span className="meta__key">Subcategory</span>
        <span className="meta__val">
          {track.subcategory ? toTitleCase(track.subcategory) : ""}
        </span>
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

      {track.tags.length > 0 && (
        <>
          <div className="meta__section-label">Tags</div>
          <div className="meta__tags">
            {track.tags.map((tag) => (
              <span className="meta__tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}
