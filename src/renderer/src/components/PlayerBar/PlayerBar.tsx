import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/plugins/regions";
import type { Track } from "@shared/types";
import {
  encodeWavFloat32,
  reverseChannels,
  sliceAudioBuffer,
} from "../../lib/wavEncoder";
import { audioCacheKey, type AudioAccess } from "../../lib/audioCacheKey";
import { decodeAiffToWav, isAiffPath } from "../../lib/aiffDecoder";
import { pitchShiftChannels } from "../../lib/pitchShift";
import { loadBool, saveBool } from "../../lib/uiState";

const MIN_REGION_SEC = 0.05;
const PLAYBACK_OPTIONS_KEY = "soundlib.playbackOptions";
const FX_OPTIONS_KEY = "soundlib.fxOptions";
const FX_OPEN_KEY = "soundlib.fxOpen";
const RIGHT_OPEN_KEY = "soundlib.playerRightOpen";
const WAVE_COLOR = "rgba(245, 247, 250, 0.82)";
const PLAYHEAD_COLOR = "#ffffff";
const WAVE_CACHE_DB = "soundlib-wave-cache";
const WAVE_CACHE_STORE = "peaks";
const PRELOAD_RADIUS = 3;
// 트랙 선택이 이만큼 조용해진 뒤에야 무거운 웨이브폼 디코딩을 시작한다 — 리스트를 빠르게
// 훑고 지나가는 동안에는 중간 트랙들의 디코딩을 아예 시작하지 않기 위함
const DECODE_IDLE_MS = 180;
// 피치/리버스 슬라이더를 드래그하는 동안 오프라인 렌더링이 매 스텝마다 시작되지 않도록,
// 잠깐 멈춘 뒤 최종 값으로 한 번만 리로드하는 디바운스 간격
const FX_RELOAD_DEBOUNCE_MS = 140;
// 세션 중 미리듣기한 트랙이 아주 많아져도(수천 개 라이브러리) 피크 메모리 캐시가
// 무한정 커지지 않도록 LRU로 상한을 둔다. 디스크(IndexedDB) 캐시는 상한 없이 유지된다.
const MAX_MEMORY_PEAKS = 300;

// "resume" = 커서/마지막 위치, "start" = 항상 0:00, "selectionStart" = 구간이 있으면 구간
// 시작점(Cubase의 Start from Cycle/Selection Start에 해당 — 이 앱은 구간을 하나만 다루므로
// 둘을 구분하지 않는다), 없으면 0:00로 폴백
type StartMode = "resume" | "start" | "selectionStart";
type QueueMode = "single" | "continuous";

interface PlaybackOptions {
  startMode: StartMode;
  selectionLoop: boolean;
  autoPlayOnSelect: boolean;
  queueMode: QueueMode;
  returnToStartOnStop: boolean;
}

const DEFAULT_PLAYBACK_OPTIONS: PlaybackOptions = {
  startMode: "start",
  selectionLoop: false,
  autoPlayOnSelect: true,
  queueMode: "single",
  returnToStartOnStop: false,
};

