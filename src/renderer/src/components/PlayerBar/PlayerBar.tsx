import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import type { Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'

interface PlayerBarProps {
  track: Track | null
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
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PlayerBar({ track }: PlayerBarProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [pitch, setPitch] = useState(1)
  const loopRef = useRef(loop)
  loopRef.current = loop

  const accent = colorForCategory(track?.category)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4b525c',
      progressColor: accent,
      cursorColor: '#dfe2e6',
      cursorWidth: 1,
      height: 56,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('timeupdate', (t: number) => setCurrent(t))
    ws.on('ready', () => setDuration(ws.getDuration()))
    ws.on('finish', () => {
      if (loopRef.current) {
        ws.play()
      } else {
        setIsPlaying(false)
      }
    })

    wavesurferRef.current = ws

    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [])

  // 선택된 트랙 카테고리에 따라 progress 컬러 갱신
  useEffect(() => {
    wavesurferRef.current?.setOptions({ progressColor: accent })
  }, [accent])

  useEffect(() => {
    wavesurferRef.current?.setVolume(volume)
  }, [volume])

  useEffect(() => {
    const media = wavesurferRef.current?.getMediaElement()
    if (media) media.playbackRate = pitch
  }, [pitch, track?.id])

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws || !track) return

    let cancelled = false
    let objectUrl: string | null = null

    async function load(): Promise<void> {
      // 브라우저 프리뷰(window.api 없음)에서는 오디오 로드를 건너뜀
      if (!window.api) return
      const bytes = await window.api.readAudioFile(track!.filePath)
      if (cancelled) return
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeTypeFor(track!.filename) })
      objectUrl = URL.createObjectURL(blob)
      await ws!.load(objectUrl)
      if (!cancelled) {
        ws!.setVolume(volume)
        ws!.play()
      }
    }

    load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id])

  return (
    <div className="player">
      <div className="player__left">
        <div className="player__transport">
          <button className="player__btn" title="Stop" onClick={() => wavesurferRef.current?.stop()}>
            ◼
          </button>
          <button
            className="player__btn player__btn--play"
            title="Play / Pause (Space)"
            disabled={!track}
            onClick={() => wavesurferRef.current?.playPause()}
          >
            {isPlaying ? '❚❚' : '▶'}
          </button>
          <button
            className={`player__btn${loop ? ' player__btn--on' : ''}`}
            title="Loop"
            onClick={() => setLoop((v) => !v)}
          >
            ↻
          </button>
        </div>
        <div className="player__nowplaying">
          <div className="player__np-name">{track?.filename ?? '재생할 사운드를 선택하세요'}</div>
          <div className="player__np-sub">
            {track ? `${track.category ?? '—'}${track.subcategory ? ' · ' + track.subcategory : ''}` : ''}
          </div>
        </div>
      </div>

      <div className="player__center">
        <span className="player__time">{fmt(current)}</span>
        <div className="player__waveform" ref={containerRef} />
        <span className="player__time player__time--end">{fmt(duration)}</span>
      </div>

      <div className="player__right">
        <div className="player__slider-row">
          <span className="player__slider-label">Pitch</span>
          <input
            className="player__slider"
            type="range"
            min={0.5}
            max={2}
            step={0.01}
            value={pitch}
            onChange={(e) => setPitch(parseFloat(e.target.value))}
          />
          <span className="player__slider-val">{pitch.toFixed(2)}×</span>
        </div>
        <div className="player__slider-row">
          <span className="player__slider-label">Vol</span>
          <input
            className="player__slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
          />
          <span className="player__slider-val">{Math.round(volume * 100)}</span>
        </div>
      </div>
    </div>
  )
}
