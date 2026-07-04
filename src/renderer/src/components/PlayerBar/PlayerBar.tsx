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

interface Route {
  ctx: AudioContext
  g0: GainNode
  g1: GainNode
  merger: ChannelMergerNode
}

// 통일된 트랜스포트 아이콘 (동일 viewBox / 스트로크)
const IconLoop = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 0 1 4-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />
  </svg>
)
const IconPrev = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
    <path d="M18 5v14l-11-7z" />
    <rect x="5" y="5" width="2" height="14" rx="1" />
  </svg>
)
const IconNext = (): JSX.Element => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round">
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
      // Soundly처럼 스테레오 파일은 좌/우 채널을 위아래로 분리 표시
      splitChannels: [
        { height: 30 },
        { height: 30 }
      ]
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
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [])

  // 액센트 변경 시 웨이브폼 진행색 갱신
  useEffect(() => {
    wavesurferRef.current?.setOptions({ progressColor: accent })
  }, [accent])

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

  // ── Web Audio 채널 라우팅 (실제 채널 solo / Mono·Stereo) ──
  // 기본 재생을 건드리지 않도록, 사용자가 채널 컨트롤을 처음 만질 때만 라우팅 생성.
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
      return null // 실패 시 미디어 요소가 그대로 소리 출력 (안전)
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
    if (nMode === 'mono') {
      // 두 채널을 양쪽 출력으로 합침
      r.g0.connect(r.merger, 0, 0)
      r.g0.connect(r.merger, 0, 1)
      r.g1.connect(r.merger, 0, 0)
      r.g1.connect(r.merger, 0, 1)
    } else {
      r.g0.connect(r.merger, 0, 0)
      r.g1.connect(r.merger, 0, 1)
    }
  }

  function toggleCh1(): void {
    const v = !ch1
    setCh1(v)
    applyRoute(v, ch2, mode)
  }
  function toggleCh2(): void {
    const v = !ch2
    setCh2(v)
    applyRoute(ch1, v, mode)
  }
  function changeMode(next: 'stereo' | 'mono'): void {
    setMode(next)
    applyRoute(ch1, ch2, next)
  }

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws) return

    const token = ++loadTokenRef.current
    setCurrent(0)
    setDuration(0)

    if (!track || !window.api) {
      try {
        ws.empty()
      } catch {
        /* noop */
      }
      return
    }

    let objectUrl: string | null = null
    ;(async () => {
      try {
        const bytes = await window.api!.readAudioFile(track.filePath)
        if (token !== loadTokenRef.current) return
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeTypeFor(track.filename) })
        objectUrl = URL.createObjectURL(blob)
        await ws.load(objectUrl)
        if (token !== loadTokenRef.current) return
        ws.setVolume(volume)
        await ws.play()
      } catch (err) {
        if (token === loadTokenRef.current) {
          const msg = (err as Error)?.message ?? ''
          if (!/abort/i.test(msg)) console.warn('audio load failed:', msg)
        }
      }
    })()

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
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
              title="채널 1 켜기/끄기"
            >
              Channel 1
            </button>
            <button
              className={`player__chip${ch2 && stereoTrack ? ' player__chip--on' : ''}`}
              onClick={toggleCh2}
              disabled={!stereoTrack}
              title={stereoTrack ? '채널 2 켜기/끄기' : '모노 파일 (채널 2 없음)'}
            >
              Channel 2
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
