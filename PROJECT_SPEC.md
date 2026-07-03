# SoundLib — 개인용 사운드 라이브러리 데스크탑 앱

Soundly(getsoundly.com)를 벤치마킹한 1인 사용 전용 데스크탑 앱 기획서.
클라우드/구독/공유 기능 전부 제외, 로컬 전용.

---

## 1. 프로젝트 목표

- Soundly의 로컬 라이브러리 관리 워크플로우를 동일하게 재현
- 클라우드, 계정, 스토어, 공유 네트워크 DB 등 서버 의존 기능은 전부 제외
- 완전 오프라인 동작
- Cubase 등 DAW로 드래그&드롭 익스포트가 핵심 워크플로우

---

## 2. 기능 범위

### Tier A — 필수 (MVP)

| 기능 | 설명 |
|---|---|
| 라이브러리 인덱싱 | 로컬 폴더 스캔, WAV/AIFF/MP3/M4A/OGG/FLAC 지원, 하위폴더 재귀 스캔 |
| 메타데이터 패널 | UCS 카테고리/서브카테고리, 태그, 설명, 아트워크 표시·편집 |
| 검색/필터 | 파일명·태그·카테고리 키워드 검색, 필터바 |
| 웨이브폼 프리뷰 | 클릭 재생, 구간 선택 재생, 줌 인/아웃 |
| 컬렉션/플레이리스트 | 드래그로 모으기, 이름 지정 |
| 즐겨찾기(Starred) | 단축키 F로 토글 |
| 멀티채널 지원 | 채널 솔로/뮤트 |
| **앨범 커버 자동 등록** | 아래 4번 항목 참조 |

### Tier B — 중요 (2차)

| 기능 | 설명 |
|---|---|
| DAW 드래그아웃 | Cubase로 파일/구간 드래그하여 트랙에 배치 |
| 이펙트 프리뷰 | 피치/스피드/리버스 실시간 프리뷰, 드래그 시 렌더링 반영 |
| Dock Mode | 화면 하단에 눕혀서 배치하는 컴팩트 레이아웃 |
| 단축키 체계 | Soundly 원본과 동일한 스페이스/R,T/CMD+R 등 |
| 스펙트로그램 뷰 | 웨이브폼 대신 주파수 뷰 전환 |

### Tier C — 선택 (여유될 때)

| 기능 | 설명 |
|---|---|
| Find Similar | 로컬 오디오 임베딩 기반 유사 사운드 검색 |
| 자연어 검색 | "폭발음, 멀리서" 같은 문장형 검색 |

### 제외 (Soundly 원본에는 있으나 미구현)

클라우드 라이브러리, 계정/구독, Store/애드온, 공유 네트워크 DB, Voice Designer, Place it(공간 임팩터), Shape it(EQ 플러그인) — 필요시 향후 별도 프로젝트로 분리.

---

## 3. UI/UX 레이아웃 (Soundly 원본 구조 그대로)

```
┌─────────────────────────────────────────────────────────┐
│ [검색창]                    [필터] [Dock] [설정]         │  상단바 44px
├───────────┬─────────────────────────────┬───────────────┤
│ Sounds     │  Name  Dur  Category  SR/Bit │  메타데이터    │
│ Store      │  ─────────────────────────── │  카테고리      │
│ Settings   │  jackpot_mega_hit.wav ...    │  서브카테고리   │
│           │  reel_nudge_short.wav ...     │  스펙          │
│ ▸ Local    │  ui_button_tap.wav ...        │  태그(칩)      │
│  Foley     │  multipot_appear.wav ...      │  아트워크      │
│  UI/Icon   │                               │               │
│ ▸ Collect. │                               │               │
│  Starred   │                               │               │
├───────────┴─────────────────────────────┴───────────────┤
│ [◀◀][▶][↩]     ～～웨이브폼～～         Pitch [──●──]     │  하단 플레이어 90px
│                                          Vol   [───●─]    │
└─────────────────────────────────────────────────────────┘
```

