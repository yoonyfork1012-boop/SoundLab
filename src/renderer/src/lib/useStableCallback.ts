import { useCallback, useEffect, useRef } from "react";

// App.tsx의 이벤트 핸들러들(handleSelectTrack, handleToggleStar 등)은 매 렌더마다 새
// 함수로 재생성돼, ResultList/Sidebar/PlayerBar가 memo()로 얕은 비교를 해도 항상
// "props가 바뀌었다"고 판정되어 리렌더 방지가 무력화된다. 이 훅은 최신 로직은 ref로
// 따라가면서도 반환하는 함수 자체의 참조는 마운트 동안 절대 바뀌지 않게 해, 수동으로
// 의존성 배열을 나열하지 않고도(그리고 그로 인한 stale closure 위험 없이) 안정된
// 콜백 identity를 준다.
export function useStableCallback<Args extends unknown[], R>(
  fn: (...args: Args) => R,
): (...args: Args) => R {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