function loadPlaybackOptions(): PlaybackOptions {
  try {
    const raw = localStorage.getItem(PLAYBACK_OPTIONS_KEY);
    if (!raw) return DEFAULT_PLAYBACK_OPTIONS;
    return { ...DEFAULT_PLAYBACK_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PLAYBACK_OPTIONS;
  }
}

function savePlaybackOptions(options: PlaybackOptions): void {
  try {
    localStorage.setItem(PLAYBACK_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* noop */
  }
}

interface FxOptions {
  speedPct: number; // 50-200, wired to real playback rate
  pitchSemitones: number; // -12..12, pitchLinked=false일 때 오프라인 WSOLA 렌더링으로 실제 반영
  pitchLinked: boolean; // true = "tape" varispeed: 속도 변화에 피치가 자연스럽게 따라감 (실제 재생에 반영)
  reversed: boolean; // 오프라인 렌더링(샘플 반전)으로 실제 역재생 반영
}

const DEFAULT_FX_OPTIONS: FxOptions = {
  speedPct: 100,
  pitchSemitones: 0,
  pitchLinked: false,
  reversed: false,
};

function loadFxOptions(): FxOptions {
  try {
    const raw = localStorage.getItem(FX_OPTIONS_KEY);
    if (!raw) return DEFAULT_FX_OPTIONS;
    return { ...DEFAULT_FX_OPTIONS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FX_OPTIONS;
  }
}

function saveFxOptions(options: FxOptions): void {
  try {
    localStorage.setItem(FX_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    /* noop */
  }
}

// 디코딩(WaveSurfer/Web Audio) 목적으로 파일 바이트를 읽는 단일 지점 — AIFF는 브라우저가
// 컨테이너 자체를 이해하지 못하므로 여기서 항상 WAV로 먼저 변환해 넘긴다.
async function readPcmBytesForDecode(filePath: string): Promise<Uint8Array> {
  const raw = await window.api!.readAudioFile(filePath);
  const bytes = new Uint8Array(raw);
  return isAiffPath(filePath) ? decodeAiffToWav(bytes) : bytes;
}

// 플레이어 패널 전체 높이에서 컨트롤바/여백을 뺀 웨이브폼 가용 높이를 계산해,
// 스테레오(2채널 스택)/단일 채널 각각의 렌더 높이를 구한다. 패널을 키우면 웨이브폼도 커짐.
// chrome = 웨이브폼 아래에 깔리는 고정 UI 높이 (컨트롤 바 + FX 바). Dock Mode에서는 FX 바가
// 숨겨지므로 호출부가 그에 맞는 값을 넘겨준다.
function waveHeightsFor(
  panelHeight: number,
  chrome: number,
): { both: number; single: number } {
  const waveArea = Math.max(40, panelHeight - chrome - 14 /* padding */);
  return {
    both: Math.max(16, Math.floor((waveArea - 2) / 2)),
    single: Math.max(28, waveArea),
  };
}

interface PlayerBarProps {
  track: Track | null;
  accent: string;
  panelHeight: number;
  onPrev: () => void;
  onNext: () => void;
  queueTracks?: Track[];
  dockMode?: boolean;
  // loop 구간/마커를 저장하면 DB뿐 아니라 App의 in-memory Track도 갱신해야, 세션 중
  // 다른 트랙을 거쳐 돌아왔을 때 방금 저장한 값이 stale Track에 덮여 사라지지 않는다.
  onTrackPersisted?: (track: Track) => void;
}

export interface MeterTap {
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
  isMono: boolean;
  // AnalyserNode는 미디어가 멈춰도(pause/stop) 새 샘플이 안 들어올 뿐 마지막으로 받은
  // 값을 계속 돌려준다 — 그래서 재생 중인지 여부를 별도로 알려줘야 분석 패널이 "정지 후에도
  // 미터가 멈춘 값으로 얼어붙는" 문제 없이 무음으로 취급할 수 있다.
  isPlaying: boolean;
}

// App의 키보드 단축키(Space/Enter/Esc)가 플레이어를 제어할 수 있도록 노출하는 명령형 핸들
export interface PlayerHandle {
  playPause: () => void;
  play: () => void;
  stopAndClear: () => void;
  // 오른쪽 분석 패널(AnalysisPanel)이 실시간 레벨을 읽어가는 AnalyserNode 탭.
  // 아직 재생 그래프가 생성되지 않았으면(트랙을 한 번도 재생하지 않음) null.
  getMeterTap: () => MeterTap | null;
  toggleLoopRegion: () => void;
  addMarker: () => void;
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return "0:00.00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec % 1) * 100);
  return `${m}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

// 채널 데이터 → 다운샘플된 피크(막대 높이) 배열
function channelPeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const size = Math.max(1, Math.floor(data.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(start + size, data.length);
    for (let j = start; j < end; j++) {
      const a = Math.abs(data[j]);
      if (a > max) max = a;
    }
    out[i] = max;
  }
  return out;
}

function monoPeaks(
  l: Float32Array,
  r: Float32Array,
  buckets: number,
): Float32Array {
  const out = new Float32Array(buckets);
  const len = Math.min(l.length, r.length);
  const size = Math.max(1, Math.floor(len / buckets));
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * size;
    const end = Math.min(start + size, len);
    for (let j = start; j < end; j++) {
      const a = Math.abs((l[j] + r[j]) * 0.5);
      if (a > max) max = a;
    }
    out[i] = max;
  }
  return out;
}

interface Peaks {
  l: Float32Array;
  r: Float32Array;
  mono: Float32Array;
  duration: number;
  numCh: number;
}

interface WaveCacheRecord extends Peaks {
  key: string;
}

interface Route {
  ctx: AudioContext;
  g0: GainNode;
  g1: GainNode;
  merger: ChannelMergerNode;
  // 실시간 분석 패널(Peak/Stereo Width)이 읽어가는 탭 — 오디오 그래프의 부산물로만
  // 존재하며 destination에는 연결하지 않는다(신호 경로/음량에는 영향 없음)
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}

type WaveView = "both" | "left" | "right" | "mono" | "silent";

let waveCacheDbPromise: Promise<IDBDatabase> | null = null;
const memoryPeakCache = new Map<string, Peaks>();
const preloadUrlCache = new Map<string, string>();
// 미리듣기 프리로드용 <audio> 엘리먼트. Chromium은 렌더러당 미디어 엘리먼트 수에 상한이
// 있어(수십 개) 이걸 계속 만들기만 하면 어느 순간부터 재생 자체가 막힌다 — LRU로 상한을 두고
// 밀려난 엘리먼트는 src를 비워 확실히 해제한다.
const preloadAudioCache = new Map<string, HTMLAudioElement>();
const MAX_PRELOAD_AUDIO = PRELOAD_RADIUS * 2 + 2;

function releasePreloadAudio(audio: HTMLAudioElement): void {
  try {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  } catch {
    /* noop */
  }
}

function touchPreloadAudio(filePath: string, audio: HTMLAudioElement): void {
  preloadAudioCache.delete(filePath);
  preloadAudioCache.set(filePath, audio);
  while (preloadAudioCache.size > MAX_PRELOAD_AUDIO) {
    const oldest = preloadAudioCache.keys().next().value;
    if (oldest === undefined) break;
    const stale = preloadAudioCache.get(oldest);
    preloadAudioCache.delete(oldest);
    if (stale) releasePreloadAudio(stale);
  }
}

function openWaveCacheDb(): Promise<IDBDatabase> {
  if (waveCacheDbPromise) return waveCacheDbPromise;
  waveCacheDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(WAVE_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WAVE_CACHE_STORE))
        req.result.createObjectStore(WAVE_CACHE_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return waveCacheDbPromise;
}

// Map은 삽입 순서를 보존하므로, 읽거나 쓸 때마다 delete 후 재삽입해 항상 "가장 최근 사용"이
// 끝에 오도록 유지한다. 상한을 넘으면 맨 앞(가장 오래 전에 쓰인) 항목부터 제거한다.
function touchMemoryPeaks(key: string, peaks: Peaks): void {
  memoryPeakCache.delete(key);
  memoryPeakCache.set(key, peaks);
  while (memoryPeakCache.size > MAX_MEMORY_PEAKS) {
    const oldest = memoryPeakCache.keys().next().value;
    if (oldest === undefined) break;
    memoryPeakCache.delete(oldest);
  }
}

async function getCachedPeaks(key: string): Promise<Peaks | null> {
  const mem = memoryPeakCache.get(key);
  if (mem) {
    touchMemoryPeaks(key, mem);
    return mem;
  }
  try {
    const db = await openWaveCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(WAVE_CACHE_STORE, "readonly");
      const req = tx.objectStore(WAVE_CACHE_STORE).get(key);
      req.onsuccess = () => {
        const row = req.result as WaveCacheRecord | undefined;
        if (!row) return resolve(null);
        const peaks: Peaks = {
          l: row.l,
          r: row.r,
          mono: row.mono,
          duration: row.duration,
          numCh: row.numCh,
        };
        touchMemoryPeaks(key, peaks);
        resolve(peaks);
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function putCachedPeaks(key: string, peaks: Peaks): Promise<void> {
  touchMemoryPeaks(key, peaks);
  try {
    const db = await openWaveCacheDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(WAVE_CACHE_STORE, "readwrite");
      tx.objectStore(WAVE_CACHE_STORE).put({ key, ...peaks });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    /* noop */
  }
}

// 통일된 트랜스포트 아이콘
const IconLoop = (): JSX.Element => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
);
// A-B 구간(로케이터) 반복 토글 — 전체 트랙 반복(IconLoop)과 구분되는 대괄호 모양
const IconLoopRegion = (): JSX.Element => (
  <svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M7 4H4v16h3" />
    <path d="M17 4h3v16h-3" />
    <path d="M9 12h6" />
  </svg>
);
const IconMarker = (): JSX.Element => (
  <svg
    width="15"
    height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 3v18" />
    <path d="M5 4h13l-3 4 3 4H5" />
  </svg>
);
const IconPrev = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 5v14l-11-7z" />
    <rect x="5" y="5" width="2" height="14" rx="1" />
  </svg>
);
const IconNext = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 5v14l11-7z" />
    <rect x="17" y="5" width="2" height="14" rx="1" />
  </svg>
);
const IconPlay = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4v16l13-8z" />
  </svg>
);
const IconPause = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4.5" height="16" rx="1.2" />
    <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" />
  </svg>
);
const IconStop = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
);
const VolumeSvg = ({ children }: { children: ReactNode }): JSX.Element => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 9v6h4l5 4V5L8 9H4z" />
    {children}
  </svg>
);

const IconVolume = (): JSX.Element => (
  <VolumeSvg>
    <path d="M17 8a5 5 0 0 1 0 8" />
  </VolumeSvg>
);

const IconVolumeMuted = (): JSX.Element => (
  <VolumeSvg>
    <path d="M17 9l5 6" />
    <path d="M22 9l-5 6" />
  </VolumeSvg>
);

const IconFx = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 21V14" />
    <path d="M4 10V3" />
    <circle cx="4" cy="12" r="2" />
    <path d="M12 21V16" />
    <path d="M12 12V3" />
    <circle cx="12" cy="14" r="2" />
    <path d="M20 21V10" />
    <path d="M20 6V3" />
    <circle cx="20" cy="8" r="2" />
  </svg>
);
// Options / Stereo·Mono / Channel 묶음을 여는 버튼의 글리프
const IconSliders = (): JSX.Element => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 6h11" />
    <path d="M18 6h3" />
    <circle cx="16" cy="6" r="2" />
    <path d="M3 18h3" />
    <path d="M10 18h11" />
    <circle cx="8" cy="18" r="2" />
  </svg>
);
// 접힌 컨트롤이 오른쪽으로 밀려 나오는 방향을 가리킨다 (열리면 CSS로 180° 회전)
const IconChevronRight = (): JSX.Element => (
  <svg
    className="player__bar-chevron"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 18l6-6-6-6" />
  </svg>
);
// Reverse 토글의 시각적 시그니처 — 오름차순 막대(정재생)가 켜지면 좌우로 뒤집힌다(역재생)
function ReverseGlyph({ flipped }: { flipped: boolean }): JSX.Element {
  const heights = [4, 7, 11, 15, 9, 6];
  return (
    <svg
      width="26"
      height="15"
      viewBox="0 0 26 15"
      style={{
        transform: flipped ? "scaleX(-1)" : "none",
        transition: "transform 0.22s var(--ease)",
      }}
    >
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 4.4}
          y={15 - h}
          width="3"
          height={h}
          rx="1"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}

const PlayerBar = forwardRef<PlayerHandle, PlayerBarProps>(function PlayerBar(
  {
    track,
    accent,
    panelHeight,
    onPrev,
    onNext,
    queueTracks = [],
    dockMode = false,
    onTrackPersisted,
  },
  ref,
) {
  const waveBandRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // 현재 패널 높이에 따른 웨이브폼 높이 (setOptions에 항상 이 값을 사용)
  const panelHeightRef = useRef(panelHeight);
  panelHeightRef.current = panelHeight;
  // 컨트롤 바 한 줄이 전부다 (Dock Mode에서는 버튼이 작아 줄 높이도 낮다)
  const chrome = dockMode ? 46 : 54;
  const chromeRef = useRef(chrome);
  chromeRef.current = chrome;
  const waveH = waveHeightsFor(panelHeight, chrome);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  // ws.load()가 겹쳐 호출돼도 WaveSurfer가 내부 _loadVersion으로 나중 호출을 항상 이기게
  // 처리하므로(wavesurfer.js v7 loadAudio 참고) 로드를 직렬화하면 안 된다 — 직렬화하면 새
  // 클릭의 load()가 이전 트랙의 재생 시작까지 기다리게 돼 반응이 오히려 느려진다. 이 토큰은
  // load() 경합이 아니라 공유 ref(urlRef 등)를 낡은 로드가 덮어쓰지 못하게 막는 용도다.
  const loadTokenRef = useRef(0);
  // 실제로 WaveSurfer에 물려 있는 트랙 id. 재생 위치는 "지금 화면에 선택된 트랙"이 아니라
  // "지금 로드돼 있는 트랙"의 키에 저장해야 한다 — 트랙 전환 중 발생하는 pause 이벤트가
  // 떠나는 트랙의 위치를 새 트랙 키에 써버리는 것을 막는다.
  const playingTrackIdRef = useRef<number | null>(null);
  // 캐시가 없는 트랙의 "전체 파일 읽기 + decodeAudioData"는 무겁다. 빠르게 클릭하면 트랙마다
  // 이 작업이 동시에 쌓여 렌더러와 IPC를 포화시키고, 정작 방금 클릭한 트랙의 로드를 밀어낸다.
  // 선택이 잠시 멈춘 뒤에(DECODE_IDLE_MS) 한 번에 하나씩만 돌린다.
  const decodeTimerRef = useRef<number | undefined>(undefined);
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const routeRef = useRef<Route | null>(null);
  const decodeCtxRef = useRef<AudioContext | null>(null);
  const peaksRef = useRef<Peaks | null>(null);
  const urlRef = useRef<string | null>(null);
  // AIFF는 file:// URL을 직접 재생할 수 없어 WAV로 변환한 Blob URL을 쓴다 — 파일 URL과 달리
  // 명시적으로 revoke해야 메모리가 안 새므로 트랙이 바뀔 때마다/언마운트 시 여기서 정리한다
  const aiffBlobUrlRef = useRef<string | null>(null);
  const regionsPluginRef = useRef<RegionsPlugin | null>(null);
  const activeRegionRef = useRef<Region | null>(null);
  // 구간 드래그(DAW export)용 원본 해상도 디코딩 캐시 — peaksRef(다운샘플)와는 별개로 유지
  const rawBufferRef = useRef<AudioBuffer | null>(null);
  const rawBufferTrackIdRef = useRef<number | null>(null);
  // 진행 중인 전체 파일 디코드를 공유해 동시 read+decode 폭주를 막는다(피치 슬라이더 드래그)
  const fullBufferPromiseRef = useRef<Promise<AudioBuffer | null> | null>(null);
  const fullBufferPromiseIdRef = useRef<number | null>(null);
  // FX(Reverse/독립 Pitch)가 켜져 있지 않을 때 재생되는 원본(비가공) URL
  const baseUrlRef = useRef<string | null>(null);
  // Reverse/독립 Pitch를 오프라인 렌더링한 결과 WAV Blob URL — (trackId:reversed:pitch) 키로 캐시
  const processedUrlRef = useRef<string | null>(null);
  const processedUrlKeyRef = useRef<string | null>(null);
  // 진행 중인 오프라인 렌더링을 FX 키로 공유 — 디바운스가 뚫려도 중복 렌더/URL revoke를 막는다
  const processedUrlPromiseRef = useRef<Promise<string | null> | null>(null);
  const processedUrlPromiseKeyRef = useRef<string | null>(null);
  const prevReversedRef = useRef(false);
  const [regionBounds, setRegionBounds] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [markers, setMarkers] = useState<number[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  // wavesurfer.isPlaying()를 매 애니메이션 프레임 직접 호출하면 stop() 후 재생을 다시
  // 시작했을 때 잠깐(혹은 계속) 실제 상태와 어긋나는 경우가 있어, 'play'/'pause'/'finish'
  // 이벤트로만 갱신되는 이 ref를 분석 패널의 실제 재생 여부 판단 기준으로 쓴다.
  const isPlayingRef = useRef(false);
  const [loop, setLoop] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  // 오디오 로드 실패 사유를 사용자에게 보여준다 — 예전에는 console.warn으로만 삼켜져
  // "클릭해도 소리도, 아무 표시도 없는" 상태였다. 성공/트랙 변경 시 초기화된다.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.85);
  // 뮤트는 볼륨 값을 건드리지 않는다 — 해제하면 원래 크기로 돌아와야 한다
  const [muted, setMuted] = useState(false);
  const effectiveVolume = muted ? 0 : volume;
  // 트랙 로드 콜백은 오래된 클로저를 붙들고 있을 수 있어 ref로 현재 값을 읽는다
  const effectiveVolumeRef = useRef(effectiveVolume);
  effectiveVolumeRef.current = effectiveVolume;
  const [ch1, setCh1] = useState(true);
  const [ch2, setCh2] = useState(true);
  const [mode, setMode] = useState<"stereo" | "mono">("stereo");
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Options 팝업은 position:fixed로 띄운다 — .player__right가 overflow-x:clip이라 팝업이
  // 그 안에 있으면 좁은 창에서 가로로 잘린다. fixed는 조상의 clip을 탈출하므로, 열릴 때
  // 버튼 좌표를 재어 버튼 위(오른쪽 정렬)에 직접 배치한다.
  const optBtnRef = useRef<HTMLButtonElement>(null);
  const [optMenuPos, setOptMenuPos] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  // FX 컨트롤 펼침 여부는 앱을 다시 켜도 유지한다 — 자주 쓰는 사람은 늘 펼쳐 두고 쓴다
  const [fxOpen, setFxOpen] = useState(() => loadBool(FX_OPEN_KEY, false));

  // Options / Stereo·Mono / Channel 묶음도 같은 방식으로 접는다 (볼륨은 늘 보인다)
  const [rightOpen, setRightOpen] = useState(() =>
    loadBool(RIGHT_OPEN_KEY, false),
  );

  function toggleFxOpen(): void {
    const next = !fxOpen;
    setFxOpen(next);
    saveBool(FX_OPEN_KEY, next);
  }

  function toggleRightOpen(): void {
    const next = !rightOpen;
    setRightOpen(next);
    saveBool(RIGHT_OPEN_KEY, next);
  }
  const [playbackOptions, setPlaybackOptions] = useState<PlaybackOptions>(() =>
    loadPlaybackOptions(),
  );
  const [fx, setFx] = useState<FxOptions>(() => loadFxOptions());
  const fxRef = useRef(fx);
  fxRef.current = fx;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const playbackOptionsRef = useRef(playbackOptions);
  playbackOptionsRef.current = playbackOptions;
  const regionBoundsRef = useRef(regionBounds);
  regionBoundsRef.current = regionBounds;
  const trackRef = useRef(track);
  trackRef.current = track;
  const onTrackPersistedRef = useRef(onTrackPersisted);
  onTrackPersistedRef.current = onTrackPersisted;
  const prevTrackIdRef = useRef<number | null>(track?.id ?? null);

  function updatePlaybackOptions(patch: Partial<PlaybackOptions>): void {
    setPlaybackOptions((prev) => {
      const next = { ...prev, ...patch };
      savePlaybackOptions(next);
      return next;
    });
  }

  function updateFx(patch: Partial<FxOptions>): void {
    setFx((prev) => {
      const next = { ...prev, ...patch };
      saveFxOptions(next);
      return next;
    });
  }

  function positionKeyForId(id: number | null): string | null {
    return id != null ? `soundlib.playbackPosition.${id}` : null;
  }

  function positionKey(t: Track | null = trackRef.current): string | null {
    return positionKeyForId(t?.id ?? null);
  }

  // 저장 대상은 "지금 로드돼 있는 트랙"(playingTrackIdRef)이다. trackRef.current는 렌더 중에
  // 갱신되므로 트랙 전환 시점엔 이미 새 트랙을 가리키고, WaveSurfer의 load()가 이전 미디어를
  // pause 시키며 발생시키는 pause 이벤트가 여기로 들어오면 떠나는 트랙의 재생 위치가 새 트랙
  // 키에 저장돼 버린다(=새 사운드가 엉뚱한 지점부터 재생됨).
  function savePlaybackPosition(time?: number): void {
    const key = positionKeyForId(playingTrackIdRef.current);
    const ws = wavesurferRef.current;
    if (!key || !ws) return;
    const value = Number.isFinite(time) ? time! : ws.getCurrentTime();
    try {
      localStorage.setItem(key, String(Math.max(0, value)));
    } catch {
      /* noop */
    }
  }

  function loadPlaybackPosition(t: Track | null = trackRef.current): number {
    const key = positionKey(t);
    if (!key) return 0;
    const value = Number(localStorage.getItem(key) ?? 0);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function clearPlaybackPositionById(id: number | null): void {
    const key = positionKeyForId(id);
    if (!key) return;
    try {
      localStorage.removeItem(key);
    } catch {
      /* noop */
    }
  }

  // Cubase의 "Start from Cycle/Selection Start", "Start from Project Cursor Position"에
  // 대응하는 시작 위치 계산. 이 앱은 구간(region)을 하나만 다루므로 Cycle과 Selection은
  // 구분하지 않고 같은 저장된 구간을 가리킨다. resume(마지막 위치)만 "이미 재생 중이면
  // 건드리지 않는다"는 기존 동작을 그대로 유지하기 위해 skipResumeIfPlaying로 감싼다.
  function resolveStartPosition(forceStart: boolean): number | null {
    const ws = wavesurferRef.current;
    const bounds = regionBoundsRef.current;
    const hasRegion = Boolean(
      bounds && bounds.end - bounds.start >= MIN_REGION_SEC,
    );
    if (playbackOptionsRef.current.selectionLoop && hasRegion)
      return bounds!.start;
    if (forceStart || playbackOptionsRef.current.startMode === "start")
      return 0;
    if (playbackOptionsRef.current.startMode === "selectionStart" && hasRegion)
      return bounds!.start;
    if (playbackOptionsRef.current.startMode === "resume") {
      if (ws?.isPlaying()) return null;
      const saved = loadPlaybackPosition();
      const dur = ws?.getDuration() ?? 0;
      if (saved > 0 && (!dur || saved < Math.max(0, dur - 0.05))) return saved;
      return null;
    }
    return 0;
  }

  async function startPlayback(forceStart = false): Promise<void> {
    const ws = wavesurferRef.current;
    if (!ws || !trackRef.current) return;
    const pos = resolveStartPosition(forceStart);
    if (pos !== null) ws.setTime(pos);
    await ws.play();
  }

  function stopPlayback(): void {
    const ws = wavesurferRef.current;
    if (!ws) return;
    savePlaybackPosition(ws.getCurrentTime());
    ws.stop();
    // ws.stop()이 내부적으로 'pause' 이벤트를 안정적으로 쏘지 않는 경우가 있어(재생을 다시
    // 시작해도 분석 패널이 계속 무음으로 판단하던 버그의 원인), 여기서도 명시적으로 갱신한다
    isPlayingRef.current = false;
    // Cubase의 "Return to Start Position on Stop" — 정지 직후 재생 시작 위치로 되돌린다
    if (playbackOptionsRef.current.returnToStartOnStop) {
      const pos = resolveStartPosition(false);
      if (pos !== null) ws.setTime(pos);
    }
  }

  // 웨이브폼에 잡은 A-B 구간은 현재 로드된 트랙의 임시 UI 상태로만 다룬다 — DB에
  // 저장하거나 다시 복원하지 않으므로 다른 트랙으로 넘어가면 기록이 남지 않는다.
  function clearRegionSelection(): void {
    regionsPluginRef.current?.clearRegions();
    activeRegionRef.current = null;
    setRegionBounds(null);
  }

  function addMarkerAtCurrentTime(): void {
    const ws = wavesurferRef.current;
    const t = trackRef.current;
    if (!ws || !t) return;
    const time = ws.getCurrentTime();
    setMarkers((prev) => {
      if (prev.some((m) => Math.abs(m - time) < 0.05)) return prev;
      const next = [...prev, time].sort((a, b) => a - b);
      void window.api?.updateTrackMarkers(t.id, next).then((updated) => {
        if (updated) onTrackPersistedRef.current?.(updated);
      });
      return next;
    });
  }

  function removeMarker(time: number): void {
    const t = trackRef.current;
    if (!t) return;
    setMarkers((prev) => {
      const next = prev.filter((m) => m !== time);
      void window.api?.updateTrackMarkers(t.id, next).then((updated) => {
        if (updated) onTrackPersistedRef.current?.(updated);
      });
      return next;
    });
  }

  function toggleLoopRegion(): void {
    if (!regionBoundsRef.current) return;
    updatePlaybackOptions({
      selectionLoop: !playbackOptionsRef.current.selectionLoop,
    });
  }

  useEffect(() => {
    if (!containerRef.current) return;
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: WAVE_COLOR,
      progressColor: WAVE_COLOR,
      cursorColor: PLAYHEAD_COLOR,
      cursorWidth: 1,
      height: waveH.both,
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      normalize: true,
      splitChannels: [{ height: waveH.both }, { height: waveH.both }],
    });
    ws.on("play", () => {
      setIsPlaying(true);
      isPlayingRef.current = true;
    });
    ws.on("pause", () => {
      setIsPlaying(false);
      isPlayingRef.current = false;
      savePlaybackPosition(ws.getCurrentTime());
    });
    ws.on("timeupdate", (t: number) => {
      setCurrent(t);
      const bounds = regionBoundsRef.current;
      if (
        playbackOptionsRef.current.selectionLoop &&
        bounds &&
        bounds.end - bounds.start >= MIN_REGION_SEC &&
        t >= bounds.end
      ) {
        ws.setTime(bounds.start);
        if (ws.isPlaying()) void ws.play();
      }
    });
    // 사용자가 파형을 클릭/드래그해 직접 이동한 위치 — 'timeupdate'와 달리 프로그램적
    // seek(setTime)가 아니라 사용자 상호작용에서만 발생한다. 이 값을 즉시 저장해두지
    // 않으면, 정지(Stop) 후 클릭으로 새 위치를 잡아도 startPlayback()의 "resume" 로직이
    // localStorage에 남아있던 정지 시점의 예전 위치를 읽어와 클릭 위치를 덮어써버린다.
    ws.on("interaction", (newTime: number) => {
      savePlaybackPosition(newTime);
    });
    // 웨이브폼의 구간 바깥을 클릭하면 잡아둔 A-B 구간을 해제한다(DAW의 선택 해제와 같은 동작).
    // 예전에는 한 번 드래그한 구간이 계속 남아 있어, 지우려면 Loop 버튼을 찾아 눌러야 했다.
    //
    // 드래그로 구간을 만들거나 크기를 조절한 직후에는 wavesurfer의 드래그 헬퍼가 뒤따르는
    // click을 캡처 단계에서 막아주므로(dist/draggable.js), 방금 만든 구간이 곧바로 지워지는
    // 일은 없다. 구간 "안"을 클릭한 경우는 위치 이동 의도로 보고 그대로 둔다.
    ws.on("click", (relativeX: number) => {
      const bounds = regionBoundsRef.current;
      if (!bounds) return;
      const total = ws.getDuration();
      if (!total) return;
      const clickedAt = relativeX * total;
      if (clickedAt >= bounds.start && clickedAt <= bounds.end) return;
      clearRegionSelection();
    });
    ws.on("ready", () => setDuration(ws.getDuration()));

    // 재생 실패를 드러내는 계측 ------------------------------------------
    // ws.load()는 피크와 duration을 함께 받으면 미디어를 검증하지 않고 즉시 성공한다.
    // 그래서 디코딩 불가 파일은 "소리도 안 나고 에러도 안 뜨는" 상태가 된다. 실제 실패는
    // 아래 두 경로로만 관측된다.
    ws.on("error", (err: Error) => {
      console.error("wavesurfer error:", err);
      setLoadError(err?.message ?? "재생 오류");
    });

    const media = ws.getMediaElement();
    if (media) {
      media.addEventListener("error", () => {
        // MediaError.code: 1 ABORTED / 2 NETWORK / 3 DECODE / 4 SRC_NOT_SUPPORTED
        const e = media.error;
        const detail = e
          ? `code=${e.code} ${e.message ?? ""}`.trim()
          : "unknown";
        console.error("media error:", detail, {
          src: media.currentSrc,
          track: trackRef.current?.filename,
          sampleRate: trackRef.current?.sampleRate,
          bitDepth: trackRef.current?.bitDepth,
          isFloat: trackRef.current?.isFloat,
          outputRate: routeRef.current?.ctx.sampleRate,
        });
        setLoadError(
          e?.code === 4
            ? "이 오디오 형식을 재생할 수 없습니다"
            : `재생 오류 (${detail})`,
        );
      });
    }
    ws.on("finish", () => {
      savePlaybackPosition(ws.getDuration());
      const bounds = regionBoundsRef.current;
      if (
        playbackOptionsRef.current.selectionLoop &&
        bounds &&
        bounds.end - bounds.start >= MIN_REGION_SEC
      ) {
        ws.setTime(bounds.start);
        void ws.play();
        return;
      }
      if (loopRef.current) {
        ws.setTime(0);
        void ws.play();
        return;
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackOptionsRef.current.queueMode === "continuous") onNext();
    });

    // Waveform 구간 선택(드래그로 생성/리사이즈) — 선택 구간만 DAW로 드래그 내보내기 위한 기반
    const regions = ws.registerPlugin(RegionsPlugin.create());
    regionsPluginRef.current = regions;
    regions.enableDragSelection({ color: "rgba(255, 255, 255, 0.22)" });
    regions.on("region-created", (region) => {
      // 한 번에 하나의 구간만 유지 (새로 그리면 이전 선택은 제거)
      for (const r of regions.getRegions()) {
        if (r.id !== region.id) r.remove();
      }
      activeRegionRef.current = region;
      setRegionBounds({ start: region.start, end: region.end });
      void ensureFullBuffer();
    });
    regions.on("region-update", (region) => {
      activeRegionRef.current = region;
      setRegionBounds({ start: region.start, end: region.end });
    });
    regions.on("region-removed", (region) => {
      if (activeRegionRef.current?.id === region.id) {
        activeRegionRef.current = null;
        setRegionBounds(null);
      }
    });

    wavesurferRef.current = ws;
    return () => {
      const route = routeRef.current;
      routeRef.current = null;
      void route?.ctx.close();
      const decodeCtx = decodeCtxRef.current;
      decodeCtxRef.current = null;
      void decodeCtx?.close();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      if (processedUrlRef.current) {
        URL.revokeObjectURL(processedUrlRef.current);
        processedUrlRef.current = null;
      }
      ws.destroy();
      wavesurferRef.current = null;
      regionsPluginRef.current = null;
    };
  }, []);

  useEffect(() => {
    wavesurferRef.current?.setOptions({
      waveColor: WAVE_COLOR,
      progressColor: WAVE_COLOR,
      cursorColor: PLAYHEAD_COLOR,
    });
  }, [accent]);

  useEffect(() => {
    wavesurferRef.current?.setVolume(effectiveVolume);
  }, [effectiveVolume]);

  // Speed는 브라우저 네이티브 playbackRate로 실제 재생에 반영된다. pitchLinked가 켜지면
  // preservePitch=false를 줘서 속도 변화에 피치가 테이프처럼 자연스럽게 따라가게 한다.
  useEffect(() => {
    wavesurferRef.current?.setPlaybackRate(fx.speedPct / 100, !fx.pitchLinked);
  }, [fx.speedPct, fx.pitchLinked]);

  // Reverse / 독립 Pitch는 실시간 DSP가 아니라 오프라인 렌더링(WSOLA/샘플 반전) 결과를
  // WAV Blob으로 다시 로드하는 방식으로 반영한다. 재생 위치는, Reverse가 이번에 토글된
  // 경우에 한해 duration 기준으로 대칭 이동시켜(정재생 3초 지점 == 역재생에서 남은 3초
  // 지점) 자연스럽게 이어지도록 한다.
  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws || !baseUrlRef.current || !trackRef.current) return;
    const reversedChanged = prevReversedRef.current !== fx.reversed;
    prevReversedRef.current = fx.reversed;
    let cancelled = false;
    const runReload = async (): Promise<void> => {
      if (cancelled) return;
      const targetUrl = (await ensureProcessedUrl()) ?? baseUrlRef.current!;
      if (cancelled || targetUrl === urlRef.current) return;
      const wasPlaying = ws.isPlaying();
      const time = ws.getCurrentTime();
      const dur = ws.getDuration() || duration;
      const nextTime =
        reversedChanged && dur > 0 ? Math.max(0, dur - time) : time;
      const numCh = peaksRef.current?.numCh ?? trackRef.current?.channels ?? 2;
      const v = viewFor(ch1, ch2, numCh);
      const h = waveHeightsFor(panelHeightRef.current, chromeRef.current);
      try {
        ws.setOptions({
          height: v === "both" ? h.both : h.single,
          splitChannels:
            v === "both"
              ? [{ height: h.both }, { height: h.both }]
              : [{ height: h.single }],
        });
        await loadWithPeaks(targetUrl, v);
        urlRef.current = targetUrl;
        ws.setPlaybackRate(
          fxRef.current.speedPct / 100,
          !fxRef.current.pitchLinked,
        );
        if (nextTime > 0) ws.setTime(nextTime);
        if (wasPlaying) await ws.play();
      } catch (err) {
        // 조용히 삼키면 "Reverse가 안 꺼진다" 같은 증상만 남고 원인이 보이지 않는다
        console.warn("FX reload failed:", (err as Error)?.message);
      }
    };
    // 디바운스 — 피치 슬라이더를 드래그하면 스텝마다 이 effect가 재실행된다. 매번 즉시
    // 오프라인 렌더링을 시작하면 취소된 작업의 디코드가 계속 쌓이므로, 잠깐 멈춘 뒤 최종
    // 값으로 한 번만 리로드한다.
    const id = window.setTimeout(() => {
      void runReload();
    }, FX_RELOAD_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx.reversed, fx.pitchSemitones, fx.pitchLinked]);

  // 패널 높이가 바뀌면 웨이브폼을 새 높이로 다시 그림 (드래그 중 과도한 리로드 방지 위해 디바운스)
  useEffect(() => {
    if (!wavesurferRef.current || !urlRef.current) return;
    const id = window.setTimeout(() => {
      void renderView(ch1, ch2, mode);
    }, 130);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelHeight]);

  // App 키보드 단축키가 호출하는 명령형 제어 (재생/일시정지, 재생, 정지+구간해제)
  useImperativeHandle(ref, () => ({
    playPause: togglePlayback,
    play: () => {
      void startPlayback();
    },
    stopAndClear: () => {
      stopPlayback();
      clearRegionSelection();
    },
    getMeterTap: () => {
      const r = routeRef.current;
      if (!r) return null;
      return {
        analyserL: r.analyserL,
        analyserR: r.analyserR,
        isMono: (trackRef.current?.channels ?? 2) < 2,
        isPlaying: isPlayingRef.current,
      };
    },
    toggleLoopRegion,
    addMarker: addMarkerAtCurrentTime,
  }));

  // 현재 채널/모드 → 웨이브폼 뷰
  function viewFor(c1: boolean, c2: boolean, numCh: number): WaveView {
    if (!c1 && !c2) return "silent";
    if (numCh < 2) return c1 ? "mono" : "silent";
    if (c1 && !c2) return "left";
    if (c2 && !c1) return "right";
    return "both";
  }

  function peaksFor(pk: Peaks, v: WaveView): (Float32Array | number[])[] {
    if (v === "both") return [pk.l, pk.r];
    if (v === "left") return [pk.l];
    if (v === "right") return [pk.r];
    if (v === "silent") return [new Float32Array(pk.l.length)];
    return [pk.mono];
  }

  // Reverse FX가 켜져 있으면 웨이브폼 미리보기도 실제 재생 순서(뒤집힌 순서)에 맞춰 보여준다.
  // peaksRef에 저장된 원본 피크 배열 순서는 항상 정방향(파일 원본 기준)이므로 여기서만 뒤집는다.
  function maybeReversePeaks(
    frames: (Float32Array | number[])[],
  ): (Float32Array | number[])[] {
    if (!fxRef.current.reversed) return frames;
    return frames.map((arr) =>
      arr instanceof Float32Array ? arr.slice().reverse() : [...arr].reverse(),
    );
  }

  // 필요 시(단일/모노 뷰) 채널별 피크를 지연 디코딩
  async function ensurePeaks(): Promise<Peaks | null> {
    if (peaksRef.current) return peaksRef.current;
    const t = trackRef.current;
    if (!t || !window.api) return null;
    try {
      const bytes = await readPcmBytesForDecode(t.filePath);
      peaksRef.current = await decodePeaks(bytes);
    } catch {
      peaksRef.current = null;
    }
    return peaksRef.current;
  }

  // ws.load(url)을 피크 없이 부르면 WaveSurfer가 그 URL을 fetch()로 직접 받아와 디코딩한다.
  // 그런데 개발 모드의 렌더러는 http:// 오리진이라 file:// URL은 fetch할 수 없어 이 호출이
  // 통째로 실패한다(blob: URL은 성공). Reverse를 끄고 원본 file:// URL로 되돌아가는 경로만
  // 정확히 여기에 걸려서, 로드가 조용히 실패하고 계속 역재생 상태로 남아 있었다.
  // 그러므로 어떤 경로에서든 항상 피크와 duration을 함께 넘긴다.
  async function loadWithPeaks(url: string, v: WaveView): Promise<void> {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const pk = peaksRef.current;
    if (pk) {
      await ws.load(url, maybeReversePeaks(peaksFor(pk, v)), pk.duration);
      return;
    }
    // 아직 디코딩 전이면 임시 평탄 피크로 로드해 둔다 (백그라운드 디코딩이 곧 교체한다)
    const fallbackDur =
      ws.getDuration() || (trackRef.current?.durationMs ?? 1000) / 1000;
    await ws.load(url, [new Float32Array(1200)], fallbackDur);
  }

  // 선택된 채널/모드에 맞춰 웨이브폼만 다시 그림 (재생 위치 유지)
  async function renderView(
    nCh1: boolean,
    nCh2: boolean,
    nMode: "stereo" | "mono",
  ): Promise<void> {
    const ws = wavesurferRef.current;
    const url = urlRef.current;
    if (!ws || !url) return;
    const pk = await ensurePeaks();
    const numCh = pk?.numCh ?? trackRef.current?.channels ?? 2;
    const v = viewFor(nCh1, nCh2, numCh);
    const wasPlaying = ws.isPlaying();
    const time = ws.getCurrentTime();
    const h = waveHeightsFor(panelHeightRef.current, chromeRef.current);
    try {
      ws.setOptions({
        height: v === "both" ? h.both : h.single,
        splitChannels:
          v === "both"
            ? [{ height: h.both }, { height: h.both }]
            : [{ height: h.single }],
      });
      await loadWithPeaks(url, v);
      ws.setPlaybackRate(
        fxRef.current.speedPct / 100,
        !fxRef.current.pitchLinked,
      );
      if (time > 0) ws.setTime(time);
      if (wasPlaying) await ws.play();
    } catch {
      /* noop */
    }
  }

  // ── Web Audio 채널 라우팅 (실제 solo / Mono·Stereo 오디오) ──
  // 채널 게인(g0/g1) 뒤에 분석용 탭(AnalyserNode)을 붙여 오른쪽 분석 패널이 실시간
  // Peak/Stereo Width를 읽어갈 수 있게 한다. 이 탭들은 destination에 연결하지 않으므로
  // 실제 재생 신호 경로/음량에는 전혀 영향을 주지 않는다.
  function ensureRoute(): Route | null {
    if (routeRef.current) return routeRef.current;
    const media = wavesurferRef.current?.getMediaElement();
    if (!media) return null;
    let ctx: AudioContext | null = null;
    let src: MediaElementAudioSourceNode | null = null;
    try {
      ctx = new AudioContext();
      // createMediaElementSource는 media 요소당 딱 한 번만 호출 가능하고, 호출하는 순간부터
      // media의 소리는 기본 출력 대신 이 그래프로만 흐른다. 따라서 이 아래 그래프 구성이
      // 실패하면 media는 어디에도 안 닿아 "재생은 되는데 소리만 없는" 영구 무음이 된다.
      src = ctx.createMediaElementSource(media);
      const splitter = ctx.createChannelSplitter(2);
      const g0 = ctx.createGain();
      const g1 = ctx.createGain();
      const merger = ctx.createChannelMerger(2);
      src.connect(splitter);
      splitter.connect(g0, 0);
      splitter.connect(g1, 1);
      merger.connect(ctx.destination);

      const analyserL = ctx.createAnalyser();
      analyserL.fftSize = 2048;
      const analyserR = ctx.createAnalyser();
      analyserR.fftSize = 2048;
      g0.connect(analyserL);
      g1.connect(analyserR);

      routeRef.current = { ctx, g0, g1, merger, analyserL, analyserR };
      return routeRef.current;
    } catch {
      // 그래프 구성 실패 — 하지만 createMediaElementSource가 이미 성공했다면 media는 기본
      // 출력이 끊긴 상태다. 소리가 사라지지 않도록 source를 destination에 직접 연결(폴백).
      // 분석 탭(채널 미터)은 못 쓰지만 재생 자체는 반드시 들리게 보장한다.
      if (src && ctx) {
        try {
          src.connect(ctx.destination);
        } catch {
          /* 이미 연결돼 있으면 무시 */
        }
      } else {
        void ctx?.close();
      }
      return null;
    }
  }

  function applyRoute(nCh1: boolean, nCh2: boolean): void {
    const r = ensureRoute();
    if (!r) return;
    void r.ctx.resume();
    // g0/g1은 merger(재생 출력) 외에도 분석 탭(analyserL/R, monoSum→LUFS)에 항상 연결돼
    // 있어야 하므로, 여기서는 merger로 가는 연결만 끊는다(disconnect()를 인자 없이 부르면
    // 분석 탭 연결까지 전부 끊겨 채널을 한 번이라도 토글하면 미터가 죽는 버그가 생김).
    try {
      r.g0.disconnect(r.merger);
    } catch {
      /* 원래 연결돼 있지 않았으면 예외 — 무시 */
    }
    try {
      r.g1.disconnect(r.merger);
    } catch {
      /* noop */
    }

    const isMonoFile = (trackRef.current?.channels ?? 2) < 2;
    if (isMonoFile) {
      r.g0.gain.value = nCh1 ? 1 : 0;
      r.g1.gain.value = 0;
      if (nCh1) {
        r.g0.connect(r.merger, 0, 0);
        r.g0.connect(r.merger, 0, 1);
      }
      return;
    }

    r.g0.gain.value = nCh1 ? 1 : 0;
    r.g1.gain.value = nCh2 ? 1 : 0;
    if (nCh1) r.g0.connect(r.merger, 0, 0);
    if (nCh2) r.g1.connect(r.merger, 0, 1);
  }

  function applyChannels(
    nCh1: boolean,
    nCh2: boolean,
    nMode: "stereo" | "mono",
  ): void {
    applyRoute(nCh1, nCh2); // 오디오
    void renderView(nCh1, nCh2, nMode); // 웨이브폼
  }

  function toggleCh1(): void {
    const v = !ch1;
    setCh1(v);
    setTimeout(() => applyChannels(v, ch2, mode), 0);
  }
  function toggleCh2(): void {
    const v = !ch2;
    setCh2(v);
    setTimeout(() => applyChannels(ch1, v, mode), 0);
  }
  function changeMode(next: "stereo" | "mono"): void {
    setMode(next);
    setTimeout(() => applyChannels(ch1, ch2, next), 0);
  }

  async function decodePeaks(bytes: Uint8Array): Promise<Peaks | null> {
    try {
      if (!decodeCtxRef.current) decodeCtxRef.current = new AudioContext();
      const buf = await decodeCtxRef.current.decodeAudioData(
        new Uint8Array(bytes).buffer,
      );
      const buckets = Math.min(
        6000,
        Math.max(1200, Math.floor(buf.duration * 90)),
      );
      const l = channelPeaks(buf.getChannelData(0), buckets);
      const r =
        buf.numberOfChannels > 1
          ? channelPeaks(buf.getChannelData(1), buckets)
          : l;
      const mono =
        buf.numberOfChannels > 1
          ? monoPeaks(buf.getChannelData(0), buf.getChannelData(1), buckets)
          : l;
      return {
        l,
        r,
        mono,
        duration: buf.duration,
        numCh: buf.numberOfChannels,
      };
    } catch (err) {
      // 여기가 조용하면 "파형이 안 그려지는데 이유를 알 수 없는" 상태가 된다. 재생 실패와
      // 같은 원인(디코더가 파일을 못 엶)인지 구분하는 데 이 로그가 필요하다.
      console.error(
        "waveform decode failed:",
        (err as Error)?.name,
        (err as Error)?.message,
        {
          track: trackRef.current?.filename,
          sampleRate: trackRef.current?.sampleRate,
          bitDepth: trackRef.current?.bitDepth,
          isFloat: trackRef.current?.isFloat,
          decodeRate: decodeCtxRef.current?.sampleRate,
        },
      );
      return null;
    }
  }

  // 구간 드래그 내보내기에 쓸 원본 해상도 AudioBuffer를 미리 디코딩해 캐시.
  // 실제 드래그 시작 시점에는 이미 준비돼 있어야 OS 드래그 제스처가 끊기지 않음.
  async function ensureFullBuffer(): Promise<AudioBuffer | null> {
    const t = trackRef.current;
    if (!t || !window.api) return null;
    if (rawBufferRef.current && rawBufferTrackIdRef.current === t.id)
      return rawBufferRef.current;
    // 같은 트랙 디코드가 이미 진행 중이면 그 프로미스를 공유한다 — 슬라이더를 빠르게
    // 드래그하면 캐시가 채워지기 전에 이 함수가 여러 번 불려 전체 파일 read+decode가
    // 동시에 쌓이고, 대용량 파일에서 렌더러가 멈춘다.
    if (fullBufferPromiseRef.current && fullBufferPromiseIdRef.current === t.id)
      return fullBufferPromiseRef.current;
    const promise = (async (): Promise<AudioBuffer | null> => {
      try {
        const bytes = await readPcmBytesForDecode(t.filePath);
        if (!decodeCtxRef.current) decodeCtxRef.current = new AudioContext();
        const buf = await decodeCtxRef.current.decodeAudioData(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
        );
        if (trackRef.current?.id === t.id) {
          rawBufferRef.current = buf;
          rawBufferTrackIdRef.current = t.id;
        }
        return buf;
      } catch {
        return null;
      }
    })();
    // 정리는 IIFE 밖의 .finally 콜백에서 한다 — IIFE 내부 finally에서 promise 자신을 신원
    // 비교하면 TS가 "초기화 식 안에서 대입 전 참조"로 오판(TS2454)하기 때문. 더 새로운(다른
    // 트랙) 디코드가 이 자리를 덮어썼다면 건드리지 않는다.
    void promise.finally(() => {
      if (fullBufferPromiseRef.current === promise) {
        fullBufferPromiseRef.current = null;
        fullBufferPromiseIdRef.current = null;
      }
    });
    fullBufferPromiseRef.current = promise;
    fullBufferPromiseIdRef.current = t.id;
    return promise;
  }

  // 현재 FX(reversed/독립 pitch) 상태를 반영한 오프라인 렌더링 결과 Blob URL을 만들어(또는
  // 캐시에서 재사용해) 반환한다. FX가 꺼져 있으면 null을 돌려줘 호출부가 원본 URL을 쓰게 한다.
  async function ensureProcessedUrl(): Promise<string | null> {
    const t = trackRef.current;
    if (!t) return null;
    const { reversed, pitchSemitones, pitchLinked } = fxRef.current;
    const needsPitch = !pitchLinked && pitchSemitones !== 0;
    if (!reversed && !needsPitch) return null;
    const key = `${t.id}:${reversed ? 1 : 0}:${needsPitch ? pitchSemitones : "0"}`;
    if (processedUrlRef.current && processedUrlKeyRef.current === key)
      return processedUrlRef.current;
    // 같은 FX 키의 렌더링이 진행 중이면 공유한다 — 디바운스가 뚫려(느린 WSOLA가 140ms를
    // 넘거나 드래그가 느릴 때) 렌더가 겹치면 pitchShift+WAV 인코딩을 중복 수행하고 서로의
    // Blob URL을 revoke해 재생이 끊길 수 있다.
    if (
      processedUrlPromiseRef.current &&
      processedUrlPromiseKeyRef.current === key
    )
      return processedUrlPromiseRef.current;
    const promise = (async (): Promise<string | null> => {
      const buf = await ensureFullBuffer();
      if (!buf || trackRef.current?.id !== t.id) return null;
      let channels: Float32Array[] = [];
      for (let ch = 0; ch < buf.numberOfChannels; ch++)
        channels.push(buf.getChannelData(ch));
      if (reversed) channels = reverseChannels(channels);
      if (needsPitch) channels = pitchShiftChannels(channels, pitchSemitones);
      const wavBytes = encodeWavFloat32(channels, buf.sampleRate);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(wavBytes)], { type: "audio/wav" }),
      );
      if (processedUrlRef.current) URL.revokeObjectURL(processedUrlRef.current);
      processedUrlRef.current = url;
      processedUrlKeyRef.current = key;
      return url;
    })();
    // 정리는 IIFE 밖의 .finally 콜백에서 (ensureFullBuffer와 같은 이유 — TS2454 회피).
    // 더 새로운(다른 키) 렌더링이 이 자리를 덮어썼다면 건드리지 않는다.
    void promise.finally(() => {
      if (processedUrlPromiseRef.current === promise) {
        processedUrlPromiseRef.current = null;
        processedUrlPromiseKeyRef.current = null;
      }
    });
    processedUrlPromiseRef.current = promise;
    processedUrlPromiseKeyRef.current = key;
    return promise;
  }

  // Waveform에서 선택 구간을 DAW로 드래그 — 구간이 없거나 너무 짧으면 아무 것도 하지 않음(안전 폴백)
  function handleRegionDragStart(e: React.DragEvent): void {
    e.preventDefault();
    const t = trackRef.current;
    const bounds = regionBounds;
    if (!t || !window.api || !bounds) return;
    if (bounds.end - bounds.start < MIN_REGION_SEC) return;
    const buf = rawBufferRef.current;
    if (!buf || rawBufferTrackIdRef.current !== t.id) return;
    try {
      const sliced = sliceAudioBuffer(buf, bounds.start, bounds.end);
      if (!sliced[0] || sliced[0].length === 0) return;
      const wavBytes = encodeWavFloat32(sliced, buf.sampleRate);
      const baseName = t.filename.replace(/\.[^.]+$/, "");
      window.api.startDragFromBuffer(wavBytes, `${baseName}_selection.wav`);
    } catch (err) {
      console.warn("구간 추출 실패:", (err as Error)?.message);
    }
  }

  useEffect(() => {
    const ws = wavesurferRef.current;
    if (!ws) return;
    const token = ++loadTokenRef.current;

    // 새 트랙을 로드하기까지는 파일 접근/피크 조회 등 비동기 단계가 남아 있고, WaveSurfer는
    // ws.load()가 "호출되는 시점"에야 이전 미디어를 멈춘다. 그때까지 이전 사운드가 계속
    // 들리므로, 클릭 즉시 여기서 먼저 끊는다. playingTrackIdRef를 먼저 비워 이 pause가
    // 떠나는 트랙의 위치를 새 트랙 키에 저장하지 않게 한다.
    playingTrackIdRef.current = null;
    try {
      ws.pause();
    } catch {
      /* noop */
    }
    // 대기 중이던 이전 트랙의 웨이브폼 디코딩 예약을 취소 (빠르게 넘길 때 디코딩 폭주 방지)
    window.clearTimeout(decodeTimerRef.current);

    setCurrent(0);
    setDuration(0);
    setLoadError(null);

    clearRegionSelection();
    setMarkers(track?.markers ?? []);
    rawBufferRef.current = null;
    rawBufferTrackIdRef.current = null;
    if (processedUrlRef.current) {
      URL.revokeObjectURL(processedUrlRef.current);
      processedUrlRef.current = null;
    }
    processedUrlKeyRef.current = null;

    if (!track || !window.api) {
      peaksRef.current = null;
      playingTrackIdRef.current = null;
      if (urlRef.current) urlRef.current = null;
      if (aiffBlobUrlRef.current) {
        URL.revokeObjectURL(aiffBlobUrlRef.current);
        aiffBlobUrlRef.current = null;
      }
      try {
        ws.empty();
      } catch {
        /* noop */
      }
      return;
    }

    peaksRef.current = null;
    let cancelled = false;

    const runLoad = async (): Promise<void> => {
      if (cancelled || token !== loadTokenRef.current) return;
      try {
        const access = await window.api!.getAudioAccess(track.filePath);
        if (cancelled || token !== loadTokenRef.current) return;

        // AIFF는 <audio>가 컨테이너를 이해하지 못해 file:// URL을 직접 재생할 수 없다 —
        // 파일을 통째로 읽어 WAV로 변환한 뒤 그 결과를 Blob URL로 재생한다.
        let playUrl = access.url;
        let aiffWavBytes: Uint8Array | null = null;
        if (isAiffPath(track.filePath)) {
          aiffWavBytes = await readPcmBytesForDecode(track.filePath);
          if (cancelled || token !== loadTokenRef.current) return;
          playUrl = URL.createObjectURL(
            new Blob([new Uint8Array(aiffWavBytes)], { type: "audio/wav" }),
          );
        }
        if (aiffBlobUrlRef.current) URL.revokeObjectURL(aiffBlobUrlRef.current);
        aiffBlobUrlRef.current = playUrl !== access.url ? playUrl : null;

        baseUrlRef.current = playUrl;
        prevReversedRef.current = fxRef.current.reversed;
        const effectiveUrl = (await ensureProcessedUrl()) ?? playUrl;
        if (cancelled || token !== loadTokenRef.current) return;
        urlRef.current = effectiveUrl;
        if (playUrl === access.url)
          preloadUrlCache.set(track.filePath, access.url);
        const key = audioCacheKey(track.filePath, access, track.fileHash);
        const cached = await getCachedPeaks(key);
        if (cancelled || token !== loadTokenRef.current) return;
        if (cached) peaksRef.current = cached;

        const durationSec =
          cached?.duration ?? (track.durationMs ? track.durationMs / 1000 : 1);
        const initialPeaks = cached
          ? maybeReversePeaks(peaksFor(cached, viewFor(ch1, ch2, cached.numCh)))
          : [new Float32Array(1200)];
        ws.setOptions({
          height:
            cached && viewFor(ch1, ch2, cached.numCh) === "both"
              ? waveHeightsFor(panelHeightRef.current, chromeRef.current).both
              : waveHeightsFor(panelHeightRef.current, chromeRef.current)
                  .single,
          splitChannels:
            cached && viewFor(ch1, ch2, cached.numCh) === "both"
              ? [
                  {
                    height: waveHeightsFor(
                      panelHeightRef.current,
                      chromeRef.current,
                    ).both,
                  },
                  {
                    height: waveHeightsFor(
                      panelHeightRef.current,
                      chromeRef.current,
                    ).both,
                  },
                ]
              : [
                  {
                    height: waveHeightsFor(
                      panelHeightRef.current,
                      chromeRef.current,
                    ).single,
                  },
                ],
        });
        await ws.load(effectiveUrl, initialPeaks, durationSec);
        if (cancelled || token !== loadTokenRef.current) return;
        // 이제부터 이 트랙이 실제로 물려 있다 — 재생 위치 저장 대상도 이 트랙이다
        playingTrackIdRef.current = track.id;

        ws.setVolume(effectiveVolumeRef.current);
        // ws.load()가 재생 속도를 기본값으로 되돌리므로, 트랙마다 저장된 Speed 설정을 다시 건다
        ws.setPlaybackRate(
          fxRef.current.speedPct / 100,
          !fxRef.current.pitchLinked,
        );

        // 구간(loop region)은 트랙에 저장/복원하지 않는다 — 다른 트랙으로 넘어갔다
        // 돌아와도 이전 드래그 흔적이 남지 않도록 항상 빈 상태로 시작한다.
        // 분석 패널이 첫 재생부터 실시간 레벨을 읽을 수 있도록, 채널 토글을 누르기 전에도
        // Web Audio 라우트(+분석 탭)를 미리 만들어 둔다
        ensureRoute();
        applyRoute(ch1, ch2);
        const saved = loadPlaybackPosition(track);
        if (
          playbackOptionsRef.current.startMode === "resume" &&
          saved > 0 &&
          saved < Math.max(0, ws.getDuration() - 0.05)
        )
          ws.setTime(saved);
        else ws.setTime(0);

        // 재생 시작을 기다리지 않는다 — media.play()의 프라미스는 실제로 소리가 나기
        // 시작해야 resolve 되므로, 이걸 await 하면 뒤따르는 작업이 그만큼 묶인다. 다음 트랙이
        // 곧바로 로드되면 이 play()는 AbortError로 거부되는데, 정상 흐름이므로 조용히 무시한다.
        if (playbackOptionsRef.current.autoPlayOnSelect) {
          void startPlayback().catch((err: Error) => {
            // AbortError는 위 주석대로 정상 흐름이다. 그 외(NotSupportedError 등)는
            // 실제 재생 실패이므로 삼키지 않는다 — 지금까지 무음의 주범이었다.
            if (
              /abort/i.test(err?.name ?? "") ||
              /abort/i.test(err?.message ?? "")
            )
              return;
            console.error("playback failed:", err?.name, err?.message, {
              track: trackRef.current?.filename,
              sampleRate: trackRef.current?.sampleRate,
              isFloat: trackRef.current?.isFloat,
            });
            setLoadError(err?.message || "재생을 시작할 수 없습니다");
          });
        }

        // 캐시가 없으면 실제 웨이브폼을 그리기 위해 파일 전체를 읽고 디코딩해야 한다. 이 작업을
        // 클릭마다 즉시 띄우면 리스트를 빠르게 훑을 때 전체 파일 읽기/디코딩이 동시에 쌓여
        // 렌더러와 IPC가 포화되고, 정작 방금 클릭한 트랙의 로드가 뒤로 밀린다. 선택이 잠잠해질
        // 때까지 기다렸다가 전역 체인에 붙여 항상 하나씩만 실행한다.
        if (!cached) {
          const runDecode = async (): Promise<void> => {
            if (cancelled || token !== loadTokenRef.current) return;
            try {
              // AIFF는 위에서 이미 WAV로 변환해뒀으니 재사용하고, 그 외 포맷만 새로 읽는다
              const bytes =
                aiffWavBytes ?? (await readPcmBytesForDecode(track.filePath));
              if (cancelled || token !== loadTokenRef.current) return;
              const pk = await decodePeaks(bytes);
              if (!pk) return;
              // 캐시는 낡은 요청이어도 저장해 둔다 — 다음에 이 트랙을 열 때 그대로 재사용된다
              await putCachedPeaks(key, pk);
              // 반면 peaksRef는 "현재 로드된 트랙"의 피크여야 한다. 가드 없이 대입하면 낡은
              // 트랙의 피크가 현재 트랙에 얹혀 채널 토글 시 다른 파일의 파형이 그려진다.
              if (cancelled || token !== loadTokenRef.current) return;
              peaksRef.current = pk;
              // 재생 중이어도(자동재생 켜짐+최초 디코딩) 실제 웨이브폼으로 반드시 교체한다.
              // 재생 위치/재생 상태를 캡처했다가 로드 후 복원해 재생이 끊기지 않게 한다.
              if (urlRef.current === effectiveUrl && wavesurferRef.current) {
                const ws2 = wavesurferRef.current;
                const wasPlaying = ws2.isPlaying();
                const time = ws2.getCurrentTime();
                const v = viewFor(ch1, ch2, pk.numCh);
                const h = waveHeightsFor(
                  panelHeightRef.current,
                  chromeRef.current,
                );
                ws2.setOptions({
                  height: v === "both" ? h.both : h.single,
                  splitChannels:
                    v === "both"
                      ? [{ height: h.both }, { height: h.both }]
                      : [{ height: h.single }],
                });
                await ws2.load(
                  effectiveUrl,
                  maybeReversePeaks(peaksFor(pk, v)),
                  pk.duration,
                );
                ws2.setPlaybackRate(
                  fxRef.current.speedPct / 100,
                  !fxRef.current.pitchLinked,
                );
                if (time > 0) ws2.setTime(time);
                if (wasPlaying) await ws2.play();
              }
            } catch (err) {
              console.warn("waveform cache failed:", (err as Error)?.message);
            }
          };
          window.clearTimeout(decodeTimerRef.current);
          decodeTimerRef.current = window.setTimeout(() => {
            decodeChainRef.current = decodeChainRef.current
              .catch(() => {})
              .then(runDecode);
          }, DECODE_IDLE_MS);
        }
      } catch (err) {
        if (!cancelled && token === loadTokenRef.current) {
          const msg = (err as Error)?.message ?? "";
          // AbortError는 트랙을 빠르게 넘길 때의 정상적인 취소이므로 무시한다.
          if (!/abort/i.test(msg)) {
            console.warn("audio load failed:", msg);
            setLoadError(msg || "알 수 없는 오류");
          }
        }
      }
    };
    void runLoad();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    track?.id,
    track?.filePath,
    track?.fileHash,
    track?.fileSize,
    track?.durationMs,
  ]);

  // 다른 트랙으로 넘어가면 방금 떠난 트랙의 "이어서 재생" 위치를 지운다 — resume 옵션이
  // 켜져 있어도 한 번 다른 사운드를 들었다가 돌아오면 항상 처음부터 재생되게 하기 위함.
  // 언마운트(cleanup)가 아니라 이전 트랙 id와의 비교로만 판단해야, PlayerBar가 실제로는
  // 트랙을 바꾸지 않고 재마운트되는 경우(StrictMode 등)에 resume 위치가 지워지지 않는다.
  useEffect(() => {
    const prevId = prevTrackIdRef.current;
    const nextId = track?.id ?? null;
    if (prevId != null && prevId !== nextId) clearPlaybackPositionById(prevId);
    prevTrackIdRef.current = nextId;
  }, [track?.id]);

  // 큐 배열 자체를 effect 의존성에 두면 안 된다 — queueTracks는 App의 visibleTracks라
  // 검색어 한 글자마다 새 배열이 되고, 그때마다 수십만 원소를 findIndex로 훑은 뒤
  // 프리로드 IPC까지 나간다. 재생 중인 트랙이 그대로면 이웃을 다시 계산할 이유가 없으므로
  // 큐는 ref로만 읽고, effect는 트랙이 실제로 바뀔 때만 돈다.
  const queueTracksRef = useRef(queueTracks);
  queueTracksRef.current = queueTracks;

  useEffect(() => {
    const queue = queueTracksRef.current;
    if (!track || !window.api || queue.length === 0) return;
    const idx = queue.findIndex((t) => t.id === track.id);
    if (idx < 0) return;
    let cancelled = false;
    const nearby = queue
      .slice(Math.max(0, idx - PRELOAD_RADIUS), idx + PRELOAD_RADIUS + 1)
      .filter((t) => t.id !== track.id);
    for (const item of nearby) {
      if (preloadUrlCache.has(item.filePath)) continue;
      void window.api
        .getAudioAccess(item.filePath)
        .then((access) => {
          if (cancelled) return;
          preloadUrlCache.set(item.filePath, access.url);
          const audio = new Audio(access.url);
          audio.preload = "auto";
          audio.load();
          touchPreloadAudio(item.filePath, audio);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [track?.id]);

  const stereoTrack = (track?.channels ?? 2) >= 2;

  function togglePlayback(): void {
    const ws = wavesurferRef.current;
    if (!ws) return;
    if (ws.isPlaying()) {
      savePlaybackPosition(ws.getCurrentTime());
      ws.pause();
    } else {
      void startPlayback();
    }
  }

  // Options 팝업이 열리면 버튼 좌표를 재어 fixed 위치를 잡는다. 팝업 폭은 CSS와 동일한
  // 220px 기준으로 버튼 오른쪽 끝에 맞춰 정렬하고, 버튼 위 6px에 바닥을 둔다. 창 크기가
  // 바뀌면 다시 잰다.
  useLayoutEffect(() => {
    if (!optionsOpen) {
      setOptMenuPos(null);
      return;
    }
    const OPT_MENU_WIDTH = 220;
    function place(): void {
      const btn = optBtnRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setOptMenuPos({
        left: Math.max(8, Math.round(r.right - OPT_MENU_WIDTH)),
        bottom: Math.round(window.innerHeight - r.top + 6),
      });
    }
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [optionsOpen]);

  // Click outside playback options menu to close it
  useEffect(() => {
    if (!optionsOpen) return;
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!target.closest(".player__options")) {
        setOptionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [optionsOpen]);

  const linkedSemitones = 12 * Math.log2(fx.speedPct / 100);
  const fxActive =
    fx.speedPct !== 100 || fx.pitchSemitones !== 0 || fx.reversed;

  // FX 묶음. 시간 표시 오른쪽에 놓이고, 펼치면 오른쪽으로 늘어난다.
  // 왼쪽 셀은 grid의 1fr + min-width:0이라 아무리 넓어져도 가운데 트랜스포트를 밀지 않는다.
  const fxControls = (
    <>
      <button
        className={`player__bar-toggle player__fxbar-toggle${fxOpen ? " player__bar-toggle--open" : ""}${fxActive ? " player__fxbar-toggle--active" : ""}`}
        onClick={toggleFxOpen}
        title={fxOpen ? "FX 컨트롤 접기" : "FX 컨트롤 펼치기"}
        aria-expanded={fxOpen}
      >
        <IconFx />
        FX
        {fxActive && !fxOpen && <span className="player__fx-dot" />}
        <IconChevronRight />
      </button>

      {/* 닫힌 상태에서도 DOM에 남겨 둬야 max-width 트랜지션이 걸린다.
          대신 hidden으로 포커스/클릭이 들어가지 않게 막는다. */}
      <div
        className={`player__slide-group${fxOpen ? " player__slide-group--open" : ""}`}
        aria-hidden={!fxOpen}
      >
        <div className="fx__ctl">
          <span className="fx__name">Speed</span>
          <input
            className="fx__slider"
            type="range"
            min={50}
            max={200}
            step={1}
            value={fx.speedPct}
            onChange={(e) =>
              updateFx({ speedPct: parseInt(e.target.value, 10) })
            }
          />
          <button
            className="fx__value fx__value--reset"
            title="1.00x로 초기화"
            onClick={() => updateFx({ speedPct: 100 })}
          >
            {(fx.speedPct / 100).toFixed(2)}x
          </button>
        </div>

        <div className="fx__ctl">
          <span className="fx__name">Pitch</span>
          <input
            className="fx__slider"
            type="range"
            min={-12}
            max={12}
            step={1}
            disabled={fx.pitchLinked}
            value={
              fx.pitchLinked ? Math.round(linkedSemitones) : fx.pitchSemitones
            }
            onChange={(e) =>
              updateFx({ pitchSemitones: parseInt(e.target.value, 10) })
            }
          />
          <button
            className="fx__value fx__value--reset"
            title="0 st로 초기화"
            disabled={fx.pitchLinked}
            onClick={() => updateFx({ pitchSemitones: 0 })}
          >
            {fx.pitchLinked
              ? `${linkedSemitones >= 0 ? "+" : ""}${linkedSemitones.toFixed(1)} st`
              : `${fx.pitchSemitones > 0 ? "+" : ""}${fx.pitchSemitones} st`}
          </button>
          <label
            className="fx__link"
            title="Link — 속도를 바꾸면 테이프처럼 피치도 함께 따라간다"
          >
            <input
              type="checkbox"
              checked={fx.pitchLinked}
              onChange={(e) => updateFx({ pitchLinked: e.target.checked })}
            />
          </label>
        </div>

        <button
          className={`fx__reverse-btn${fx.reversed ? " fx__reverse-btn--on" : ""}`}
          onClick={() => updateFx({ reversed: !fx.reversed })}
          title={fx.reversed ? "Reversed — 거꾸로 재생 중" : "Normal — 정방향"}
        >
          <ReverseGlyph flipped={fx.reversed} />
        </button>
      </div>
    </>
  );

  // Options / Stereo·Mono / Channel 묶음과 볼륨. 볼륨은 늘 맨 오른쪽 끝에 붙는다.
  // 토글 버튼은 볼륨 바로 왼쪽에 고정되고, 슬라이드 묶음을 버튼 앞(왼쪽)에 두어 펼치면
  // flex-end 정렬에 따라 왼쪽으로 늘어난다 — 왼쪽 FX 묶음이 오른쪽으로 열리는 것과 대칭.
  const rightControls = (
    <>
      <div
        className={`player__slide-group${rightOpen ? " player__slide-group--open" : ""}`}
        aria-hidden={!rightOpen}
      >
        <div className="player__options">
          <button
            ref={optBtnRef}
            className={`player__opt-btn${optionsOpen ? " player__opt-btn--open" : ""}`}
            title="Playback options"
            onClick={() => setOptionsOpen((v) => !v)}
          >
            Options
          </button>
          {optionsOpen && optMenuPos && (
            <div
              className="player__opt-menu"
              style={{
                position: "fixed",
                left: optMenuPos.left,
                bottom: optMenuPos.bottom,
                right: "auto",
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="player__opt-section">Start</div>
              <label className="player__opt-item">
                <input
                  type="radio"
                  name="startMode"
                  checked={playbackOptions.startMode === "resume"}
                  onChange={() =>
                    updatePlaybackOptions({ startMode: "resume" })
                  }
                />
                Resume last position
              </label>
              <label className="player__opt-item">
                <input
                  type="radio"
                  name="startMode"
                  checked={playbackOptions.startMode === "start"}
                  onChange={() => updatePlaybackOptions({ startMode: "start" })}
                />
                Always start at 0:00
              </label>
              <label className="player__opt-item">
                <input
                  type="radio"
                  name="startMode"
                  checked={playbackOptions.startMode === "selectionStart"}
                  onChange={() =>
                    updatePlaybackOptions({ startMode: "selectionStart" })
                  }
                />
                Start from selection
              </label>
              <div className="player__opt-section">Playback</div>
              <label className="player__opt-item">
                <input
                  type="checkbox"
                  checked={playbackOptions.selectionLoop}
                  onChange={(e) =>
                    updatePlaybackOptions({ selectionLoop: e.target.checked })
                  }
                />
                Loop selected range
              </label>
              <label className="player__opt-item">
                <input
                  type="checkbox"
                  checked={playbackOptions.returnToStartOnStop}
                  onChange={(e) =>
                    updatePlaybackOptions({
                      returnToStartOnStop: e.target.checked,
                    })
                  }
                />
                Return to start position on stop
              </label>
              <label className="player__opt-item">
                <input
                  type="checkbox"
                  checked={playbackOptions.autoPlayOnSelect}
                  onChange={(e) =>
                    updatePlaybackOptions({
                      autoPlayOnSelect: e.target.checked,
                    })
                  }
                />
                Auto play on select
              </label>
              <div className="player__opt-section">Queue</div>
              <label className="player__opt-item">
                <input
                  type="radio"
                  name="queueMode"
                  checked={playbackOptions.queueMode === "single"}
                  onChange={() =>
                    updatePlaybackOptions({ queueMode: "single" })
                  }
                />
                Single
              </label>
              <label className="player__opt-item">
                <input
                  type="radio"
                  name="queueMode"
                  checked={playbackOptions.queueMode === "continuous"}
                  onChange={() =>
                    updatePlaybackOptions({ queueMode: "continuous" })
                  }
                />
                Continuous
              </label>
            </div>
          )}
        </div>

        <select
          className="player__mode"
          value={mode}
          onChange={(e) => changeMode(e.target.value as "stereo" | "mono")}
          title="Mono / Stereo"
        >
          <option value="stereo">Stereo</option>
          <option value="mono">Mono</option>
        </select>

        <div className="player__channels">
          <button
            className={`player__chip${ch1 ? " player__chip--on" : ""}`}
            onClick={toggleCh1}
            disabled={!track}
            title="채널 1 (왼쪽)"
          >
            Channel 1
          </button>
          <button
            className={`player__chip${ch2 && stereoTrack ? " player__chip--on" : ""}`}
            onClick={toggleCh2}
            disabled={!stereoTrack}
            title={stereoTrack ? "채널 2 (오른쪽)" : "모노 파일 (채널 2 없음)"}
          >
            Channel 2
          </button>
        </div>
      </div>

      <button
        className={`player__bar-toggle player__bar-toggle--reverse${rightOpen ? " player__bar-toggle--open" : ""}`}
        onClick={toggleRightOpen}
        title={
          rightOpen ? "Options / Channel 접기" : "Options / Channel 펼치기"
        }
        aria-label="Playback options and channel controls"
        aria-expanded={rightOpen}
      >
        <IconChevronRight />
        <IconSliders />
      </button>

      {/* 볼륨은 접지 않는다 — 미리듣기 중 가장 자주 손이 가는 컨트롤이다 */}
      <div className={`player__vol${muted ? " player__vol--muted" : ""}`}>
        <button
          className="player__vol-btn"
          onClick={() => setMuted((v) => !v)}
          title={muted ? "음소거 해제" : "음소거"}
          aria-pressed={muted}
        >
          {muted ? <IconVolumeMuted /> : <IconVolume />}
        </button>
        <input
          className="player__slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          // 슬라이더를 움직이면 뮤트를 푼다 — 소리가 안 나는 채로 값만 바뀌면 고장으로 보인다
          onChange={(e) => {
            setVolume(parseFloat(e.target.value));
            setMuted(false);
          }}
        />
        <span className="player__vol-val">{Math.round(volume * 100)}%</span>
      </div>
    </>
  );

  return (
    <div className={`player${dockMode ? " player--dock" : ""}`}>
      <div className="player__wave-band" ref={waveBandRef}>
        <div
          className={`player__waveform${track && !ch1 && !ch2 ? " is-muted" : ""}`}
          ref={containerRef}
        />
        {!track && (
          <div className="player__wave-empty">Select a sound to preview</div>
        )}
        {track && !ch1 && !ch2 && (
          <div className="player__wave-empty">Muted</div>
        )}
        {track && loadError && (
          <div className="player__wave-error" title={loadError}>
            ⚠ 재생 불가: {loadError}
          </div>
        )}
        {regionBounds &&
          duration > 0 &&
          regionBounds.end - regionBounds.start >= MIN_REGION_SEC && (
            <div
              className="player__region-drag"
              style={{
                left: `${((regionBounds.start + regionBounds.end) / 2 / duration) * 100}%`,
              }}
              draggable
              onDragStart={handleRegionDragStart}
              title="Drag selected range"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 6h13M8 12h13M8 18h13" />
                <circle
                  cx="3"
                  cy="6"
                  r="1.5"
                  fill="currentColor"
                  stroke="none"
                />
                <circle
                  cx="3"
                  cy="12"
                  r="1.5"
                  fill="currentColor"
                  stroke="none"
                />
                <circle
                  cx="3"
                  cy="18"
                  r="1.5"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
              Drag range
            </div>
          )}
        {duration > 0 &&
          markers.map((m) => (
            <div
              key={m}
              className="player__marker"
              style={{ left: `${(m / duration) * 100}%` }}
              onClick={() => wavesurferRef.current?.setTime(m)}
              onContextMenu={(e) => {
                e.preventDefault();
                removeMarker(m);
              }}
              title={`Marker @ ${fmt(m)} — click: jump, right-click: remove`}
            />
          ))}
      </div>

      <div className="player__controls">
        <div className="player__info">
          <span className="player__time">{fmt(current)}</span>
          <span className="player__dur">{fmt(duration)}</span>
          {fxControls}
        </div>

        <div className="player__transport">
          <button
            className={`player__tbtn${loop ? " player__tbtn--on" : ""}`}
            title="반복"
            onClick={() => setLoop((v) => !v)}
          >
            <IconLoop />
          </button>
          <button
            className={`player__tbtn${playbackOptions.selectionLoop ? " player__tbtn--on" : ""}`}
            title="구간 반복 (A-B Loop) — 웨이브폼에 구간을 드래그한 뒤 사용 (L)"
            disabled={
              !regionBounds ||
              regionBounds.end - regionBounds.start < MIN_REGION_SEC
            }
            onClick={toggleLoopRegion}
          >
            <IconLoopRegion />
          </button>
          <button
            className="player__tbtn"
            title="현재 위치에 마커 추가 (M)"
            disabled={!track}
            onClick={addMarkerAtCurrentTime}
          >
            <IconMarker />
          </button>
          <button className="player__tbtn" title="이전 (↑)" onClick={onPrev}>
            <IconPrev />
          </button>
          <button
            className="player__tbtn player__tbtn--play"
            title="재생 / 일시정지 (Space)"
            disabled={!track}
            onClick={togglePlayback}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>
          <button className="player__tbtn" title="다음 (↓)" onClick={onNext}>
            <IconNext />
          </button>
          <button className="player__tbtn" title="정지" onClick={stopPlayback}>
            <IconStop />
          </button>
        </div>

        <div className="player__right">{rightControls}</div>
      </div>
    </div>
  );
});

// onTrackPersisted/onPrev/onNext는 App.tsx에서 useStableCallback으로 고정돼 오므로, 이
// 컴포넌트도 memo로 감싸야 재생 위치 갱신과 무관한 App 리렌더에서 여기까지 다시 그리지 않는다.
export default memo(PlayerBar);