- 좌측 사이드바: 190px, 라이브러리 트리 + 컬렉션
- 중앙: 가변폭, 가상 스크롤 리스트 (몇천 개 항목 대응)
- 우측 메타데이터 패널: 220px, 토글 가능
- 하단 플레이어: 고정 90px, 트랜스포트 + 웨이브폼 + 피치/볼륨 슬라이더
- 다크 테마 기본, 단일 accent 컬러로 선택 상태 표시
- 카테고리별 색상 매핑 (잭팟=amber, UI=blue, 릴스핀=teal 등) — 리스트 아이콘과 자동생성 아트워크에 공통 사용

---

## 4. 앨범 커버(아트워크) 자동 등록 설계

Soundly의 "메타데이터 패널에서 아트워크 확인" 기능을 SFX 라이브러리에 맞게 재해석.

### 4.1 우선순위 로직

```
1순위: 파일에 임베디드 아트워크가 있으면 추출해서 사용
       - MP3/M4A: ID3v2 APIC 프레임
       - FLAC: METADATA_BLOCK_PICTURE
       - WAV: RIFF 'ID3 ' 청크 내 APIC (있는 경우만, 흔치 않음)
2순위: 사용자가 수동으로 이미지 지정
3순위: 자동 생성 — 웨이브폼 스냅샷을 카테고리 색상으로 렌더링한 썸네일
```

### 4.2 자동 생성 아트워크 스펙

- 스캔/임포트 시점에 백그라운드에서 생성 (UI 블로킹 없음)
- 300x300px PNG, 카테고리 색상 배경 + 해당 파일 웨이브폼 실루엣
- 캐시 경로: `~/.soundlib/artwork/{file_hash}.png`
- 폴더/컬렉션 단위 커버는 포함된 파일 중 대표 1개(가장 최근 추가 또는 재생 많은 것)의 아트워크 재사용
- `artwork_source` 필드로 embedded/manual/generated 구분 → 우측 패널에 뱃지로 표시, 우클릭 "Regenerate" 가능

### 4.3 처리 흐름

```
파일 스캔 → 오디오 메타데이터 파싱(길이/SR/채널) 
          → 임베디드 아트워크 시도 추출
          → 없으면 큐에 등록해 백그라운드 워커가 웨이브폼 렌더링
          → DB에 artwork_path, artwork_source 기록
          → UI에 즉시 반영 (플레이스홀더 → 실제 아트워크 순차 로딩)
```

---

## 5. 기술 스택

| 영역 | 선택 | 비고 |
|---|---|---|
| 앱 프레임워크 | **Electron** | Web Audio API 후킹 경험 있으므로 진입장벽 낮음, 드래그아웃 라이브러리 생태계 존재 |
| DB | SQLite (better-sqlite3) | 로컬 인덱스, 태그, 컬렉션, 아트워크 메타 |
| 재생/웨이브폼 | Web Audio API + WaveSurfer.js | |
| 오디오 메타 파싱 | music-metadata (Node) | ID3/RIFF/FLAC 태그 및 임베디드 아트워크 추출 지원 |
| 오디오 처리(리버스/피치) | Web Audio + ffmpeg(선택) | |
| DAW 드래그아웃 | `webUtils.getPathForFile` + native drag start | Cubase 대상 우선 검증 필요 |
| 리스트 렌더링 | react-window (가상 스크롤) | |

---

## 6. 데이터 모델 초안 (SQLite)

```sql
CREATE TABLE libraries (
  id INTEGER PRIMARY KEY,
  root_path TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER
);

CREATE TABLE tracks (
  id INTEGER PRIMARY KEY,
  library_id INTEGER REFERENCES libraries(id),
  file_path TEXT UNIQUE NOT NULL,
  filename TEXT NOT NULL,
  duration_ms INTEGER,
  sample_rate INTEGER,
  bit_depth INTEGER,
  channels INTEGER,
  category TEXT,
  subcategory TEXT,
  description TEXT,
  tags TEXT,                 -- JSON array
  starred INTEGER DEFAULT 0,
  artwork_path TEXT,
  artwork_source TEXT,       -- embedded | manual | generated
  added_at INTEGER,
  last_played_at INTEGER
);

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  artwork_path TEXT,
  created_at INTEGER
);

CREATE TABLE collection_tracks (
  collection_id INTEGER REFERENCES collections(id),
  track_id INTEGER REFERENCES tracks(id),
  position INTEGER,
  PRIMARY KEY (collection_id, track_id)
);

CREATE INDEX idx_tracks_category ON tracks(category);
CREATE INDEX idx_tracks_filename ON tracks(filename);
```

