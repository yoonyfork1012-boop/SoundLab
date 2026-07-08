import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import type { Track } from '@shared/types'
import { encodeWavFloat32, sliceAudioBuffer } from '../../lib/wavEncoder'
import { audioCacheKey, type AudioAccess } from '../../lib/audioCacheKey'
import { decodeAiffToWav, isAiffPath } from '../../lib/aiffDecoder'

const MIN_REGION_SEC = 0.05
const PLAYBACK_OPTIONS_KEY = 'soundlib.playbackOptions'
const FX_OPTIONS_KEY = 'soundlib.fxOptions'
const WAVE_COLOR = 'rgba(245, 247, 250, 0.82)'
const PLAYHEAD_COLOR = '#ffffff'
const WAVE_CACHE_DB = 'soundlib-wave-cache'
const WAVE_CACHE_STORE = 'peaks'
const PRELOAD_RADIUS = 3
// 세션 중 미리듣기한 트랙이 아주 많아져도(수천 개 라이브러리) 피크 메모리 캐시가
// 무한정 커지지 않도록 LRU로 상한을 둔다. 디스크(IndexedDB) 캐시는 상한 없이 유지된다.
const MAX_MEMORY_PEAKS = 300

type StartMode = 'resume' | 'start'
type QueueMode = 'single' | 'continuous'

interface PlaybackOptions {
  startMode: StartMode
  selectionLoop: boolean
  autoPlayOnSelect: boolean
  queueMode: QueueMode
}

const DEFAULT_PLAYBACK_OPTIONS: PlaybackOptions = {
  startMode: 'resume',
  selectionLoop: false,
  autoPlayOnSelect: true,
  queueMode: 'single'
}

