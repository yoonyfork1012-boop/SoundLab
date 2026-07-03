import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import type { Track } from '@shared/types'

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

export default function PlayerBar({ track }: PlayerBarProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const wavesurferRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    if (!containerRef.current) return

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#4a5568',
      progressColor: '#4a90d9',
      cursorColor: '#e4e5e7',
      height: 56,
      barWidth: 2,
      barGap: 1,
      normalize: true
    })

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))

    wavesurferRef.current = ws

    return () => {
      ws.destroy()
      wavesurferRef.current = null
    }
  }, [])

  useEffect(() => {
    const ws = wavesurferRef.current
    if (!ws || !track) return

    let cancelled = false
    let objectUrl: string | null = null

    async function load(): Promise<void> {
      const bytes = await window.api.readAudioFile(track!.filePath)
      if (cancelled) return
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeTypeFor(track!.filename) })
      objectUrl = URL.createObjectURL(blob)
      await ws!.load(objectUrl)
      if (!cancelled) ws!.play()
    }

    load()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [track?.id])

  function togglePlay(): void {
    wavesurferRef.current?.playPause()
  }

  function stop(): void {
    const ws = wavesurferRef.current
    if (!ws) return
    ws.stop()
  }

  return (
    <div className="player">
      <div className="player__transport">
        <button onClick={stop} title="Stop">
          ◼
        </button>
        <button onClick={togglePlay} title="Play/Pause" disabled={!track}>
          {isPlaying ? '❚❚' : '▶'}
        </button>
      </div>
      <div className="player__waveform" ref={containerRef} />
      <div className="player__meta">
        <div className="player__filename">{track?.filename ?? '재생할 사운드를 선택하세요'}</div>
      </div>
    </div>
  )
}
