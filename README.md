# SoundLab

[Soundly](https://www.getsoundly.com/)를 벤치마킹한 1인용 로컬 사운드 라이브러리 데스크탑 앱입니다.
클라우드/계정/구독 없이 완전히 오프라인으로 동작하며, 폴더를 스캔해 SQLite로 인덱싱하고
가상 스크롤 리스트 + 웨이브폼 프리뷰로 사운드를 탐색·관리합니다.

## 스택

- Electron + React + TypeScript
- SQLite (better-sqlite3, 파일 기반 네이티브 DB + WAL)
- 빌드: electron-vite / 패키징: electron-builder (NSIS)
- 자동 업데이트: electron-updater (GitHub Releases)
- 리스트 가상 스크롤: react-window

## 폴더 구조

```
src/
├── main/         # Electron main process (db, scanner, ipc, watcher)
├── preload/      # contextBridge API
├── renderer/     # React UI
└── shared/       # 공통 타입, 카테고리(UCS) 등
```

자세한 기획/스펙은 [`PROJECT_SPEC.md`](./PROJECT_SPEC.md), 작업 가이드는
[`CLAUDE.md`](./CLAUDE.md)를 참고하세요.

## 개발

```bash
npm install
npm run dev        # electron-vite dev (핫리로드)
```

## 빌드

```bash
npm run build       # electron-vite build (out/ 산출물)
npm run pack:win    # 위 빌드 + Windows 설치본/포터블 패키징 (release/, 업로드 안 함)
```

`pack:win`은 패키징 전에 `verify:electron-native`를 돌려 Electron 런타임에서
better-sqlite3가 실제로 열리는지 확인합니다. vitest는 시스템 Node에서 돌기 때문에
N-API 불일치를 잡지 못해, 예전에 실행조차 안 되는 설치본을 낸 적이 있습니다.

## 릴리스 & 자동 업데이트

설치본은 켜질 때(그리고 6시간마다) GitHub Releases에서 새 버전을 확인하고,
있으면 백그라운드로 내려받은 뒤 화면 하단에 "재시작하고 설치" 배너를 띄웁니다.
재생 중에 앱이 제멋대로 재시작하지 않도록, 설치는 버튼을 눌러야 진행됩니다.

새 버전을 내보내려면:

```bash
npm version <patch|minor|major> --no-git-tag-version   # package.json 버전 올리기
export GH_TOKEN=$(gh auth token)                        # PowerShell: $env:GH_TOKEN = gh auth token
npm run release:win                                     # 빌드 + GitHub Release 업로드
```

- 버전을 올리지 않으면 기존 설치본이 업데이트를 인지하지 못합니다.
- 릴리스에는 `setup.exe`와 함께 **`latest.yml`이 반드시 포함**되어야 합니다.
  electron-updater가 이 파일로 버전을 판별합니다(`releaseType: release` 설정으로
  초안이 아닌 정식 릴리스로 올라갑니다 — 초안은 업데이터가 보지 못합니다).
- 저장소가 public이라 앱에 토큰을 넣지 않아도 업데이트 조회가 됩니다.
  private으로 되돌리면 자동 업데이트가 끊기고, 앱에 토큰을 내장해야 합니다.
- 설치 경로가 Program Files(`perMachine: true`)라 설치 단계에서 UAC 창이 뜹니다.

## 현재 상태

Phase 1 진행 중 — 폴더 스캔 → SQLite 인덱싱 → 리스트뷰 → 클릭 재생 + 웨이브폼.
