import { useEffect, useRef, useState } from "react";
import { ACCENT_PRESETS } from "../../lib/theme";

interface AccentPickerProps {
  accent: string;
  onChange: (hex: string) => void;
}

export default function AccentPicker({
  accent,
  onChange,
}: AccentPickerProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="accent" ref={ref}>
      <button
        className="accent__btn"
        title="테마 색상"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="accent__swatch" style={{ background: accent }} />
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 0 0 18c1.7 0 2-1.3 1-2.3-.8-.9-.3-2.2 1-2.2h1.5A3.5 3.5 0 0 0 20 13c0-4.4-3.6-10-8-10z" />
        </svg>
      </button>
      {open && (
        <div className="accent__pop">
          <div className="accent__label">테마 색상</div>
          <div className="accent__swatches">
            {ACCENT_PRESETS.map((p) => (
              <button
                key={p.color}
                className={`accent__chip${accent.toLowerCase() === p.color.toLowerCase() ? " accent__chip--on" : ""}`}
                style={{ background: p.color }}
                title={p.name}
                onClick={() => onChange(p.color)}
              />
            ))}
          </div>
          <label className="accent__custom">
            <span>사용자 지정</span>
            <input
              type="color"
              value={accent}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