function loadPlaybackOptions(): PlaybackOptions {
  try {
    const raw = localStorage.getItem(PLAYBACK_OPTIONS_KEY)
    if (!raw) return DEFAULT_PLAYBACK_OPTIONS
    return { ...DEFAULT_PLAYBACK_OPTIONS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_PLAYBACK_OPTIONS
  }
}

function savePlaybackOptions(options: PlaybackOptions): void {
  try {
    localStorage.setItem(PLAYBACK_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    /* noop */
  }
}

interface FxOptions {
  speedPct: number // 50-200, wired to real playback rate
  pitchSemitones: number // -12..12, UI preview only (독립 피치 시프트 DSP는 추후 구현)
  pitchLinked: boolean // true = "tape" varispeed: 속도 변화에 피치가 자연스럽게 따라감 (실제 재생에 반영)
  reversed: boolean // UI 프리뷰만 — 역재생 렌더링은 추후 구현
}

const DEFAULT_FX_OPTIONS: FxOptions = { speedPct: 100, pitchSemitones: 0, pitchLinked: false, reversed: false }

function loadFxOptions(): FxOptions {
  try {
    const raw = localStorage.getItem(FX_OPTIONS_KEY)
    if (!raw) return DEFAULT_FX_OPTIONS
    return { ...DEFAULT_FX_OPTIONS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_FX_OPTIONS
  }
}

function saveFxOptions(options: FxOptions): void {
  try {
    localStorage.setItem(FX_OPTIONS_KEY, JSON.stringify(options))
  } catch {
    /* noop */
  }
}

// 디코딩(WaveSurfer/Web Audio) 목적으로 파일 바이트를 읽는 단일 지점 — AIFF는 브라우저가
// 컨테이너 자체를 이해하지 못하므로 여기서 항상 WAV로 먼저 변환해 넘긴다.
async function readPcmBytesForDecode(filePath: string): Promise<Uint8Array> {
  const raw = await window.api!.readAudioFile(filePath)
  const bytes = new Uint8Array(raw)
  return isAiffPath(filePath) ? decodeAiffToWav(bytes) : bytes
}

// 플레이어 패널 전체 높이에서 컨트롤바/여백을 뺀 웨이브폼 가용 높이를 계산해,
// 스테레오(2채널 스택)/단일 채널 각각의 렌더 높이를 구한다. 패널을 키우면 웨이브폼도 커짐.
function waveHeightsFor(panelHeight: number): { both: number; single: number } {
  const waveArea = Math.max(40, panelHeight - 54 /* controls */ - 14 /* padding */)
  return {
    both: Math.max(16, Math.floor((waveArea - 2) / 2)),
    single: Math.max(28, waveArea)
  }
}

interface PlayerBarProps {
  track: Track | null
  accent: string
  panelHeight: number
  onPrev: () => void
  onNext: () => void
  queueTracks?: Track[]
  dockMode?: boolean
}

export interface MeterTap {
  analyserL: AnalyserNode
  analyserR: AnalyserNode
  isMono: boolean
  // AnalyserNode는 미디어가 멈춰도(pause/stop) 새 샘플이 안 들어올 뿐 마지막으로 받은
  // 값을 계속 돌려준다 — 그래서 재생 중인지 여부를 별도로 알려줘야 분석 패널이 "정지 후에도
  // 미터가 멈춘 값으로 얼어붙는" 문제 없이 무음으로 취급할 수 있다.
  isPlaying: boolean
}

// App의 키보드 단축키(Space/Enter/Esc)가 플레이어를 제어할 수 있도록 노출하는 명령형 핸들
export interface PlayerHandle {
  playPause: () => void
  play: () => void
  stopAndClear: () => void
  // 오른쪽 분석 패널(AnalysisPanel)이 실시간 레벨을 읽어가는 AnalyserNode 탭.
  // 아직 재생 그래프가 생성되지 않았으면(트랙을 한 번도 재생하지 않음) null.
  getMeterTap: () => MeterTap | null
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00.00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  const cs = Math.floor((sec % 1) * 100)
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
}

// 채널 데이터 → 다운샘플된 피크(막대 높이) 배열
function channelPeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const size = Math.max(1, Math.floor(data.length / buckets))
  for (let i = 0; i < buckets; i++) {
    let max = 0
    const start = i * size
    const end = Math.min(start + size, data.length)
    for (let j = start; j < end; j++) {
      const a = Math.abs(data[j])
      if (a > max) max = a
    }
    out[i] = max
  }
  return out
}

function monoPeaks(l: Float32Array, r: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets)
  const len = Math.min(l.length, r.length)
  const size = Math.max(1, Math.floor(len / buckets))
  for (let i = 0; i < buckets; i++) {
    let max = 0
    const start = i * size
    const end = Math.min(start + size, len)
    for (let j = start; j < end; j++) {
      const a = Math.abs((l[j] + r[j]) * 0.5)
      if (a > max) max = a
    }
    out[i] = max
  }
  return out
}

interface Peaks {
  l: Float32Array
  r: Float32Array
  mono: Float32Array
  duration: number
  numCh: number
}

interface WaveCacheRecord extends Peaks {
  key: string
}

interface Route {
  ctx: AudioContext
  g0: GainNode
  g1: GainNode
  merger: ChannelMergerNode
  // 실시간 분석 패널(Peak/Stereo Width)이 읽어가는 탭 — 오디오 그래프의 부산물로만
  // 존재하며 destination에는 연결하지 않는다(신호 경로/음량에는 영향 없음)
  analyserL: AnalyserNode
  analyserR: AnalyserNode
}

type WaveView = 'both' | 'left' | 'right' | 'mono' | 'silent'


let waveCacheDbPromise: Promise<IDBDatabase> | null = null
const memoryPeakCache = new Map<string, Peaks>()
const preloadUrlCache = new Map<string, string>()

function openWaveCacheDb(): Promise<IDBDatabase> {
  if (waveCacheDbPromise) return waveCacheDbPromise
  waveCacheDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(WAVE_CACHE_DB, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(WAVE_CACHE_STORE)) req.result.createObjectStore(WAVE_CACHE_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return waveCacheDbPromise
}

// Map은 삽입 순서를 보존하므로, 읽거나 쓸 때마다 delete 후 재삽입해 항상 "가장 최근 사용"이
// 끝에 오도록 유지한다. 상한을 넘으면 맨 앞(가장 오래 전에 쓰인) 항목부터 제거한다.
function touchMemoryPeaks(key: string, peaks: Peaks): void {
  memoryPeakCache.delete(key)
  memoryPeakCache.set(key, peaks)
  while (memoryPeakCache.size > MAX_MEMORY_PEAKS) {
    const oldest = memoryPeakCache.keys().next().value
    if (oldest === undefined) break
    memoryPeakCache.delete(oldest)
  }
}

async function getCachedPeaks(key: string): Promise<Peaks | null> {
  const mem = memoryPeakCache.get(key)
  if (mem) {
    touchMemoryPeaks(key, mem)
    return mem
  }
  try {
    const db = await openWaveCacheDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(WAVE_CACHE_STORE, 'readonly')
      const req = tx.objectStore(WAVE_CACHE_STORE).get(key)
      req.onsuccess = () => {
        const row = req.result as WaveCacheRecord | undefined
        if (!row) return resolve(null)
        const peaks: Peaks = { l: row.l, r: row.r, mono: row.mono, duration: row.duration, numCh: row.numCh }
        touchMemoryPeaks(key, peaks)
        resolve(peaks)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function putCachedPeaks(key: string, peaks: Peaks): Promise<void> {
  touchMemoryPeaks(key, peaks)
  try {
    const db = await openWaveCacheDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(WAVE_CACHE_STORE, 'readwrite')
      tx.objectStore(WAVE_CACHE_STORE).put({ key, ...peaks })
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* noop */
  }
}

// 통일된 트랜스포트 아이콘
const IconLoop = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const IconPrev = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18 5v14l-11-7z" />
    <rect x="5" y="5" width="2" height="14" rx="1" />
  </svg>
)
const IconNext = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 5v14l11-7z" />
    <rect x="17" y="5" width="2" height="14" rx="1" />
  </svg>
)
const IconPlay = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7 4v16l13-8z" />
  </svg>
)
const IconPause = (): JSX.Element => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="4" width="4.5" height="16" rx="1.2" />
    <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" />
  </svg>
)
const IconStop = (): JSX.Element => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2.5" />
  </svg>
)
const IconFx = (): JSX.Element => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 21V14" /><path d="M4 10V3" /><circle cx="4" cy="12" r="2" />
    <path d="M12 21V16" /><path d="M12 12V3" /><circle cx="12" cy="14" r="2" />
    <path d="M20 21V10" /><path d="M20 6V3" /><circle cx="20" cy="8" r="2" />
  </svg>
)
// Reverse 토글의 시각적 시그니처 — 오름차순 막대(정재생)가 켜지면 좌우로 뒤집힌다(역재생)
function ReverseGlyph({ flipped }: { flipped: boolean }): JSX.Element {
  const heights = [4, 7, 11, 15, 9, 6]
  return (
    <svg width="26" height="15" viewBox="0 0 26 15" style={{ transform: flipped ? 'scaleX(-1)' : 'none', transition: 'transform 0.22s var(--ease)' }}>
      {heights.map((h, i) => (
        <rect key={i} x={i * 4.4} y={15 - h} width="3" height={h} rx="1" fill="currentColor" />
      ))}
    </svg>
  )
}

