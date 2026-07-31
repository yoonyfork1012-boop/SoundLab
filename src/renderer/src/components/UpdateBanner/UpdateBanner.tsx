import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";

// 업데이트 알림은 Toast와 달리 스스로 사라지면 안 된다 — "재시작하고 설치" 버튼을
// 눌러야 끝나는 작업이라, 사용자가 닫기 전까지 남는 별도 배너로 둔다.
export default function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: "none" });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!window.api) return;
    void window.api.getUpdateState().then(setState);
    return window.api.onUpdateState((next) => {
      setState(next);
      setDismissed(false); // 상태가 바뀌면 다시 보여준다
    });
  }, []);

  if (dismissed) return null;
  // 확인 중/최신/실패는 알릴 게 없다. 실패는 콘솔에만 남긴다 — 네트워크가 없다고
  // 사운드 작업 중에 배너가 뜨면 방해만 된다.
  if (
    state.status === "none" ||
    state.status === "checking" ||
    state.status === "error"
  )
    return null;

  return (
    <div className="update-banner">
      {state.status === "available" && (
        <span>새 버전 {state.version} 을(를) 받는 중…</span>
      )}
      {state.status === "downloading" && (
        <span>새 버전 내려받는 중… {state.percent}%</span>
      )}
      {state.status === "ready" && (
        <>
          <span>새 버전 {state.version} 준비 완료</span>
          <button
            type="button"
            className="update-banner__install"
            onClick={() => window.api?.installUpdate()}
          >
            재시작하고 설치
          </button>
        </>
      )}
      <button
        type="button"
        className="update-banner__close"
        onClick={() => setDismissed(true)}
        aria-label="알림 닫기"
      >
        ×
      </button>
    </div>
  );
}
