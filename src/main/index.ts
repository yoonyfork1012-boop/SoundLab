import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { rm } from "fs/promises";
import { readFileSync } from "fs";
import { registerIpcHandlers, runStartupReconcile } from "./ipc";
import { closeDb, flushPersist, initDb } from "./db";
import { getAllLibraries } from "./db/queries";
import { startWatching, stopAllWatching } from "./watcher";
import {
  registerUpdaterIpc,
  setupAutoUpdater,
  startUpdateChecks,
} from "./updater";
import { backfillEmbeddings } from "./embedder";

// 클릭→IPC 파일읽기→디코딩 사이 비동기 대기로 사용자 제스처가 만료되어
// Chromium 자동재생 정책이 재생을 막는 문제 해결
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

// 패키징 전에는 프로젝트 루트의 build/icon.png, 패키징 후에는 electron-builder의
// extraResources로 복사된 resources/icon.png를 사용 — 두 경우 모두 out/main 기준 상대경로가 달라짐
const ICON_PATH = app.isPackaged
  ? join(process.resourcesPath, "icon.png")
  : join(__dirname, "../../build/icon.png");

// 창 아이콘. Windows에서는 여러 크기 프레임이 든 ico를 쓴다 — 1024px PNG 하나로는 작업
// 표시줄용 작은 아이콘이 제대로 만들어지지 않아 빈 아이콘으로 보였다.
const WINDOW_ICON_PATH =
  process.platform === "win32"
    ? app.isPackaged
      ? join(process.resourcesPath, "icon.ico")
      : join(__dirname, "../../build/icon.ico")
    : ICON_PATH;

const ICON_DATA_URL = (() => {
  try {
    return `data:image/png;base64,${readFileSync(ICON_PATH).toString("base64")}`;
  } catch {
    return "";
  }
})();

// data: URL로 띄우는 최소 스플래시 창 — 별도 빌드 산출물 없이 메인 프로세스
// 번들 안에만 존재해서, DB 로딩 등 무거운 초기화 작업 중에도 항상 즉시 뜬다.
// 스피너·"Loading" 문구 없이 브랜드만 보여준다. 배경의 파동선은 로고 컨셉(울림의 파동)을
// 옅게 흘려 멈춘 화면처럼 보이지 않게 하는 장식이다.
const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  body {
    position: relative; display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; -webkit-app-region: drag; overflow: hidden;
    box-sizing: border-box; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.14);
    background:
      radial-gradient(70% 60% at 50% 38%, rgba(99, 102, 241, 0.28), transparent 70%),
      radial-gradient(50% 40% at 64% 30%, rgba(34, 211, 238, 0.14), transparent 70%),
      #0B0F1A;
    color: #F8FAFC; font-family: "Segoe UI Variable Display", "Segoe UI", sans-serif;
  }
  .waves { position: absolute; inset: auto -40% -6% -40%; height: 60%; opacity: 0.5; }
  .waves path { fill: none; stroke-width: 1; animation: drift 9s ease-in-out infinite alternate; }
  .waves path:nth-child(2) { animation-duration: 12s; }
  .waves path:nth-child(3) { animation-duration: 15s; }
  @keyframes drift { from { transform: translateX(-6%); } to { transform: translateX(6%); } }
  .center { position: relative; display: flex; flex-direction: column; align-items: center;
    animation: rise 0.7s cubic-bezier(.2,.7,.2,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(6px); } }
  .logo { width: 64px; height: 64px; display: block; margin-bottom: 18px;
    filter: drop-shadow(0 10px 28px rgba(99, 102, 241, 0.45)); }
  .word { font-size: 26px; font-weight: 600; letter-spacing: 0.42em; margin-right: -0.42em; }
  .tag { margin-top: 8px; font-size: 9.5px; letter-spacing: 0.36em; margin-right: -0.36em; color: #94A3B8; }
  .ver { position: absolute; bottom: 14px; font-size: 10px; letter-spacing: 0.08em; color: rgba(148, 163, 184, 0.6); }
  .error { display: none; flex-direction: column; align-items: center; padding: 0 28px; margin-top: 18px; }
  .error.show { display: flex; }
  .error-msg {
    font-size: 11.5px; color: #FCA5A5; white-space: pre-wrap; text-align: center;
    max-height: 70px; overflow-y: auto; margin-bottom: 12px;
  }
  .quit-btn {
    -webkit-app-region: no-drag;
    background: rgba(148, 163, 184, 0.12); color: #F8FAFC; border: 1px solid rgba(148, 163, 184, 0.25);
    border-radius: 6px; font-size: 12px; padding: 6px 16px; cursor: pointer;
  }
  .quit-btn:hover { background: rgba(148, 163, 184, 0.2); }
</style>
</head>
<body>
  <svg class="waves" viewBox="0 0 800 200" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <linearGradient id="w" x1="0" x2="1">
        <stop offset="0" stop-color="#6366F1" stop-opacity="0" />
        <stop offset="0.5" stop-color="#6366F1" />
        <stop offset="1" stop-color="#22D3EE" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path stroke="url(#w)" d="M0 120 C 120 60 220 180 400 110 S 680 50 800 120" />
    <path stroke="url(#w)" opacity="0.7" d="M0 140 C 140 90 260 190 420 130 S 660 80 800 140" />
    <path stroke="url(#w)" opacity="0.45" d="M0 100 C 160 40 240 160 380 95 S 700 30 800 100" />
  </svg>
  <div class="center">
    ${ICON_DATA_URL ? `<img class="logo" src="${ICON_DATA_URL}" />` : ""}
    <div class="word">ULIM</div>
    <div class="tag">SOUND. TOGETHER.</div>
    <div class="error" id="error">
      <div class="error-msg" id="errorMsg"></div>
      <button class="quit-btn" onclick="window.close()">Quit</button>
    </div>
  </div>
  <div class="ver">v${app.getVersion()}</div>
  <script>
    window.__setError = function (message) {
      document.getElementById('error').classList.add('show')
      var el = document.getElementById('errorMsg')
      if (el) el.textContent = message
    }
  </script>
</body>
</html>`;

let splashWindow: BrowserWindow | null = null;
let mainWindowRef: BrowserWindow | null = null;
let isQuitting = false;
let startupComplete = false;

async function createSplashWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 440,
    height: 280,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    icon: WINDOW_ICON_PATH,
    webPreferences: { sandbox: true },
  });
  const shown = new Promise<void>((resolve) => {
    win.once("ready-to-show", () => {
      win.show();
      resolve();
    });
  });
  win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`,
  );
  await shown;
  return win;
}

