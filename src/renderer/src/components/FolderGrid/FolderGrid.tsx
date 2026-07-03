import type { FolderNode } from '../../lib/folderTree'

interface FolderGridProps {
  folders: FolderNode[]
  onOpenFolder: (path: string) => void
}

export default function FolderGrid({ folders, onOpenFolder }: FolderGridProps): JSX.Element {
  return (
    <div className="fgrid">
      {folders.map((f) => (
        <div className="fgrid__card" key={f.path} onDoubleClick={() => onOpenFolder(f.path)} onClick={() => onOpenFolder(f.path)}>
          <div className="fgrid__thumb">
            <svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          <div className="fgrid__name" title={f.name}>{f.name}</div>
          <div className="fgrid__count">{f.trackCount} sounds</div>
        </div>
      ))}
    </div>
  )
}
