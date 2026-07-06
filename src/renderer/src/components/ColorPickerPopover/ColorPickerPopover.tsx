import { useEffect, useRef } from 'react'
import { ACCENT_PRESETS } from '../../lib/theme'

interface ColorPickerPopoverProps {
  x: number
  y: number
  color: string | null
  onPick: (hex: string | null) => void
  onClose: () => void
}

export default function ColorPickerPopover({ x, y, color, onPick, onClose }: ColorPickerPopoverProps): JSX.Element {
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

  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 216),
    top: Math.min(y, window.innerHeight - 200),
    position: 'fixed'
  }

  return (
    <div className="accent__pop" style={style} ref={ref} onMouseDown={(e) => e.stopPropagation()}>
      <div className="accent__label">색상 지정</div>
      <div className="accent__swatches">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.color}
            className={`accent__chip${color?.toLowerCase() === p.color.toLowerCase() ? ' accent__chip--on' : ''}`}
            style={{ background: p.color }}
            title={p.name}
            onClick={() => {
              onPick(p.color)
              onClose()
            }}
          />
        ))}
      </div>
      <label className="accent__custom">
        <span>사용자 지정</span>
        <input type="color" value={color ?? '#7fd6a6'} onChange={(e) => onPick(e.target.value)} />
      </label>
      <button
        className="modal__btn"
        style={{ width: '100%', marginTop: 10 }}
        onClick={() => {
          onPick(null)
          onClose()
        }}
      >
        색상 지우기
      </button>
    </div>
  )
}
