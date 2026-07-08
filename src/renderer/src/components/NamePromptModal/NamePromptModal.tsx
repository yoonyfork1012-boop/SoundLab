import { useEffect, useRef, useState } from "react";

interface NamePromptModalProps {
  title: string;
  confirmLabel?: string;
  defaultValue?: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export default function NamePromptModal({
  title,
  confirmLabel = "만들기",
  defaultValue = "",
  onSubmit,
  onCancel,
}: NamePromptModalProps): JSX.Element {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(): void {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__title">{title}</div>
        <input
          ref={inputRef}
          className="modal__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal__actions">
          <button className="modal__btn" onClick={onCancel}>
            취소
          </button>
          <button className="modal__btn modal__btn--primary" onClick={submit}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
