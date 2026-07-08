import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { rm } from 'fs/promises'
import { registerIpcHandlers } from './ipc'
import { closeDb, initDb } from './db'
import { getAllLibraries } from './db/queries'
import { startWatching, stopAllWatching } from './watcher'

// 클릭→IPC 파일읽기→디코딩 사이 비동기 대기로 사용자 제스처가 만료되어
// Chromium 자동재생 정책이 재생을 막는 문제 해결
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// data: URL로 띄우는 최소 스플래시 창 — 별도 빌드 산출물 없이 메인 프로세스
// 번들 안에만 존재해서, DB 로딩 등 무거운 초기화 작업 중에도 항상 즉시 뜬다.
const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body { margin: 0; height: 100%; background: transparent; }
  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; -webkit-app-region: drag;
    background: #0e0f11; color: #e7e9ea;
    font-family: -apple-system, "Segoe UI", sans-serif;
    border: 1px solid #2a2c30; border-radius: 10px; overflow: hidden;
    box-sizing: border-box;
  }
  .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
  .brand-dot { width: 10px; height: 10px; border-radius: 50%; background: #a3e3c1; }
  .brand-name { font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
  .spinner {
    width: 26px; height: 26px; border-radius: 50%;
    border: 2.5px solid rgba(163, 227, 193, 0.25); border-top-color: #a3e3c1;
    animation: spin 0.8s linear infinite; margin-bottom: 14px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loading { font-size: 12px; color: #8a8f94; letter-spacing: 0.04em; text-transform: uppercase; margin-bottom: 6px; }
  .status { font-size: 12.5px; color: #c7cacd; min-height: 16px; text-align: center; padding: 0 24px; }
  .error { display: none; flex-direction: column; align-items: center; padding: 0 24px; }
  .error.show { display: flex; }
  .error-msg {
    font-size: 12px; color: #e29a9a; white-space: pre-wrap; text-align: center;
    max-height: 90px; overflow-y: auto; margin-bottom: 14px;
  }
  .quit-btn {
    -webkit-app-region: no-drag;
    background: #2a2c30; color: #e7e9ea; border: 1px solid #3a3d42; border-radius: 6px;
    font-size: 12px; padding: 6px 16px; cursor: pointer;
  }
  .quit-btn:hover { background: #34373c; }
  .normal { display: flex; flex-direction: column; align-items: center; }
</style>
</head>
<body>
  <div class="brand"><span class="brand-dot"></span><span class="brand-name">SoundLib</span></div>
  <div class="normal" id="normal">
    <div class="spinner"></div>
    <div class="loading">Loading...</div>
    <div class="status" id="status">Starting up...</div>
  </div>
  <div class="error" id="error">
    <div class="error-msg" id="errorMsg"></div>
    <button class="quit-btn" onclick="window.close()">Quit</button>
  </div>
  <script>
    window.__setStatus = function (text) {
      var el = document.getElementById('status')
      if (el) el.textContent = text
    }
    window.__setError = function (message) {
      document.getElementById('normal').style.display = 'none'
      document.getElementById('error').classList.add('show')
      var el = document.getElementById('errorMsg')
      if (el) el.textContent = message
    }
  </script>
</body>
</html>`

let splashWindow: BrowserWindow | null = null
let mainWindowRef: BrowserWindow | null = null

async function createSplashWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 380,
    height: 220,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true }
  })
  const shown = new Promise<void>((resolve) => {
    win.once('ready-to-show', () => {
      win.show()
      resolve()
    })
  })
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)
  await shown
  return win
}

function setSplashStatus(text: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.__setStatus && window.__setStatus(${JSON.stringify(text)})`)
    .catch(() => {})
}

function setSplashError(message: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  splashWindow.webContents
    .executeJavaScript(`window.__setError && window.__setError(${JSON.stringify(message)})`)
    .catch(() => {})
}

function closeSplash(): void {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    frame: false,
    backgroundColor: '#0e0f11',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // electron-vite dev에서는 렌더러가 http://localhost 오리진으로 뜨는데, 그 상태에서
      // file:// 오디오(webPreviewURL)를 재생하려 하면 크로미움이 "Not allowed to load
      // local resource"로 막는다. 패키징된 빌드는 렌더러도 file:// 오리진이라 문제가 없으므로
      // 이 완화는 개발 모드(ELECTRON_RENDERER_URL이 설정된 경우)에서만 적용한다.
      webSecurity: !process.env.ELECTRON_RENDERER_URL
    }
  })

  // 커스텀 타이틀바 최대화 상태 동기화
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  registerIpcHandlers(mainWindow)

  // 앱 시작 시 "Monitor for changes"가 켜져 있던 라이브러리는 감시 재개
  for (const lib of getAllLibraries()) {
    if (lib.monitor) startWatching(lib.id, lib.rootPath, mainWindow)
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// 중복 실행 방지 — 두 인스턴스가 동시에 DB 파일을 덮어써 손상되는 것을 막음
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindowRef
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    splashWindow = await createSplashWindow()

    try {
      setSplashStatus('Loading metadata cache...')
      await initDb()
    } catch (err) {
      // 시작 실패(예: 패키지에 네이티브 리소스 누락)를 조용히 삼키지 않고 스플래시에 표시.
      // 창이 아예 안 뜨는 대신 원인을 바로 보여주고, 앱은 멈추지 않고 Quit으로 종료 가능.
      setSplashError(
        `데이터베이스 초기화에 실패했습니다.\n\n${(err as Error)?.stack ?? String(err)}`
      )
      return
    }

    setSplashStatus('Loading sound library...')

    let mainWindow: BrowserWindow
    try {
      mainWindow = createWindow()
    } catch (err) {
      setSplashError(`메인 창을 여는 데 실패했습니다.\n\n${(err as Error)?.stack ?? String(err)}`)
      return
    }
    mainWindowRef = mainWindow

    let contentReady = false
    let rendererReady = false
    function tryReveal(): void {
      if (!contentReady || !rendererReady) return
      if (!mainWindow.isDestroyed()) mainWindow.show()
      closeSplash()
    }

    mainWindow.once('ready-to-show', () => {
      contentReady = true
      tryReveal()
    })

    // 렌더러가 초기 라이브러리/트랙 로드를 마치면 신호를 보내온다 — 그 전에 창을 보여주면
    // 빈 리스트가 잠깐 보였다가 채워지는 "멈춘 것 같은" 느낌을 준다.
    ipcMain.once('app:renderer-ready', () => {
      rendererReady = true
      tryReveal()
    })

    // 안전장치: 렌더러가 어떤 이유로든 준비 신호를 못 보내는 경우(예외 등) 무한정
    // 스플래시에 갇히지 않도록 일정 시간 후에는 그냥 보여준다.
    setTimeout(() => {
      rendererReady = true
      tryReveal()
    }, 10000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindowRef = createWindow()
        mainWindowRef.once('ready-to-show', () => mainWindowRef?.show())
      }
    })
  })

  app.on('window-all-closed', () => {
    stopAllWatching()
    closeDb()
    // Waveform 구간 드래그로 만든 임시 오디오 파일 정리 (실패해도 무시)
    void rm(join(app.getPath('temp'), 'soundlib-dragexports'), { recursive: true, force: true }).catch(() => {})
    if (process.platform !== 'darwin') app.quit()
  })
}
