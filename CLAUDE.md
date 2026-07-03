이 프로젝트는 Soundly(getsoundly.com)를 벤치마킹한 1인용 로컬 사운드 라이브러리
데스크탑 앱입니다. 클라우드/계정/구독 기능은 절대 추가하지 마세요.

- 스택: Electron + React + TypeScript + SQLite(better-sqlite3), 빌드는 electron-vite
- UI는 PROJECT_SPEC.md의 3단 레이아웃(좌측 사이드바/중앙 리스트/우측 메타데이터,
  하단 플레이어)을 그대로 따릅니다.
- 다크 테마 기본, 카테고리별 색상 매핑 사용.
- Phase 1부터 순서대로 구현하고, 각 Phase 완료 시 동작 가능한 상태로 커밋하세요.
- 대용량 폴더(수천 개 파일) 스캔을 고려해 리스트는 반드시 가상 스크롤(react-window) 사용.
- 아트워크는 임베디드 추출 우선, 없으면 백그라운드에서 웨이브폼 스냅샷 자동 생성
  (PROJECT_SPEC.md 4번 항목 참조).
- DAW 드래그아웃은 Cubase 대상으로 먼저 기술 검증부터 진행하고, 안 되면 대안
  (예: 임시 폴더로 내보내기 + 탐색기에서 드래그) 제시.

## 현재 상태

- Phase 1 진행 중: 폴더 스캔 → SQLite 인덱싱 → 리스트뷰 → 클릭 재생 + 웨이브폼

## 폴더 구조

```
src/
├── main/         # Electron main process (db, scanner, ipc)
├── preload/      # contextBridge API
├── renderer/     # React UI
└── shared/       # 공통 타입, 상수 (UCS 카테고리 등)
```
