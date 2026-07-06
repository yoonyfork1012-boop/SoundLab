import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import type { Track } from '@shared/types'

interface PlayerBarProps {
  track: Track | null
  accent: string
  onPrev: () => void
  onNext: () => void
}

function mimeTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg'
    case 'wav':
      return 'audio/wav'
    case 'm4a':
      return 'audio/mp4'
    case 'ogg':
      return 'audio/ogg'
    case 'flac':
      return 'audio/flac'
    case 'aiff':
    case 'aif':
      return 'audio/aiff'
    default:
      return 'application/octet-stream'
  }
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

interface Route {
  ctx: AudioContext
  g0: GainNode
  g1: GainNode
  merger: ChannelMergerNode
}

type WaveView = 'both' | 'left' | 'right' | 'mono'

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

export default function PlayerBar({ track, accent, onPrev, onNext }: PlayerBarProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const loadTokenRef = useRef(0)
  const routeRef = useRef<Route | null>(null)
  const decodeCtxRef = useRef<AudioContext | null>(null)
  const peaksRef = useRef<Peaks | null>(null)
  const urlRef = useRef<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const [ch1, setCh1] = useState(true)
  const [ch2, setCh2] = useState(true)
  const [mode, setMode] = useState<'stereo' | 'mono'>('stereo')
  const loopRef = useRef(loop)
  loopRef.current = loop
  const trackRef = useRef(track)
  trackRef.current = track

  useEffect(() => {
    if (!containerRef.current) return
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3a4048',
      progressColor: accent,
      cursorColor: '#eceef2',
      cursorWidth: 1,
      height: 30,
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      normalize: true,
      splitChannels: [{ height: 30 }, { height: 30 }]
    })
    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('timeupdate', (t: number) => setCurrent(t))
    ws.on('ready', () => setDuration(ws.getDuration()))
    ws.on('finish', () => {
      if (loopRef.current) ws.play()
      else setIsPlaying(false)
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
    }
  }, [])

  useEffect(() => {
    wavesurferRef.current?.setOptions({ progressColor: accent })
  }, [accent])

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

  // 현재 채널/모드 → 웨이브폼 뷰
  function viewFor(c1: boolean, c2: boolean, m: 'stereo' | 'mono', numCh: number): WaveView {
    if (numCh < 2) return 'mono'
    if (m === 'mono') return 'mono'
    if (c1 && !c2) return 'left'
    if (c2 && !c1) return 'right'
    return 'both'
  }

  function peaksFor(pk: Peaks, v: WaveView): (Float32Array | number[])[] {
    if (v === 'both') return [pk.l, pk.r]
    if (v === 'left') return [pk.l]
    if (v === 'right') return [pk.r]
    return [pk.mono]
  }

  // 필요 시(단일/모노 뷰) 채널별 피크를 지연 디코딩
  async function ensurePeaks(): Promise<Peaks | null> {
    if (peaksRef.current) return peaksRef.current
    const t = trackRef.current
    if (!t || !window.api) return null
    try {
      const bytes = await window.api.readAudioFile(t.filePath)
      peaksRef.current = await decodePeaks(new Uint8Array(bytes))
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
    const v = viewFor(nCh1, nCh2, nMode, numCh)
    const wasPlaying = ws.isPlaying()
    const time = ws.getCurrentTime()
    try {
      if (v === 'both') {
        // 스테레오는 WaveSurfer 네이티브 디코드 + splitChannels로 위/아래 2채널 스택
        ws.setOptions({ height: 30, splitChannels: [{ height: 30 }, { height: 30 }] })
        await ws.load(url)
      } else {
        const pk = await ensurePeaks()
        if (!pk) return
        ws.setOptions({ height: 58, splitChannels: [{ height: 58 }] })
        await ws.load(url, peaksFor(pk, v), pk.duration)
      }
      if (time > 0) ws.setTime(time)
      if (wasPlaying) await ws.play()
    } catch {
      /* noop */
    }
  }

  // ── Web Audio 채널 라우팅 (실제 solo / Mono·Stereo 오디오) ──
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
      routeRef.current = { ctx, g0, g1, merger }
      return routeRef.current
    } catch {
      return null
    }
  }

  function applyRoute(nCh1: boolean, nCh2: boolean, nMode: 'stereo' | 'mono'): void {
    const r = ensureRoute()
    if (!r) return
    void r.ctx.resume()
    r.g0.disconnect()
    r.g1.disconnect()
    r.g0.gain.value = nCh1 ? 1 : 0
    r.g1.gain.value = nCh2 ? 1 : 0
    const solo = nMode === 'mono' || (nCh1 && !nCh2) || (nCh2 && !nCh1)
    if (solo) {
      // 활성 채널을 양쪽 출력으로 (모노/솔로)
      if (nCh1) {
        r.g0.connect(r.merger, 0, 0)
        r.g0.connect(r.merger, 0, 1)
      }
      if (nCh2) {
        r.g1.connect(r.merger, 0, 0)
        r.g1.connect(r.merger, 0, 1)
      }
    } else {
      r.g0.connect(r.merger, 0, 0)
      r.g1.connect(r.merger, 0, 1)
    }
  }

  function applyChannels(nCh1: boolean, nCh2: boolean, nMode: 'stereo' | 'mono'): void {
    applyRoute(nCh1, nCh2, nMode) // 오디오
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

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws) return
    const token = ++loadTokenRef.current
    setCurrent(0)
    setDuration(0)

    if (!track || !window.api) {
      peaksRef.current = null
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      try {
        ws.empty()
      } catch {
        /* noop */
      }
      return
    }

    peaksRef.current = null
    let objectUrl: string | null = null
    let cancelled = false

    ;(async () => {
      try {
        const bytes = await window.api!.readAudioFile(track.filePath)
        if (cancelled || token !== loadTokenRef.current) return

        const arr = new Uint8Array(bytes)
        objectUrl = URL.createObjectURL(new Blob([arr], { type: mimeTypeFor(track.filename) }))
        if (cancelled || token !== loadTokenRef.current) {
          URL.revokeObjectURL(objectUrl)
          return
        }
        urlRef.current = objectUrl

        const v = viewFor(ch1, ch2, mode, track.channels ?? 2)
        if (v === 'both') {
          ws.setOptions({ height: 30, splitChannels: [{ height: 30 }, { height: 30 }] })
          await ws.load(objectUrl)
        } else {
          const pk = await decodePeaks(arr)
          if (cancelled || token !== loadTokenRef.current) return
          peaksRef.current = pk
          if (pk) {
            ws.setOptions({ height: 58, splitChannels: [{ height: 58 }] })
            await ws.load(objectUrl, peaksFor(pk, v), pk.duration)
          } else {
            await ws.load(objectUrl)
          }
        }

        if (cancelled || token !== loadTokenRef.current) return
        ws.setVolume(volume)
        await ws.play()
      } catch (err) {
        if (!cancelled && token === loadTokenRef.current) {
          const msg = (err as Error)?.message ?? ''
          if (!/abort/i.test(msg)) console.warn('audio load failed:', msg)
        }
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (urlRef.current === objectUrl) urlRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  const sr = track?.sampleRate ? `${(track.sampleRate / 1000).toFixed(0)}k` : '—'
  const bit = track?.bitDepth ? `${track.bitDepth}` : '—'
  const stereoTrack = (track?.channels ?? 2) >= 2

  return (
    <div className="player">
      <div className="player__wave-band">
        <div className="player__waveform" ref={containerRef} />
        {!track && <div className="player__wave-empty">재생할 사운드를 선택하세요</div>}
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
            onClick={() => wavesurferRef.current?.playPause()}
          >
            {isPlaying ? <IconPause /> : <IconPlay />}
          </button>
          <button className="player__tbtn" title="다음 (↓)" onClick={onNext}>
            <IconNext />
          </button>
          <button className="player__tbtn" title="정지" onClick={() => wavesurferRef.current?.stop()}>
            <IconStop />
          </button>
        </div>

        <div className="player__right">
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
              disabled={mode === 'mono'}
              title="채널 1 (왼쪽)"
            >
              Channel 1
            </button>
            <button
              className={`player__chip${ch2 && stereoTrack ? ' player__chip--on' : ''}`}
              onClick={toggleCh2}
              disabled={!stereoTrack || mode === 'mono'}
              title={stereoTrack ? '채널 2 (오른쪽)' : '모노 파일 (채널 2 없음)'}
            >
              Channel 2
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
