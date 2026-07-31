import { app, ipcMain, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";
import type { UpdateState } from "../shared/types";

// electron-updater는 CJS라 named import가 번들러에 따라 깨진다 — default에서 꺼내 쓴다.
const { autoUpdater } = electronUpdater;

// 앱을 켜둔 채로 며칠 쓰는 경우가 있어 시작 시 한 번만 보지 않고 주기적으로 다시 확인한다.
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// 시작 직후는 인덱싱/스캔으로 가장 바쁜 구간이라 업데이트 확인은 조금 미룬다.
const FIRST_CHECK_DELAY_MS = 10_000;

let lastState: UpdateState = { status: "none" };
let timer: NodeJS.Timeout | null = null;

function send(win: BrowserWindow, state: UpdateState): void {
  lastState = state;
  if (!win.isDestroyed()) win.webContents.send("update:state", state);
}

export function setupAutoUpdater(win: BrowserWindow): void {
  // 개발 중에는 확인할 릴리스도, 교체할 설치본도 없다.
  if (!app.isPackaged) return;

  // 다운로드는 자동으로 받되 설치는 사용자가 누를 때까지 미룬다 — 사운드를 듣고 있는
  // 도중에 앱이 제멋대로 재시작하면 안 된다.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () =>
    send(win, { status: "checking" }),
  );
  autoUpdater.on("update-not-available", () => send(win, { status: "none" }));
  autoUpdater.on("update-available", (info) =>
    send(win, { status: "available", version: info.version }),
  );
  autoUpdater.on("download-progress", (p) =>
    send(win, { status: "downloading", percent: Math.round(p.percent) }),
  );
  autoUpdater.on("update-downloaded", (info) =>
    send(win, { status: "ready", version: info.version }),
  );
  autoUpdater.on("error", (err) => {
    // 네트워크가 없거나 릴리스가 아직 없을 때도 여기로 온다 — 앱 사용을 막을 이유는 없다.
    console.error("업데이트 확인 실패:", err?.message ?? String(err));
    send(win, { status: "error", message: err?.message ?? String(err) });
  });

  const check = (): void => {
    void autoUpdater.checkForUpdates().catch(() => {
      /* error 이벤트에서 이미 처리 */
    });
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS);
  timer = setInterval(check, RECHECK_INTERVAL_MS);
  win.on("closed", () => {
    if (timer) clearInterval(timer);
    timer = null;
  });
}

export function registerUpdaterIpc(): void {
  // 렌더러가 나중에 붙어도(새로고침 등) 현재 상태를 알 수 있게 한다.
  ipcMain.handle("update:getState", () => lastState);

  ipcMain.handle("update:check", () => {
    if (!app.isPackaged) return { status: "none" } as UpdateState;
    void autoUpdater.checkForUpdates().catch(() => {});
    return lastState;
  });

  // 다운로드가 끝난 뒤에만 의미가 있다. perMachine 설치본이라 여기서 UAC 창이 뜬다.
  ipcMain.on("update:install", () => {
    if (lastState.status !== "ready") return;
    autoUpdater.quitAndInstall();
  });
}
