import { useEffect, useState } from "react";
import type { Track } from "@shared/types";

interface DuplicatesModalProps {
  onClose: () => void;
  onRemoveTrack: (track: Track) => void;
  onNotify?: (message: string) => void;
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

export default function DuplicatesModal({
  onClose,
  onRemoveTrack,
  onNotify,
}: DuplicatesModalProps): JSX.Element {
  const [groups, setGroups] = useState<Track[][] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api?.findDuplicates().then((g) => {
      if (!cancelled) setGroups(g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleRemove(track: Track): void {
    void window.api?.removeTrack(track.id).then(() => {
      onRemoveTrack(track);
      setGroups(
        (prev) =>
          prev
            ?.map((g) => g.filter((t) => t.id !== track.id))
            .filter((g) => g.length > 1) ?? null,
      );
    });
  }

  const totalExtra = groups?.reduce((sum, g) => sum + g.length - 1, 0) ?? 0;

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal modal--wide dup-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__title">Find Duplicates</div>

        {groups === null && (
          <div className="dup-modal__empty">Scanning library…</div>
        )}
        {groups !== null && groups.length === 0 && (
          <div className="dup-modal__empty">No duplicate files found.</div>
        )}
        {groups !== null && groups.length > 0 && (
          <>
            <div className="dup-modal__summary">
              {groups.length} duplicate group(s), {totalExtra} extra file(s)
            </div>
            <div className="dup-modal__list">
              {groups.map((group) => (
                <div className="dup-modal__group" key={group[0].id}>
                  {group.map((track, i) => (
                    <div className="dup-modal__item" key={track.id}>
                      <div className="dup-modal__item-info">
                        <span className="dup-modal__item-name">
                          {i === 0 && (
                            <span className="dup-modal__badge">Original</span>
                          )}
                          {track.filename}
                        </span>
                        <span className="dup-modal__item-path">
                          {track.filePath}
                        </span>
                        <span className="dup-modal__item-size">
                          {formatFileSize(track.fileSize)}
                        </span>
                      </div>
                      <div className="dup-modal__item-actions">
                        <button
                          className="modal__btn"
                          onClick={() =>
                            void window.api?.showItemInFolder(track.filePath)
                          }
                        >
                          Show in Explorer
                        </button>
                        <button
                          className="modal__btn"
                          onClick={() => {
                            handleRemove(track);
                            onNotify?.(
                              `Removed ${track.filename} from library`,
                            );
                          }}
                        >
                          Remove from library
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal__actions">
          <button className="modal__btn modal__btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
