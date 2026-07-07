# SoundLib

[Soundly](https://www.getsoundly.com/)를 벤치마킹한 1인용 로컬 사운드 라이브러리 데스크탑 앱입니다.
클라우드/계정/구독 없이 완전히 오프라인으로 동작하며, 폴더를 스캔해 SQLite로 인덱싱하고
가상 스크롤 리스트 + 웨이브폼 프리뷰로 사운드를 탐색·관리합니다.

## 스택

- Electron + React + TypeScript
- SQLite (sql.js, 인메모리 WASM DB)
- 빌드: electron-vite
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
npm run pack:win    # 위 빌드 + Windows 포터블 exe 패키징 (release/)
```

## 현재 상태

Phase 1 진행 중 — 폴더 스캔 → SQLite 인덱싱 → 리스트뷰 → 클릭 재생 + 웨이브폼.
