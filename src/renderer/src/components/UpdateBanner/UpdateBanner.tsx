import { useEffect, useState } from "react";
import type { UpdateState } from "@shared/types";

// 업데이트 알림은 Toast와 달리 스스로 사라지면 안 된다 — 사용자가 "지금 업데이트"를 누르거나
// 닫기 전까지 화면 상단에 남는 별도 배너로 둔다.
export default function UpdateBanner(): JSX.Element | null {
  const [state, setState] = useState<UpdateState>({ status: "none" });
  const [dismissed, setDismissed] = useState(false);
  // 사용자가 다운로드를 시작했는가. 그 뒤의 실패만 배너로 알린다 — 자동 확인 실패(네트워크
  // 없음 등)까지 띄우면 사운드 작업 중에 방해만 된다.
  const [requested, setRequested] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!window.api) return;
    const apply = (next: UpdateState): void => {
      setState(next);
      if (next.status === "available" || next.status === "ready")
        setVersion(next.version);
    };
    void window.api.getUpdateState().then(apply);
    return window.api.onUpdateState((next) => {
      apply(next);
      setDismissed(false); // 상태가 바뀌면 다시 보여준다
    });
  }, []);

  function startUpdate(): void {
    setRequested(true);
    window.api?.downloadUpdate();
  }

  if (dismissed) return null;
  const failed = state.status === "error" && requested;
  if (
    state.status === "none" ||
    state.status === "checking" ||
    (state.status === "error" && !failed)
  )
    return null;

  const label = version ? `v${version}` : "새 버전";

  return (
    <div className="update-banner" role="status">
      {state.status === "available" && (
        <>
          <span>새 버전 {label} 을(를) 사용할 수 있습니다</span>
          <button
            type="button"
            className="update-banner__install"
            onClick={startUpdate}
          >
            지금 업데이트
          </button>
        </>
      )}
      {state.status === "downloading" && (
        <>
          <span>
            {label} 내려받는 중… {state.percent}%
          </span>
          <span className="update-banner__progress" aria-hidden="true">
            <span style={{ width: `${state.percent}%` }} />
          </span>
          <span className="update-banner__hint">
            완료되면 자동으로 재시작해 설치합니다
          </span>
        </>
      )}
      {state.status === "ready" && (
        <>
          <span>새 버전 {label} 준비 완료</span>
          <button
            type="button"
            className="update-banner__install"
            onClick={() => window.api?.installUpdate()}
          >
            재시작하고 설치
          </button>
        </>
      )}
      {failed && (
        <>
          <span>업데이트를 받지 못했습니다: {state.message}</span>
          <button
            type="button"
            className="update-banner__install"
            onClick={startUpdate}
          >
            다시 시도
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
