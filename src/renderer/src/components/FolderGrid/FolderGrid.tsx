import { useEffect, useRef, useState } from "react";
import type { FolderNode } from "../../lib/folderTree";

interface FolderGridProps {
  folders: FolderNode[];
  onOpenFolder: (path: string) => void;
}

// 폴더 커버는 폴더 경로마다 딱 한 번만 가져오면 되는 값이다. 예전에는 캐시가 없어서
// Local 메뉴를 누를 때마다(=FolderGrid가 다시 마운트될 때마다) 루트 폴더 전부에 대해
// IPC를 새로 날렸고, 메인 프로세스가 폴더 readdir + 이미지 디코드를 동기로 처리하는 동안
// 앱 전체가 멈췄다. 세션 동안 유지되는 모듈 레벨 캐시로 재요청 자체를 없앤다.
const coverCache = new Map<string, string | null>();

function FolderCard({
  folder,
  onOpen,
}: {
  folder: FolderNode;
  onOpen: () => void;
}): JSX.Element {
  const cardRef = useRef<HTMLDivElement>(null);
  const [cover, setCover] = useState<string | null>(
    () => coverCache.get(folder.path) ?? null,
  );

  useEffect(() => {
    const cached = coverCache.get(folder.path);
    if (cached !== undefined) {
      setCover(cached);
      return;
    }
    setCover(null);
    if (!window.api?.getFolderCover) return;
    const el = cardRef.current;
    if (!el) return;

    let cancelled = false;
    const load = (): void => {
      void window.api?.getFolderCover(folder.path).then((res) => {
        const url = res?.url ?? null;
        coverCache.set(folder.path, url);
        if (!cancelled) setCover(url);
      });
    };

    // 화면에 들어온 카드만 커버를 가져온다 — 폴더가 수백 개여도 처음에 뜨는 몇 개만
    // 메인 프로세스에 일을 시키므로 Local 메뉴가 즉시 열린다.
    if (typeof IntersectionObserver === "undefined") {
      load();
      return () => {
        cancelled = true;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [folder.path]);

  return (
    <div
      ref={cardRef}
      className="fgrid__card"
      onDoubleClick={onOpen}
      onClick={onOpen}
    >
      <div className="fgrid__thumb">
        {cover ? (
          <img className="fgrid__thumb-img" src={cover} alt="" loading="lazy" />
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
      <div className="fgrid__count">
        {folder.trackCount.toLocaleString()} sounds
      </div>
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
