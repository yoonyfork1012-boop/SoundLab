import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { closeDb, initDb } from './db'

// 클릭→IPC 파일읽기→디코딩 사이 비동기 대기로 사용자 제스처가 만료되어
// Chromium 자동재생 정책이 재생을 막는 문제 해결
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

function createWindow(): void {
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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 커스텀 타이틀바 최대화 상태 동기화
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximized', false))

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  registerIpcHandlers(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// 중복 실행 방지 — 두 인스턴스가 동시에 DB 파일을 덮어써 손상되는 것을 막음
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    await initDb()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    closeDb()
    if (process.platform !== 'darwin') app.quit()
  })
}