function setSplashError(message: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents
    .executeJavaScript(
      `window.__setError && window.__setError(${JSON.stringify(message)})`,
    )
    .catch(() => {});
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: "#0e0f11",
    icon: WINDOW_ICON_PATH,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      // electron-vite dev에서는 렌더러가 http://localhost 오리진으로 뜨는데, 그 상태에서
      // file:// 오디오(webPreviewURL)를 재생하려 하면 크로미움이 "Not allowed to load
      // local resource"로 막는다. 패키징된 빌드는 렌더러도 file:// 오리진이라 문제가 없으므로
      // 이 완화는 개발 모드(ELECTRON_RENDERER_URL이 설정된 경우)에서만 적용한다.
      webSecurity: !process.env.ELECTRON_RENDERER_URL,
    },
  });

  // 커스텀 타이틀바 최대화 상태 동기화
  mainWindow.on("maximize", () =>
    mainWindow.webContents.send("window:maximized", true),
  );
  mainWindow.on("unmaximize", () =>
    mainWindow.webContents.send("window:maximized", false),
  );

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  registerIpcHandlers(mainWindow);

  // 앱 시작 시 "Monitor for changes"가 켜져 있던 라이브러리는 감시 재개
  for (const lib of getAllLibraries()) {
    startWatching(lib.id, lib.rootPath, mainWindow);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

// 중복 실행 방지 — 두 인스턴스가 동시에 DB 파일을 덮어써 손상되는 것을 막음
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    // 종료 중에 아이콘을 다시 누르면 여기로 들어오는데, 그때 mainWindowRef는 이미 파괴된
    // 창을 가리키고 있다(참조만 남는다). isDestroyed를 보지 않으면 그 창에 손대는 순간
    // "Object has been destroyed"가 메인 프로세스에서 잡히지 않은 예외로 터진다.
    const win = mainWindowRef ?? splashWindow;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.focus();
      return;
    }
    // 시작 중(창 생성 전)이거나 이미 종료 중이면 그대로 둔다 — 여기서 quit하면 정상 기동 중인
    // 앱을 꺼버린다. 기동을 마쳤는데 창이 하나도 없으면 창 없이 lock만 쥔 채 남은 상태라,
    // 재시작해서 사용자가 누른 실행이 실제로 창을 띄우게 한다.
    if (!startupComplete || isQuitting) return;
    app.relaunch();
    app.quit();
  });

  app.whenReady().then(async () => {
    splashWindow = await createSplashWindow();

    try {
      await initDb();
    } catch (err) {
      // 시작 실패(예: 패키지에 네이티브 리소스 누락)를 조용히 삼키지 않고 스플래시에 표시.
      // 창이 아예 안 뜨는 대신 원인을 바로 보여주고, 앱은 멈추지 않고 Quit으로 종료 가능.
      setSplashError(
        `데이터베이스 초기화에 실패했습니다.\n\n${(err as Error)?.stack ?? String(err)}`,
      );
      return;
    }

    let mainWindow: BrowserWindow;
    try {
      mainWindow = createWindow();
    } catch (err) {
      setSplashError(
        `메인 창을 여는 데 실패했습니다.\n\n${(err as Error)?.stack ?? String(err)}`,
      );
      return;
    }
    mainWindowRef = mainWindow;
    startupComplete = true;
    // 창이 닫히면 참조도 버린다. 남겨두면 second-instance/activate가 파괴된 창을 잡는다.
    mainWindow.on("closed", () => {
      if (mainWindowRef === mainWindow) mainWindowRef = null;
    });
    registerUpdaterIpc();
    setupAutoUpdater(mainWindow);

    let contentReady = false;
    let rendererReady = false;
    function tryReveal(): void {
      if (!contentReady || !rendererReady) return;
      if (!mainWindow.isDestroyed()) mainWindow.show();
      closeSplash();
    }

    mainWindow.once("ready-to-show", () => {
      contentReady = true;
      tryReveal();
    });

    // 렌더러가 초기 라이브러리/트랙 로드를 마치면 신호를 보내온다 — 그 전에 창을 보여주면
    // 빈 리스트가 잠깐 보였다가 채워지는 "멈춘 것 같은" 느낌을 준다.
    ipcMain.once("app:renderer-ready", () => {
      rendererReady = true;
      tryReveal();
      startUpdateChecks();
      // 앱이 꺼져 있는 동안 폴더에서 일어난 변경을 백그라운드로 따라잡는다. 창이 이미
      // 보인 뒤에 시작하므로 사용자는 기다리지 않고, 변경이 없으면 폴더 mtime 확인만
      // 하고 곧바로 끝난다(전체 재인덱싱이 아니다).
      setTimeout(() => {
        if (!mainWindow.isDestroyed())
          void runStartupReconcile(mainWindow, () => isQuitting);
      }, 1500);

      // 의미 검색용 임베딩을 백그라운드로 채운다. 스캔 따라잡기가 먼저 끝나도록 더
      // 늦게 시작하고, 중단돼도 다음 실행이 남은 것부터 이어서 한다.
      //
      // SOUNDLIB_SKIP_EMBED=1 로 끌 수 있다. 느려짐이 이 백필 탓인지 가려낼 때 쓴다 —
      // 껐다고 검색이 죽지는 않는다(키워드 검색은 무관, 의미 검색은 이미 채워진 범위에서
      // 계속 동작한다). 끄면 새로 추가된 트랙만 의미 검색에서 빠진다.
      setTimeout(() => {
        if (mainWindow.isDestroyed()) return;
        if (process.env.SOUNDLIB_SKIP_EMBED === "1") {
          console.log("SOUNDLIB_SKIP_EMBED=1 — 임베딩 백필을 건너뛴다");
          return;
        }
        void backfillEmbeddings(
          (p) => {
            if (!mainWindow.isDestroyed())
              mainWindow.webContents.send("embed:progress", p);
          },
          () => isQuitting || mainWindow.isDestroyed(),
        ).catch((err) => {
          // 임베딩이 실패해도 키워드 검색은 그대로 동작한다 — 앱을 막지 않는다.
          console.error("임베딩 생성 실패:", (err as Error)?.message);
        });
      }, 20000);
    });

    // 안전장치: 렌더러가 어떤 이유로든 준비 신호를 못 보내는 경우(예외 등) 무한정
    // 스플래시에 갇히지 않도록 일정 시간 후에는 그냥 보여준다. 이제 준비 신호가 전체 트랙
    // 로드(loadAll)+인덱싱 완료에 달려 있어, 수십만 트랙 라이브러리에서 이 로드가 수십 초까지
    // 걸릴 수 있으므로 조기 강제 노출(빈 화면)을 피하려고 넉넉히 둔다.
    setTimeout(() => {
      rendererReady = true;
      tryReveal();
      startUpdateChecks();
    }, 120000);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindowRef = createWindow();
        mainWindowRef.once("ready-to-show", () => mainWindowRef?.show());
      }
    });
  });

  // 창이 없는 경로로 종료되더라도(트레이/강제 quit 등) 디바운스 대기 중인 DB 저장을 기록한다
  app.on("before-quit", () => {
    isQuitting = true;
    flushPersist();
  });

  app.on("window-all-closed", () => {
    isQuitting = true;
    // 정리 중 하나라도 예외가 나면 app.quit()에 못 닿아 창 없는 프로세스가 single-instance
    // lock을 쥔 채 남고, 이후 실행이 전부 조용히 종료된다 — 정리는 실패해도 종료는 반드시 한다.
    try {
      stopAllWatching();
    } catch (err) {
      console.error("감시 중지 실패:", (err as Error)?.message);
    }
    closeDb();
    // Waveform 구간 드래그로 만든 임시 오디오 파일 정리 (실패해도 무시)
    void rm(join(app.getPath("temp"), "soundlib-dragexports"), {
      recursive: true,
      force: true,
    }).catch(() => {});
    if (process.platform !== "darwin") app.quit();
  });
}