---

## 7. 폴더 구조 제안

```
soundlib/
├── src/
│   ├── main/                  # Electron main process
│   │   ├── db/                 # SQLite 스키마, 쿼리
│   │   ├── scanner/             # 폴더 스캔, 메타데이터 파싱
│   │   ├── artwork/             # 임베디드 추출 + 자동생성 워커
│   │   └── drag-export/         # DAW 드래그아웃 네이티브 연동
│   ├── renderer/               # React UI
│   │   ├── components/
│   │   │   ├── Sidebar/
│   │   │   ├── ResultList/
│   │   │   ├── MetadataPanel/
│   │   │   └── PlayerBar/
│   │   └── App.tsx
│   └── shared/                 # 타입 정의, 상수 (UCS 카테고리 목록 등)
├── package.json
└── CLAUDE.md                   # 아래 8번 내용
```

---

## 8. 단계별 로드맵

1. **Phase 1 — MVP**: 폴더 스캔 → SQLite 인덱싱 → 리스트뷰 → 클릭 재생 + 웨이브폼
2. **Phase 2**: 메타데이터 패널 + 태그/UCS 편집 + 검색/필터
3. **Phase 3**: 아트워크 자동 등록 (임베디드 추출 + 웨이브폼 스냅샷 생성)
4. **Phase 4**: 컬렉션/플레이리스트/즐겨찾기
5. **Phase 5**: DAW 드래그아웃 (Cubase 대상 우선 검증)
6. **Phase 6**: 이펙트 프리뷰(피치/스피드/리버스), Dock Mode, 단축키
7. **Phase 7 (선택)**: Find Similar — 로컬 임베딩 모델

각 Phase는 독립적으로 동작 확인 가능한 단위로 커밋.

---

## 9. 클로드 코드용 초기 지시 (CLAUDE.md에 넣을 내용)

```markdown
이 프로젝트는 Soundly(getsoundly.com)를 벤치마킹한 1인용 로컬 사운드 라이브러리
데스크탑 앱입니다. 클라우드/계정/구독 기능은 절대 추가하지 마세요.

- 스택: Electron + React + TypeScript + SQLite(better-sqlite3)
- UI는 PROJECT_SPEC.md의 3단 레이아웃(좌측 사이드바/중앙 리스트/우측 메타데이터,
  하단 플레이어)을 그대로 따릅니다.
- 다크 테마 기본, 카테고리별 색상 매핑 사용.
- Phase 1부터 순서대로 구현하고, 각 Phase 완료 시 동작 가능한 상태로 커밋하세요.
- 대용량 폴더(수천 개 파일) 스캔을 고려해 리스트는 반드시 가상 스크롤 사용.
- 아트워크는 임베디드 추출 우선, 없으면 백그라운드에서 웨이브폼 스냅샷 자동 생성
  (PROJECT_SPEC.md 4번 항목 참조).
- DAW 드래그아웃은 Cubase 대상으로 먼저 기술 검증부터 진행하고, 안 되면 대안
  (예: 임시 폴더로 내보내기 + 탐색기에서 드래그) 제시.
```

---

## 10. 리스크/확인 필요 사항

- **DAW 드래그아웃**: Electron에서 OS 네이티브 드래그로 Cubase 트랙까지 파일이
  실제로 들어가는지는 실제 빌드로 검증 필요 (표준 웹 API 밖의 영역)
- **WAV 임베디드 아트워크**: WAV는 ID3/RIFF 아트워크 지원이 표준화되어 있지 않아
  실제로 아트워크가 박혀있는 파일이 드묾 → 자동 생성 로직이 기본 경로가 될 가능성 높음
- **대용량 라이브러리 성능**: 수만 개 파일 스캔 시 초기 인덱싱 시간, 워커 스레드 분리 필요