const PlayerBar = forwardRef<PlayerHandle, PlayerBarProps>(function PlayerBar(
  { track, accent, panelHeight, onPrev, onNext, queueTracks = [], dockMode = false },
  ref
) {
  const waveBandRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // 현재 패널 높이에 따른 웨이브폼 높이 (setOptions에 항상 이 값을 사용)
  const panelHeightRef = useRef(panelHeight)
  panelHeightRef.current = panelHeight
  const waveH = waveHeightsFor(panelHeight)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const loadTokenRef = useRef(0)
  const routeRef = useRef<Route | null>(null)
  const decodeCtxRef = useRef<AudioContext | null>(null)
  const peaksRef = useRef<Peaks | null>(null)
  const urlRef = useRef<string | null>(null)
  // AIFF는 file:// URL을 직접 재생할 수 없어 WAV로 변환한 Blob URL을 쓴다 — 파일 URL과 달리
  // 명시적으로 revoke해야 메모리가 안 새므로 트랙이 바뀔 때마다/언마운트 시 여기서 정리한다
  const aiffBlobUrlRef = useRef<string | null>(null)
  const regionsPluginRef = useRef<RegionsPlugin | null>(null)
  const activeRegionRef = useRef<Region | null>(null)
  // 구간 드래그(DAW export)용 원본 해상도 디코딩 캐시 — peaksRef(다운샘플)와는 별개로 유지
  const rawBufferRef = useRef<AudioBuffer | null>(null)
  const rawBufferTrackIdRef = useRef<number | null>(null)
  const [regionBounds, setRegionBounds] = useState<{ start: number; end: number } | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  // wavesurfer.isPlaying()를 매 애니메이션 프레임 직접 호출하면 stop() 후 재생을 다시
  // 시작했을 때 잠깐(혹은 계속) 실제 상태와 어긋나는 경우가 있어, 'play'/'pause'/'finish'
  // 이벤트로만 갱신되는 이 ref를 분석 패널의 실제 재생 여부 판단 기준으로 쓴다.
  const isPlayingRef = useRef(false)
  const [loop, setLoop] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [ch1, setCh1] = useState(true)
  const [ch2, setCh2] = useState(true)
  const [mode, setMode] = useState<'stereo' | 'mono'>('stereo')
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [playbackOptions, setPlaybackOptions] = useState<PlaybackOptions>(() => loadPlaybackOptions())
  const [fxOpen, setFxOpen] = useState(false)
  const [fx, setFx] = useState<FxOptions>(() => loadFxOptions())
  const fxRef = useRef(fx)
  fxRef.current = fx
  const loopRef = useRef(loop)
  loopRef.current = loop
  const playbackOptionsRef = useRef(playbackOptions)
  playbackOptionsRef.current = playbackOptions
  const regionBoundsRef = useRef(regionBounds)
  regionBoundsRef.current = regionBounds
  const trackRef = useRef(track)
  trackRef.current = track

  function updatePlaybackOptions(patch: Partial<PlaybackOptions>): void {
    setPlaybackOptions((prev) => {
      const next = { ...prev, ...patch }
      savePlaybackOptions(next)
      return next
    })
  }

  function updateFx(patch: Partial<FxOptions>): void {
    setFx((prev) => {
      const next = { ...prev, ...patch }
      saveFxOptions(next)
      return next
    })
  }

  function positionKey(t: Track | null = trackRef.current): string | null {
    return t ? `soundlib.playbackPosition.${t.id}` : null
  }

  function savePlaybackPosition(time?: number): void {
    const key = positionKey()
    const ws = wavesurferRef.current
    if (!key || !ws) return
    const value = Number.isFinite(time) ? time! : ws.getCurrentTime()
    try {
      localStorage.setItem(key, String(Math.max(0, value)))
    } catch {
      /* noop */
    }
  }

  function loadPlaybackPosition(t: Track | null = trackRef.current): number {
    const key = positionKey(t)
    if (!key) return 0
    const value = Number(localStorage.getItem(key) ?? 0)
    return Number.isFinite(value) ? Math.max(0, value) : 0
  }

  async function startPlayback(forceStart = false): Promise<void> {
    const ws = wavesurferRef.current
    if (!ws || !trackRef.current) return
    const bounds = regionBoundsRef.current
    if (playbackOptionsRef.current.selectionLoop && bounds && bounds.end - bounds.start >= MIN_REGION_SEC) {
      ws.setTime(bounds.start)
    } else if (forceStart || playbackOptionsRef.current.startMode === 'start') {
      ws.setTime(0)
    } else if (!ws.isPlaying()) {
      const saved = loadPlaybackPosition()
      const dur = ws.getDuration()
      if (saved > 0 && (!dur || saved < Math.max(0, dur - 0.05))) ws.setTime(saved)
    }
    await ws.play()
  }

  function stopPlayback(): void {
    const ws = wavesurferRef.current
    if (!ws) return
    savePlaybackPosition(ws.getCurrentTime())
    ws.stop()
    // ws.stop()이 내부적으로 'pause' 이벤트를 안정적으로 쏘지 않는 경우가 있어(재생을 다시
    // 시작해도 분석 패널이 계속 무음으로 판단하던 버그의 원인), 여기서도 명시적으로 갱신한다
    isPlayingRef.current = false
  }

  function clearRegionSelection(): void {
    regionsPluginRef.current?.clearRegions()
    activeRegionRef.current = null
    setRegionBounds(null)
  }

  useEffect(() => {
    if (!containerRef.current) return
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
      splitChannels: [{ height: waveH.both }, { height: waveH.both }]
    })
    ws.on('play', () => {
      setIsPlaying(true)
      isPlayingRef.current = true
    })
    ws.on('pause', () => {
      setIsPlaying(false)
      isPlayingRef.current = false
      savePlaybackPosition(ws.getCurrentTime())
    })
    ws.on('timeupdate', (t: number) => {
      setCurrent(t)
      const bounds = regionBoundsRef.current
      if (playbackOptionsRef.current.selectionLoop && bounds && bounds.end - bounds.start >= MIN_REGION_SEC && t >= bounds.end) {
        ws.setTime(bounds.start)
        if (ws.isPlaying()) void ws.play()
      }
    })
    // 사용자가 파형을 클릭/드래그해 직접 이동한 위치 — 'timeupdate'와 달리 프로그램적
    // seek(setTime)가 아니라 사용자 상호작용에서만 발생한다. 이 값을 즉시 저장해두지
    // 않으면, 정지(Stop) 후 클릭으로 새 위치를 잡아도 startPlayback()의 "resume" 로직이
    // localStorage에 남아있던 정지 시점의 예전 위치를 읽어와 클릭 위치를 덮어써버린다.
    ws.on('interaction', (newTime: number) => {
      savePlaybackPosition(newTime)
    })
    ws.on('ready', () => setDuration(ws.getDuration()))
    ws.on('finish', () => {
      savePlaybackPosition(ws.getDuration())
      const bounds = regionBoundsRef.current
      if (playbackOptionsRef.current.selectionLoop && bounds && bounds.end - bounds.start >= MIN_REGION_SEC) {
        ws.setTime(bounds.start)
        void ws.play()
        return
      }
      if (loopRef.current) {
        ws.setTime(0)
        void ws.play()
        return
      }
      setIsPlaying(false)
      isPlayingRef.current = false
      if (playbackOptionsRef.current.queueMode === 'continuous') onNext()
    })

    // Waveform 구간 선택(드래그로 생성/리사이즈) — 선택 구간만 DAW로 드래그 내보내기 위한 기반
    const regions = ws.registerPlugin(RegionsPlugin.create())
    regionsPluginRef.current = regions
    regions.enableDragSelection({ color: 'rgba(255, 255, 255, 0.22)' })
    regions.on('region-created', (region) => {
      // 한 번에 하나의 구간만 유지 (새로 그리면 이전 선택은 제거)
      for (const r of regions.getRegions()) {
        if (r.id !== region.id) r.remove()
      }
      activeRegionRef.current = region
      setRegionBounds({ start: region.start, end: region.end })
      void ensureFullBuffer()
    })
    regions.on('region-update', (region) => {
      activeRegionRef.current = region
      setRegionBounds({ start: region.start, end: region.end })
    })
    regions.on('region-removed', (region) => {
      if (activeRegionRef.current?.id === region.id) {
        activeRegionRef.current = null
        setRegionBounds(null)
      }
    })

    wavesurferRef.current = ws
    return () => {
      const route = routeRef.current
      routeRef.current = null
      void route?.ctx.close()
      const decodeCtx = decodeCtxRef.current
      decodeCtxRef.current = null
      void decodeCtx?.close()
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      ws.destroy()
      wavesurferRef.current = null
      regionsPluginRef.current = null
    }
  }, [])

  useEffect(() => {
    wavesurferRef.current?.setOptions({ waveColor: WAVE_COLOR, progressColor: WAVE_COLOR, cursorColor: PLAYHEAD_COLOR })
  }, [accent])

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

  // Speed는 브라우저 네이티브 playbackRate로 실제 재생에 반영된다. pitchLinked가 켜지면
  // preservePitch=false를 줘서 속도 변화에 피치가 테이프처럼 자연스럽게 따라가게 한다
  // (독립적인 피치 전용 시프트는 페이즈 보코더가 필요해 이후 단계로 남겨둔다).
  useEffect(() => {
    wavesurferRef.current?.setPlaybackRate(fx.speedPct / 100, !fx.pitchLinked)
  }, [fx.speedPct, fx.pitchLinked])

  useEffect(() => {
    if (!fxOpen) return
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!target.closest('.player__fx')) setFxOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [fxOpen])

  // 패널 높이가 바뀌면 웨이브폼을 새 높이로 다시 그림 (드래그 중 과도한 리로드 방지 위해 디바운스)
  useEffect(() => {
    if (!wavesurferRef.current || !urlRef.current) return
    const id = window.setTimeout(() => {
      void renderView(ch1, ch2, mode)
    }, 130)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelHeight])

  // App 키보드 단축키가 호출하는 명령형 제어 (재생/일시정지, 재생, 정지+구간해제)
  useImperativeHandle(ref, () => ({
    playPause: togglePlayback,
    play: () => {
      void startPlayback()
    },
    stopAndClear: () => {
      stopPlayback()
      clearRegionSelection()
    },
    getMeterTap: () => {
      const r = routeRef.current
      if (!r) return null
      return {
        analyserL: r.analyserL,
        analyserR: r.analyserR,
        isMono: (trackRef.current?.channels ?? 2) < 2,
        isPlaying: isPlayingRef.current
      }
    }
  }))

  // 현재 채널/모드 → 웨이브폼 뷰
  function viewFor(c1: boolean, c2: boolean, numCh: number): WaveView {
    if (!c1 && !c2) return 'silent'
    if (numCh < 2) return c1 ? 'mono' : 'silent'
    if (c1 && !c2) return 'left'
    if (c2 && !c1) return 'right'
    return 'both'
  }

  function peaksFor(pk: Peaks, v: WaveView): (Float32Array | number[])[] {
    if (v === 'both') return [pk.l, pk.r]
    if (v === 'left') return [pk.l]
    if (v === 'right') return [pk.r]
    if (v === 'silent') return [new Float32Array(pk.l.length)]
    return [pk.mono]
  }

  // 필요 시(단일/모노 뷰) 채널별 피크를 지연 디코딩
  async function ensurePeaks(): Promise<Peaks | null> {
    if (peaksRef.current) return peaksRef.current
    const t = trackRef.current
    if (!t || !window.api) return null
    try {
      const bytes = await readPcmBytesForDecode(t.filePath)
      peaksRef.current = await decodePeaks(bytes)
    } catch {
      peaksRef.current = null
    }
    return peaksRef.current
  }

  // 선택된 채널/모드에 맞춰 웨이브폼만 다시 그림 (재생 위치 유지)
  async function renderView(nCh1: boolean, nCh2: boolean, nMode: 'stereo' | 'mono'): Promise<void> {
    const ws = wavesurferRef.current
    const url = urlRef.current
    if (!ws || !url) return
    const numCh = peaksRef.current?.numCh ?? (trackRef.current?.channels ?? 2)
    const v = viewFor(nCh1, nCh2, numCh)
    const wasPlaying = ws.isPlaying()
    const time = ws.getCurrentTime()
    const h = waveHeightsFor(panelHeightRef.current)
    try {
      if (v === 'both') {
        // 스테레오는 WaveSurfer 네이티브 디코드 + splitChannels로 위/아래 2채널 스택
        ws.setOptions({ height: h.both, splitChannels: [{ height: h.both }, { height: h.both }] })
        await ws.load(url)
      } else {
        const pk = await ensurePeaks()
        if (!pk) return
        ws.setOptions({ height: h.single, splitChannels: [{ height: h.single }] })
        await ws.load(url, peaksFor(pk, v), pk.duration)
      }
      ws.setPlaybackRate(fxRef.current.speedPct / 100, !fxRef.current.pitchLinked)
      if (time > 0) ws.setTime(time)
      if (wasPlaying) await ws.play()
    } catch {
      /* noop */
    }
  }

  // ── Web Audio 채널 라우팅 (실제 solo / Mono·Stereo 오디오) ──
  // 채널 게인(g0/g1) 뒤에 분석용 탭(AnalyserNode)을 붙여 오른쪽 분석 패널이 실시간
  // Peak/Stereo Width를 읽어갈 수 있게 한다. 이 탭들은 destination에 연결하지 않으므로
  // 실제 재생 신호 경로/음량에는 전혀 영향을 주지 않는다.
  function ensureRoute(): Route | null {
    if (routeRef.current) return routeRef.current
    const media = wavesurferRef.current?.getMediaElement()
    if (!media) return null
    try {
      const ctx = new AudioContext()
      const src = ctx.createMediaElementSource(media)
      const splitter = ctx.createChannelSplitter(2)
      const g0 = ctx.createGain()
      const g1 = ctx.createGain()
      const merger = ctx.createChannelMerger(2)
      src.connect(splitter)
      splitter.connect(g0, 0)
      splitter.connect(g1, 1)
      merger.connect(ctx.destination)

      const analyserL = ctx.createAnalyser()
      analyserL.fftSize = 2048
      const analyserR = ctx.createAnalyser()
      analyserR.fftSize = 2048
      g0.connect(analyserL)
      g1.connect(analyserR)

      routeRef.current = { ctx, g0, g1, merger, analyserL, analyserR }
      return routeRef.current
    } catch {
      return null
    }
  }

  function applyRoute(nCh1: boolean, nCh2: boolean): void {
    const r = ensureRoute()
    if (!r) return
    void r.ctx.resume()
    // g0/g1은 merger(재생 출력) 외에도 분석 탭(analyserL/R, monoSum→LUFS)에 항상 연결돼
    // 있어야 하므로, 여기서는 merger로 가는 연결만 끊는다(disconnect()를 인자 없이 부르면
    // 분석 탭 연결까지 전부 끊겨 채널을 한 번이라도 토글하면 미터가 죽는 버그가 생김).
    try {
      r.g0.disconnect(r.merger)
    } catch {
      /* 원래 연결돼 있지 않았으면 예외 — 무시 */
    }
    try {
      r.g1.disconnect(r.merger)
    } catch {
      /* noop */
    }

    const isMonoFile = (trackRef.current?.channels ?? 2) < 2
    if (isMonoFile) {
      r.g0.gain.value = nCh1 ? 1 : 0
      r.g1.gain.value = 0
      if (nCh1) {
        r.g0.connect(r.merger, 0, 0)
        r.g0.connect(r.merger, 0, 1)
      }
      return
    }

    r.g0.gain.value = nCh1 ? 1 : 0
    r.g1.gain.value = nCh2 ? 1 : 0
    if (nCh1) r.g0.connect(r.merger, 0, 0)
    if (nCh2) r.g1.connect(r.merger, 0, 1)
  }

  function applyChannels(nCh1: boolean, nCh2: boolean, nMode: 'stereo' | 'mono'): void {
    applyRoute(nCh1, nCh2) // 오디오
    void renderView(nCh1, nCh2, nMode) // 웨이브폼
  }

  function toggleCh1(): void {
    const v = !ch1
    setCh1(v)
    setTimeout(() => applyChannels(v, ch2, mode), 0)
  }
  function toggleCh2(): void {
    const v = !ch2
    setCh2(v)
    setTimeout(() => applyChannels(ch1, v, mode), 0)
  }
  function changeMode(next: 'stereo' | 'mono'): void {
    setMode(next)
    setTimeout(() => applyChannels(ch1, ch2, next), 0)
  }

  async function decodePeaks(bytes: Uint8Array): Promise<Peaks | null> {
    try {
      if (!decodeCtxRef.current) decodeCtxRef.current = new AudioContext()
      const buf = await decodeCtxRef.current.decodeAudioData(new Uint8Array(bytes).buffer)
      const buckets = Math.min(6000, Math.max(1200, Math.floor(buf.duration * 90)))
      const l = channelPeaks(buf.getChannelData(0), buckets)
      const r = buf.numberOfChannels > 1 ? channelPeaks(buf.getChannelData(1), buckets) : l
      const mono =
        buf.numberOfChannels > 1
          ? monoPeaks(buf.getChannelData(0), buf.getChannelData(1), buckets)
          : l
      return { l, r, mono, duration: buf.duration, numCh: buf.numberOfChannels }
    } catch {
      return null
    }
  }

  // 구간 드래그 내보내기에 쓸 원본 해상도 AudioBuffer를 미리 디코딩해 캐시.
  // 실제 드래그 시작 시점에는 이미 준비돼 있어야 OS 드래그 제스처가 끊기지 않음.
  async function ensureFullBuffer(): Promise<AudioBuffer | null> {
    const t = trackRef.current
    if (!t || !window.api) return null
    if (rawBufferRef.current && rawBufferTrackIdRef.current === t.id) return rawBufferRef.current
    try {
      const bytes = await readPcmBytesForDecode(t.filePath)
      if (!decodeCtxRef.current) decodeCtxRef.current = new AudioContext()
      const buf = await decodeCtxRef.current.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
      if (trackRef.current?.id === t.id) {
        rawBufferRef.current = buf
        rawBufferTrackIdRef.current = t.id
      }
      return buf
    } catch {
      return null
    }
  }

  // Waveform에서 선택 구간을 DAW로 드래그 — 구간이 없거나 너무 짧으면 아무 것도 하지 않음(안전 폴백)
  function handleRegionDragStart(e: React.DragEvent): void {
    e.preventDefault()
    const t = trackRef.current
    const bounds = regionBounds
    if (!t || !window.api || !bounds) return
    if (bounds.end - bounds.start < MIN_REGION_SEC) return
    const buf = rawBufferRef.current
    if (!buf || rawBufferTrackIdRef.current !== t.id) return
    try {
      const sliced = sliceAudioBuffer(buf, bounds.start, bounds.end)
      if (!sliced[0] || sliced[0].length === 0) return
      const wavBytes = encodeWavFloat32(sliced, buf.sampleRate)
      const baseName = t.filename.replace(/\.[^.]+$/, '')
      window.api.startDragFromBuffer(wavBytes, `${baseName}_selection.wav`)
    } catch (err) {
      console.warn('구간 추출 실패:', (err as Error)?.message)
    }
  }

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws) return
    const token = ++loadTokenRef.current
    setCurrent(0)
    setDuration(0)

    clearRegionSelection()
    rawBufferRef.current = null
    rawBufferTrackIdRef.current = null

    if (!track || !window.api) {
      peaksRef.current = null
      if (urlRef.current) urlRef.current = null
      if (aiffBlobUrlRef.current) {
        URL.revokeObjectURL(aiffBlobUrlRef.current)
        aiffBlobUrlRef.current = null
      }
      try {
        ws.empty()
      } catch {
        /* noop */
      }
      return
    }

    peaksRef.current = null
    let cancelled = false

    ;(async () => {
      try {
        const access = await window.api!.getAudioAccess(track.filePath)
        if (cancelled || token !== loadTokenRef.current) return

        // AIFF는 <audio>가 컨테이너를 이해하지 못해 file:// URL을 직접 재생할 수 없다 —
        // 파일을 통째로 읽어 WAV로 변환한 뒤 그 결과를 Blob URL로 재생한다.
        let playUrl = access.url
        let aiffWavBytes: Uint8Array | null = null
        if (isAiffPath(track.filePath)) {
          aiffWavBytes = await readPcmBytesForDecode(track.filePath)
          if (cancelled || token !== loadTokenRef.current) return
          playUrl = URL.createObjectURL(new Blob([new Uint8Array(aiffWavBytes)], { type: 'audio/wav' }))
        }
        if (aiffBlobUrlRef.current) URL.revokeObjectURL(aiffBlobUrlRef.current)
        aiffBlobUrlRef.current = playUrl !== access.url ? playUrl : null

        urlRef.current = playUrl
        if (playUrl === access.url) preloadUrlCache.set(track.filePath, access.url)
        const key = audioCacheKey(track.filePath, access)
        const cached = await getCachedPeaks(key)
        if (cancelled || token !== loadTokenRef.current) return
        if (cached) peaksRef.current = cached

        const durationSec = cached?.duration ?? (track.durationMs ? track.durationMs / 1000 : 1)
        const initialPeaks = cached ? peaksFor(cached, viewFor(ch1, ch2, cached.numCh)) : [new Float32Array(1200)]
        ws.setOptions({
          height: cached && viewFor(ch1, ch2, cached.numCh) === 'both' ? waveHeightsFor(panelHeightRef.current).both : waveHeightsFor(panelHeightRef.current).single,
          splitChannels: cached && viewFor(ch1, ch2, cached.numCh) === 'both' ? [{ height: waveHeightsFor(panelHeightRef.current).both }, { height: waveHeightsFor(panelHeightRef.current).both }] : [{ height: waveHeightsFor(panelHeightRef.current).single }]
        })
        await ws.load(playUrl, initialPeaks, durationSec)
        if (cancelled || token !== loadTokenRef.current) return

        ws.setVolume(volume)
        // ws.load()가 재생 속도를 기본값으로 되돌리므로, 트랙마다 저장된 Speed 설정을 다시 건다
        ws.setPlaybackRate(fxRef.current.speedPct / 100, !fxRef.current.pitchLinked)
        // 분석 패널이 첫 재생부터 실시간 레벨을 읽을 수 있도록, 채널 토글을 누르기 전에도
        // Web Audio 라우트(+분석 탭)를 미리 만들어 둔다
        ensureRoute()
        applyRoute(ch1, ch2)
        const saved = loadPlaybackPosition(track)
        if (playbackOptionsRef.current.startMode === 'resume' && saved > 0 && saved < Math.max(0, ws.getDuration() - 0.05)) ws.setTime(saved)
        else ws.setTime(0)

        if (playbackOptionsRef.current.autoPlayOnSelect) {
          await startPlayback()
        }

        if (!cached) {
          void (async () => {
            try {
              // AIFF는 위에서 이미 WAV로 변환해뒀으니 재사용하고, 그 외 포맷만 새로 읽는다
              const bytes = aiffWavBytes ?? (await readPcmBytesForDecode(track.filePath))
              if (cancelled || token !== loadTokenRef.current) return
              const pk = await decodePeaks(bytes)
              if (!pk) return
              await putCachedPeaks(key, pk)
              peaksRef.current = pk
              // 재생 중이어도(자동재생 켜짐+최초 디코딩) 실제 웨이브폼으로 반드시 교체한다.
              // 재생 위치/재생 상태를 캡처했다가 로드 후 복원해 재생이 끊기지 않게 한다.
              if (token === loadTokenRef.current && urlRef.current === playUrl && wavesurferRef.current) {
                const ws2 = wavesurferRef.current
                const wasPlaying = ws2.isPlaying()
                const time = ws2.getCurrentTime()
                const v = viewFor(ch1, ch2, pk.numCh)
                const h = waveHeightsFor(panelHeightRef.current)
                ws2.setOptions({ height: v === 'both' ? h.both : h.single, splitChannels: v === 'both' ? [{ height: h.both }, { height: h.both }] : [{ height: h.single }] })
                await ws2.load(playUrl, peaksFor(pk, v), pk.duration)
                ws2.setPlaybackRate(fxRef.current.speedPct / 100, !fxRef.current.pitchLinked)
                if (time > 0) ws2.setTime(time)
                if (wasPlaying) await ws2.play()
              }
            } catch (err) {
              console.warn('waveform cache failed:', (err as Error)?.message)
            }
          })()
        }
      } catch (err) {
        if (!cancelled && token === loadTokenRef.current) {
          const msg = (err as Error)?.message ?? ''
          if (!/abort/i.test(msg)) console.warn('audio load failed:', msg)
        }
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  useEffect(() => {
    if (!track || !window.api || queueTracks.length === 0) return
    const idx = queueTracks.findIndex((t) => t.id === track.id)
    if (idx < 0) return
    let cancelled = false
    const nearby = queueTracks.slice(Math.max(0, idx - PRELOAD_RADIUS), idx + PRELOAD_RADIUS + 1).filter((t) => t.id !== track.id)
    for (const item of nearby) {
      if (preloadUrlCache.has(item.filePath)) continue
      void window.api.getAudioAccess(item.filePath).then((access) => {
        if (cancelled) return
        preloadUrlCache.set(item.filePath, access.url)
        const audio = new Audio(access.url)
        audio.preload = 'auto'
        audio.load()
      }).catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [track?.id, queueTracks])

  const sr = track?.sampleRate ? `${(track.sampleRate / 1000).toFixed(0)}k` : '--'
  const bit = track?.bitDepth ? `${track.bitDepth}` : '--'
  const stereoTrack = (track?.channels ?? 2) >= 2

  function togglePlayback(): void {
    const ws = wavesurferRef.current
    if (!ws) return
    if (ws.isPlaying()) {
      savePlaybackPosition(ws.getCurrentTime())
      ws.pause()
    } else {
      void startPlayback()
    }
  }

  // Click outside playback options menu to close it
  useEffect(() => {
    if (!optionsOpen) return
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (!target.closest('.player__options')) {
        setOptionsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [optionsOpen])

  const linkedSemitones = 12 * Math.log2(fx.speedPct / 100)
  const fxActive = fx.speedPct !== 100 || fx.pitchSemitones !== 0 || fx.reversed

  return (
    <div className={`player${dockMode ? ' player--dock' : ''}`}>
      <div className="player__wave-band" ref={waveBandRef}>
        <div className={`player__waveform${track && !ch1 && !ch2 ? ' is-muted' : ''}`} ref={containerRef} />
        {!track && <div className="player__wave-empty">Select a sound to preview</div>}
        {track && !ch1 && !ch2 && <div className="player__wave-empty">Muted</div>}
        {regionBounds && duration > 0 && regionBounds.end - regionBounds.start >= MIN_REGION_SEC && (
          <div
            className="player__region-drag"
            style={{ left: `${((regionBounds.start + regionBounds.end) / 2 / duration) * 100}%` }}
            draggable
            onDragStart={handleRegionDragStart}
            title="Drag selected range"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 6h13M8 12h13M8 18h13" />
              <circle cx="3" cy="6" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="3" cy="18" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            Drag range
          </div>
        )}
      </div>

      <div className="player__controls">
        <div className="player__info">
          <span className="player__time">{fmt(current)}</span>
          <span className="player__dur">{fmt(duration)}</span>
          <span className="player__srbit">
            {sr}|{bit}
          </span>
          <span className="player__fname">{track?.filename ?? ''}</span>
        </div>

        <div className="player__transport">
          <button
            className={`player__tbtn${loop ? ' player__tbtn--on' : ''}`}
            title="반복"
            onClick={() => setLoop((v) => !v)}
          >
            <IconLoop />
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

        <div className="player__right">
          <div className="player__fx">
            <button
              className={`player__opt-btn player__fx-btn${fxOpen ? ' player__opt-btn--open' : ''}${fxActive ? ' player__fx-btn--active' : ''}`}
              title="Pitch / Speed / Reverse"
              onClick={() => setFxOpen((v) => !v)}
            >
              <IconFx />
              FX
              {fxActive && <span className="player__fx-dot" />}
            </button>
            {fxOpen && (
              <div className="player__fx-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="fx__row">
                  <div className="fx__row-head">
                    <span className="fx__label">Speed</span>
                    <span className="fx__value">{(fx.speedPct / 100).toFixed(2)}x</span>
                  </div>
                  <input
                    className="fx__slider"
                    type="range"
                    min={50}
                    max={200}
                    step={1}
                    value={fx.speedPct}
                    onChange={(e) => updateFx({ speedPct: parseInt(e.target.value, 10) })}
                  />
                  <div className="fx__ticks">
                    <span>0.5x</span>
                    <span>1x</span>
                    <span>1.5x</span>
                    <span>2x</span>
                  </div>
                </div>

                <div className="fx__row">
                  <div className="fx__row-head">
                    <span className="fx__label">
                      Pitch
                      <label className="fx__link">
                        <input
                          type="checkbox"
                          checked={fx.pitchLinked}
                          onChange={(e) => updateFx({ pitchLinked: e.target.checked })}
                        />
                        Link to speed
                      </label>
                    </span>
                    <span className="fx__value">
                      {fx.pitchLinked
                        ? `${linkedSemitones >= 0 ? '+' : ''}${linkedSemitones.toFixed(1)} st`
                        : `${fx.pitchSemitones > 0 ? '+' : ''}${fx.pitchSemitones} st`}
                    </span>
                  </div>
                  <input
                    className="fx__slider"
                    type="range"
                    min={-12}
                    max={12}
                    step={1}
                    disabled={fx.pitchLinked}
                    value={fx.pitchLinked ? Math.round(linkedSemitones) : fx.pitchSemitones}
                    onChange={(e) => updateFx({ pitchSemitones: parseInt(e.target.value, 10) })}
                  />
                  <div className="fx__ticks">
                    <span>-12</span>
                    <span>0</span>
                    <span>+12</span>
                  </div>
                </div>

                <div className="fx__row fx__row--reverse">
                  <span className="fx__label">Reverse</span>
                  <button
                    className={`fx__reverse-btn${fx.reversed ? ' fx__reverse-btn--on' : ''}`}
                    onClick={() => updateFx({ reversed: !fx.reversed })}
                  >
                    <ReverseGlyph flipped={fx.reversed} />
                    {fx.reversed ? 'Reversed' : 'Normal'}
                  </button>
                </div>

                <div className="fx__note">
                  Speed is live. Independent pitch shift and reversed playback are previewed here and land in a future update.
                </div>
              </div>
            )}
          </div>

          <div className="player__options">
            <button
              className={`player__opt-btn${optionsOpen ? ' player__opt-btn--open' : ''}`}
              title="Playback options"
              onClick={() => setOptionsOpen((v) => !v)}
            >
              Options
            </button>
            {optionsOpen && (
              <div className="player__opt-menu" onMouseDown={(e) => e.stopPropagation()}>
                <div className="player__opt-section">Start</div>
                <label className="player__opt-item">
                  <input type="radio" name="startMode" checked={playbackOptions.startMode === 'resume'} onChange={() => updatePlaybackOptions({ startMode: 'resume' })} />
                  Resume last position
                </label>
                <label className="player__opt-item">
                  <input type="radio" name="startMode" checked={playbackOptions.startMode === 'start'} onChange={() => updatePlaybackOptions({ startMode: 'start' })} />
                  Always start at 0:00
                </label>
                <div className="player__opt-section">Playback</div>
                <label className="player__opt-item">
                  <input type="checkbox" checked={playbackOptions.selectionLoop} onChange={(e) => updatePlaybackOptions({ selectionLoop: e.target.checked })} />
                  Loop selected range
                </label>
                <label className="player__opt-item">
                  <input type="checkbox" checked={playbackOptions.autoPlayOnSelect} onChange={(e) => updatePlaybackOptions({ autoPlayOnSelect: e.target.checked })} />
                  Auto play on select
                </label>
                <div className="player__opt-section">Queue</div>
                <label className="player__opt-item">
                  <input type="radio" name="queueMode" checked={playbackOptions.queueMode === 'single'} onChange={() => updatePlaybackOptions({ queueMode: 'single' })} />
                  Single
                </label>
                <label className="player__opt-item">
                  <input type="radio" name="queueMode" checked={playbackOptions.queueMode === 'continuous'} onChange={() => updatePlaybackOptions({ queueMode: 'continuous' })} />
                  Continuous
                </label>
              </div>
            )}
          </div>

          <div className="player__vol">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9v6h4l5 4V5L8 9H4z" />
              <path d="M17 8a5 5 0 0 1 0 8" />
            </svg>
            <input
              className="player__slider"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
            />
            <span className="player__vol-val">{Math.round(volume * 100)}%</span>
          </div>

          <select
            className="player__mode"
            value={mode}
            onChange={(e) => changeMode(e.target.value as 'stereo' | 'mono')}
            title="Mono / Stereo"
          >
            <option value="stereo">Stereo</option>
            <option value="mono">Mono</option>
          </select>

          <div className="player__channels">
            <button
              className={`player__chip${ch1 ? ' player__chip--on' : ''}`}
              onClick={toggleCh1}
              disabled={!track}
              title="채널 1 (왼쪽)"
            >
              Channel 1
            </button>
            <button
              className={`player__chip${ch2 && stereoTrack ? ' player__chip--on' : ''}`}
              onClick={toggleCh2}
              disabled={!stereoTrack}
              title={stereoTrack ? '채널 2 (오른쪽)' : '모노 파일 (채널 2 없음)'}
            >
              Channel 2
            </button>
          </div>
        </div>
      </div>
    </div>
  )
})

export default PlayerBar
