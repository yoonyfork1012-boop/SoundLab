import { useEffect, useState } from "react";
import type { FolderNode } from "../../lib/folderTree";

interface FolderGridProps {
  folders: FolderNode[];
  onOpenFolder: (path: string) => void;
}

function FolderCard({
  folder,
  onOpen,
}: {
  folder: FolderNode;
  onOpen: () => void;
}): JSX.Element {
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    setCover(null);
    if (!window.api?.getFolderCover) return;
    let cancelled = false;
    void window.api.getFolderCover(folder.path).then((res) => {
      if (!cancelled) setCover(res?.url ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [folder.path]);

  return (
    <div className="fgrid__card" onDoubleClick={onOpen} onClick={onOpen}>
      <div className="fgrid__thumb">
        {cover ? (
          <img className="fgrid__thumb-img" src={cover} alt="" />
        ) : (
          <svg
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        )}
      </div>
      <div className="fgrid__name" title={folder.name}>
        {folder.name}
      </div>
      <div className="fgrid__count">{folder.trackCount} sounds</div>
    </div>
  );
}

export default function FolderGrid({
  folders,
  onOpenFolder,
}: FolderGridProps): JSX.Element {
  return (
    <div className="fgrid">
      {folders.map((f) => (
        <FolderCard
          key={f.path}
          folder={f}
          onOpen={() => onOpenFolder(f.path)}
        />
      ))}
    </div>
  );
}
