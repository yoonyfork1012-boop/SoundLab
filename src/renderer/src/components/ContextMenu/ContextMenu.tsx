import { useEffect, useRef } from 'react'

export interface ContextMenuItem {
  key: string
  label?: string
  icon?: JSX.Element
  onClick?: () => void
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  separator?: boolean
  section?: string
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  width?: number
}

export default function ContextMenu({ x, y, items, onClose, width = 220 }: ContextMenuProps): JSX.Element {
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

  const estHeight = items.length * 32 + 16
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - width - 8),
    top: Math.min(y, window.innerHeight - estHeight - 8),
    minWidth: width
  }

  return (
    <div className="colmenu" style={style} ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((item, i) => {
        if (item.separator) return <div className="colmenu__sep" key={item.key ?? i} />
        if (item.section) {
          return (
            <div className="colmenu__section" key={item.key}>
              {item.section}
            </div>
          )
        }
        return (
          <button
            key={item.key}
            className={`colmenu__item${item.disabled ? ' colmenu__item--disabled' : ''}${item.danger ? ' colmenu__item--danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return
              item.onClick?.()
              onClose()
            }}
          >
            {(item.icon || item.checked !== undefined) && (
              <span className="colmenu__check">{item.checked ? item.icon ?? '✓' : item.icon}</span>
            )}
            <span>{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}
