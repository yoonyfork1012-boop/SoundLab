import { useEffect, useState } from "react";
import type { PublisherRule } from "@shared/types";

interface PublisherSettingsModalProps {
  value: PublisherRule;
  onSave: (next: PublisherRule) => void;
  onCancel: () => void;
}

const MODE_OPTIONS: Array<{
  value: PublisherRule["mode"];
  label: string;
  description: string;
}> = [
  {
    value: "library-root-child",
    label: "Library root child",
    description: "Use the first folder directly under the library root.",
  },
  {
    value: "file-parent-1",
    label: "File parent 1",
    description: "Use the immediate parent folder of the file.",
  },
  {
    value: "file-parent-2",
    label: "File parent 2",
    description: "Use the second parent folder above the file.",
  },
  {
    value: "file-parent-3",
    label: "File parent 3",
    description: "Use the third parent folder above the file.",
  },
  {
    value: "custom",
    label: "Custom path / pattern",
    description: "Use an explicit folder path or a simple path pattern.",
  },
];

export default function PublisherSettingsModal({
  value,
  onSave,
  onCancel,
}: PublisherSettingsModalProps): JSX.Element {
  const [mode, setMode] = useState<PublisherRule["mode"]>(value.mode);
  const [customPath, setCustomPath] = useState(value.customPath ?? "");

  useEffect(() => {
    setMode(value.mode);
    setCustomPath(value.customPath ?? "");
  }, [value]);

  async function pickFolder(): Promise<void> {
    const folder = await window.api?.selectFolder();
    if (!folder) return;
    setMode("custom");
    setCustomPath(folder);
  }

  function submit(): void {
    onSave({
      mode,
      customPath: mode === "custom" ? customPath.trim() || null : null,
    });
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal modal--wide publisher-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__title">Publisher detection</div>
        <div className="publisher-modal__body">
          <div className="publisher-modal__list">
            {MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`publisher-modal__choice${mode === option.value ? " publisher-modal__choice--active" : ""}`}
              >
                <input
                  type="radio"
                  name="publisher-mode"
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                />
                <span className="publisher-modal__choice-text">
                  <span className="publisher-modal__choice-label">
                    {option.label}
                  </span>
                  <span className="publisher-modal__choice-desc">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="publisher-modal__custom">
            <div className="publisher-modal__custom-row">
              <input
                className="modal__input"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="Folder path or pattern"
                disabled={mode !== "custom"}
              />
              <button
                className="modal__btn"
                onClick={() => void pickFolder()}
                disabled={!window.api?.selectFolder}
              >
                Choose folder
              </button>
            </div>
            <div className="publisher-modal__hint">
              Custom mode accepts a folder path or a path pattern. If the path
              does not match a sound, the app shows '-'.
            </div>
          </div>
        </div>
        <div className="modal__actions">
          <button className="modal__btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal__btn modal__btn--primary" onClick={submit}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
