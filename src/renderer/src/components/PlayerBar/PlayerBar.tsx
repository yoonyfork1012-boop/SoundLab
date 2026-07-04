import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import type { Track } from '@shared/types'

interface PlayerBarProps {
  track: Track | null
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

export default function PlayerBar({ track, onPrev, onNext }: PlayerBarProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const loadTokenRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.85)
  const loopRef = useRef(loop)
  loopRef.current = loop

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#3a4048',
      progressColor: '#4c8dff',
      cursorColor: '#eceef2',
      cursorWidth: 1,
      height: 70,
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      normalize: true
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

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

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
        // 빠르게 다음 트랙으로 넘어가면서 발생하는 abort는 무시
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
            title="Loop"
            onClick={() => setLoop((v) => !v)}
          >
            ↻
          </button>
          <button className="player__tbtn" title="이전 (↑)" onClick={onPrev}>
            ⏮
          </button>
          <button
            className="player__tbtn player__tbtn--play"
            title="재생 / 일시정지 (Space)"
            disabled={!track}
            onClick={() => wavesurferRef.current?.playPause()}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button className="player__tbtn" title="다음 (↓)" onClick={onNext}>
            ⏭
          </button>
          <button className="player__tbtn" title="Stop" onClick={() => wavesurferRef.current?.stop()}>
            ◼
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
          <div className="player__channels">
            <span className={`player__chip${(track?.channels ?? 2) >= 1 ? ' player__chip--on' : ''}`}>
              Channel 1
            </span>
            <span className={`player__chip${(track?.channels ?? 0) >= 2 ? ' player__chip--on' : ''}`}>
              Channel 2
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
