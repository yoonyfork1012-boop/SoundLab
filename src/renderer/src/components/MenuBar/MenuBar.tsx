import { useEffect, useRef, useState } from "react";
import logo from "@renderer/assets/logo.png";

interface MenuItem {
  label?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

interface MenuBarProps {
  onAddFolder: () => void;
  onToggleMeta: () => void;
  view: "grid" | "list";
  onSetView: (v: "grid" | "list") => void;
  onShowShortcuts: () => void;
  onOpenPublisherSettings: () => void;
  onFindDuplicates: () => void;
  dockMode?: boolean;
  onUndock?: () => void;
}

export default function MenuBar({
  onAddFolder,
  onToggleMeta,
  view,
  onSetView,
  onShowShortcuts,
  onOpenPublisherSettings,
  onFindDuplicates,
  dockMode = false,
  onUndock,
}: MenuBarProps): JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!window.api?.onWindowMaximized) return;
    window.api.windowIsMaximized().then(setMaximized);
    return window.api.onWindowMaximized(setMaximized);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent): void {
      if (barRef.current && !barRef.current.contains(e.target as Node))
        setOpenMenu(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Dock Mode: 메뉴 없이 브랜드 + 언독 + 닫기만 남긴 얇은 타이틀바. PlayerBar는 그대로
  // 마운트 상태를 유지하므로 재생이 끊기지 않는다(App.tsx에서 조건부로 감싸지 않음).
  if (dockMode) {
    return (
      <div className="menubar menubar--dock">
        <div className="menubar__brand">
          <img className="menubar__brand-logo" src={logo} alt="" />
          SoundLib
        </div>
        <div className="menubar__spacer" />
        <button
          className="menubar__undock"
          onClick={onUndock}
          title="창 모드로 되돌리기"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
          Undock
        </button>
        <div className="menubar__winctrls">
          <button
            className="menubar__winbtn menubar__winbtn--close"
            onClick={() => window.api?.windowClose()}
            title="Close"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              stroke="currentColor"
            >
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: "Add folder", action: onAddFolder },
      { separator: true },
      { label: "Save layout", disabled: true },
      { separator: true },
      { label: "Exit", action: () => window.api?.windowClose() },
    ],
    Edit: [
      { label: "Undo", disabled: true },
      { label: "Redo", disabled: true },
      { separator: true },
      { label: "Copy", disabled: true },
      { label: "Paste", disabled: true },
    ],
    Database: [
      { label: "Rescan library", action: onAddFolder },
      { label: "Find Duplicates…", action: onFindDuplicates },
      { label: "Database status", disabled: true },
    ],
    View: [
      {
        label: view === "grid" ? "Folder grid" : "Folder grid",
        action: () => onSetView("grid"),
      },
      {
        label: view === "list" ? "Sound list" : "Sound list",
        action: () => onSetView("list"),
      },
      { separator: true },
      { label: "Metadata panel", action: onToggleMeta },
    ],
    Window: [
      { label: "Minimize", action: () => window.api?.windowMinimize() },
      {
        label: maximized ? "Restore" : "Maximize",
        action: () => window.api?.windowToggleMaximize(),
      },
    ],
    User: [
      { label: "Preferences", disabled: true },
      { label: "Publisher settings", action: onOpenPublisherSettings },
      { label: "Settings", disabled: true },
    ],
    Help: [
      { label: "Keyboard shortcuts", action: onShowShortcuts },
      { separator: true },
      { label: "SoundLib info", disabled: true },
    ],
  };

  function handleItem(item: MenuItem): void {
    if (item.disabled || item.separator) return;
    item.action?.();
    setOpenMenu(null);
  }

  return (
    <div className="menubar" ref={barRef}>
      <div className="menubar__brand">
        <img className="menubar__brand-logo" src={logo} alt="" />
        SoundLib
      </div>

      <div className="menubar__menus">
        {Object.keys(menus).map((name) => (
          <div className="menubar__menu" key={name}>
            <button
              className={`menubar__menu-btn${openMenu === name ? " menubar__menu-btn--open" : ""}`}
              onClick={() => setOpenMenu(openMenu === name ? null : name)}
              onMouseEnter={() => openMenu && setOpenMenu(name)}
            >
              {name}
            </button>
            {openMenu === name && (
              <div className="menubar__dropdown">
                {menus[name].map((item, i) =>
                  item.separator ? (
                    <div className="menubar__sep" key={i} />
                  ) : (
                    <button
                      key={i}
                      className={`menubar__item${item.disabled ? " menubar__item--disabled" : ""}`}
                      onClick={() => handleItem(item)}
                    >
                      {item.label}
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="menubar__spacer" />

      <div className="menubar__winctrls">
        <button
          className="menubar__winbtn"
          onClick={() => window.api?.windowMinimize()}
          title="Minimize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="menubar__winbtn"
          onClick={() => window.api?.windowToggleMaximize()}
          title={maximized ? "Restore" : "Maximize"}
        >
          {maximized ? (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
            >
              <rect x="0.5" y="2.5" width="6" height="6" />
              <path d="M2.5 2.5V0.5H9.5V7.5H7.5" />
            </svg>
          ) : (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
            >
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          )}
        </button>
        <button
          className="menubar__winbtn menubar__winbtn--close"
          onClick={() => window.api?.windowClose()}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor">
            <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
