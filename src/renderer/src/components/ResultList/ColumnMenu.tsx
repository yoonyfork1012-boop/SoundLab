import { useEffect, useRef } from 'react'
import { ALL_COLUMNS } from './columns'

interface ColumnMenuProps {
  x: number
  y: number
  visible: Set<string>
  onToggle: (key: string) => void
  onShuffle: () => void
  onAutoResize: () => void
  onClose: () => void
}

export default function ColumnMenu({
  x,
  y,
  visible,
  onToggle,
  onShuffle,
  onAutoResize,
  onClose
}: ColumnMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  // 화면 밖으로 넘치지 않게 위치 보정
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 240),
    top: Math.min(y, window.innerHeight - 640)
  }

  return (
    <div className="colmenu" style={style} ref={ref}>
      <button className="colmenu__item colmenu__item--action" onClick={() => { onShuffle(); onClose() }}>
        <span>Shuffle search results</span>
        <span className="colmenu__shortcut">Ctrl+L</span>
      </button>
      <button className="colmenu__item colmenu__item--action" onClick={() => { onAutoResize(); onClose() }}>
        Auto resize columns
      </button>
      <button className="colmenu__item colmenu__item--action colmenu__item--disabled">Save layout</button>
      <div className="colmenu__sep" />
      <div className="colmenu__scroll">
        {ALL_COLUMNS.map((col) => (
          <button key={col.key} className="colmenu__item" onClick={() => onToggle(col.key)}>
            <span className="colmenu__check">
              {visible.has(col.key) && (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <path d="M1.5 5L4 7.5L8.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span>{col.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
