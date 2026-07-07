import { useEffect } from 'react'

interface ShortcutsModalProps {
  onClose: () => void
}

const SHORTCUTS: Array<{ keys: string; desc: string }> = [
  { keys: 'Space', desc: '재생 / 일시정지' },
  { keys: 'Enter', desc: '선택 사운드 재생' },
  { keys: 'Esc', desc: '정지 및 구간 선택 해제' },
  { keys: '↑ / ↓', desc: '이전 / 다음 사운드 선택' },
  { keys: 'S', desc: '리스트 즉시 셔플' },
  { keys: 'F', desc: '즐겨찾기 토글' },
  { keys: 'Ctrl + F', desc: '메인 검색창 포커스' },
  { keys: 'Ctrl + Shift + F', desc: '서브 검색창 포커스' },
  { keys: 'Ctrl + A', desc: '현재 리스트 전체 선택' },
  { keys: 'Delete', desc: '컬렉션에서 선택 항목 제거' },
  { keys: 'F2', desc: '선택 컬렉션 / 라이브러리 이름 변경' },
  { keys: 'Ctrl + R', desc: '현재 라이브러리 새 파일 스캔' },
  { keys: 'Ctrl + O', desc: '현재 폴더 탐색기에서 열기' }
]

export default function ShortcutsModal({ onClose }: ShortcutsModalProps): JSX.Element {
  useEffect(() => {
    function onEsc(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onEsc, true)
    return () => document.removeEventListener('keydown', onEsc, true)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal modal--wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__title">키보드 단축키</div>
        <div className="shortcuts">
          {SHORTCUTS.map((s) => (
            <div className="shortcuts__row" key={s.keys}>
              <span className="shortcuts__keys">{s.keys}</span>
              <span className="shortcuts__desc">{s.desc}</span>
            </div>
          ))}
        </div>
        <div className="modal__actions">
          <button className="modal__btn modal__btn--primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
