import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";

interface AboutModalProps {
  onClose: () => void;
}

// 업데이트 상태를 사람이 읽는 한 줄로. 배너는 "받는 중/설치" 같은 행동만 보여주지만,
// 이 창은 "지금 확인했고 결과가 이렇다"까지 알려야 해서 checking/none도 문구로 남긴다.
function describe(state: UpdateState): string {
  switch (state.status) {
    case "checking":
      return "확인 중…";
    case "available":
      return `새 버전 ${state.version} — 내려받는 중…`;
    case "downloading":
      return `새 버전 내려받는 중… ${state.percent}%`;
    case "ready":
      return `새 버전 ${state.version} 준비 완료`;
    case "error":
      return `확인 실패: ${state.message}`;
    default:
      return "최신 버전입니다";
  }
}

export default function AboutModal({ onClose }: AboutModalProps): JSX.Element {
  const [version, setVersion] = useState<string>("");
  const [state, setState] = useState<UpdateState>({ status: "none" });
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    function onEsc(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", onEsc, true);
    return () => document.removeEventListener("keydown", onEsc, true);
  }, [onClose]);

  useEffect(() => {
    if (!window.api) return;
    void window.api.getAppVersion().then(setVersion);
    void window.api.getUpdateState().then(setState);
    // 창을 열어둔 동안 백그라운드 다운로드가 진행되면 그대로 따라 움직인다.
    return window.api.onUpdateState(setState);
  }, []);

  async function handleCheck(): Promise<void> {
    if (!window.api) return;
    setState({ status: "checking" });
    setChecked(true);
    setState(await window.api.checkForUpdate());
  }

  const busy = state.status === "checking";

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal__title">SoundLib 정보</div>
        <div className="about">
          <div className="about__row">
            <span className="about__label">버전</span>
            <span className="about__value">{version || "—"}</span>
          </div>
          <div className="about__row">
            <span className="about__label">업데이트</span>
            <span className="about__value">
              {checked || state.status !== "none"
                ? describe(state)
                : "확인한 적 없음"}
            </span>
          </div>
        </div>
        <div className="modal__desc">
          업데이트는 앱을 켤 때와 6시간마다 자동으로 확인합니다. 새 버전을 다
          받으면 상단 배너의 &quot;재시작하고 설치&quot;로 적용됩니다.
        </div>
        <div className="modal__actions">
          {state.status === "ready" ? (
            <button
              className="modal__btn modal__btn--primary"
              onClick={() => window.api?.installUpdate()}
            >
              재시작하고 설치
            </button>
          ) : (
            <button
              className="modal__btn"
              onClick={() => void handleCheck()}
              disabled={busy}
            >
              {busy ? "확인 중…" : "지금 업데이트 확인"}
            </button>
          )}
          <button className="modal__btn modal__btn--primary" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
