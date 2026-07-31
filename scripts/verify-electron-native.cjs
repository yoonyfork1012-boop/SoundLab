// better-sqlite3는 네이티브 모듈이라 "vitest 통과"가 "앱에서 동작"을 보장하지 않는다.
// vitest는 시스템 Node에서 도는데, Electron은 자기 Node를 들고 있어 N-API 버전이 다르면
// new Database()에서 JS로 잡히지도 않는 네이티브 크래시(exit 127)가 난다. 실제로 그렇게
// 깨진 빌드를 낸 적이 있어(9ed4975), 패키징 전에 Electron 런타임에서 한 번 열어본다.
const { spawnSync } = require("node:child_process");
const electronPath = require("electron");

const probe = `
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.exec("CREATE TABLE probe (value TEXT)");
  db.prepare("INSERT INTO probe VALUES (?)").run("ok");
  const value = db.prepare("SELECT value FROM probe").pluck().get();
  db.close();
  if (value !== "ok") process.exit(2);
`;

const result = spawnSync(electronPath, ["-e", probe], {
  // GUI를 띄우지 않고 Electron을 순수 Node 런타임으로 돌린다.
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Electron 런타임에서 better-sqlite3 로드 실패 (exit ${result.status}) — ` +
      "electron/better-sqlite3 버전 조합의 N-API 호환성을 확인하세요.",
  );
}
console.log("better-sqlite3 OK (Electron 런타임)");
