// sql.js는 단일 동기 커넥션이고 중첩 트랜잭션을 지원하지 않는다. 그런데 스캔(scanLibrary)은
// BEGIN 상태로 파일마다 await(stat/parseFile/hash)를 수없이 넘기며 트랜잭션을 오래 열어둔다.
// 그 await 틈에 다른 트랜잭션 쓰기(다른 스캔, 폴더 제거/이름변경)가 시작되면, 그쪽의 중첩
// BEGIN이 실패하고 그 catch의 ROLLBACK이 스캔의 트랜잭션까지 닫아버려 스캔의 COMMIT이
// "cannot commit - no transaction is active"로 터진다.
//
// 이 큐는 동시에 "인덱싱 작업 큐" 역할도 한다 — 자동 감시(watcher)의 개별 파일 인덱싱과
// 수동 스캔이 모두 이 큐를 지나므로, 둘이 동시에 돌더라도 같은 파일을 겹쳐 처리하지 않는다.
//
// 개별 db.run()은 (sql.js가 동기라) 그 자체로는 원자적이므로, 트랜잭션을 여는 쓰기 작업들끼리
// "겹치지만 않으면" 이 문제는 사라진다. 이 큐는 그런 작업들을 제출 순서대로 하나씩만 실행되게
// 직렬화한다. 앞 작업이 실패(throw)해도 큐는 막히지 않고 다음 작업으로 넘어간다.
let tail: Promise<unknown> = Promise.resolve();

export function runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = tail.then(() => fn());
  // 다음 작업이 이 작업의 성공/실패와 무관하게 이어지도록, 체인 꼬리는 결과를 삼킨 프라미스로 둔다.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
