interface MiniWaveformProps {
  seed: string
  color?: string
  bars?: number
  width?: number
  height?: number
}

// 파일명 등을 시드로 한 가벼운 의사(pseudo) 웨이브폼.
// 실제 오디오 디코딩 없이 Soundly식 로우 썸네일 느낌만 재현 (Phase 3에서 실제 렌더로 교체).
function seededHeights(seed: string, bars: number): number[] {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const out: number[] = []
  for (let i = 0; i < bars; i++) {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    const r = ((h >>> 0) % 1000) / 1000
    // 가운데가 높고 양끝이 낮은 엔벨로프
    const env = Math.sin((i / (bars - 1)) * Math.PI)
    out.push(0.15 + r * 0.85 * (0.4 + 0.6 * env))
  }
  return out
}

export default function MiniWaveform({
  seed,
  color = '#5f6670',
  bars = 40,
  width = 120,
  height = 22
}: MiniWaveformProps): JSX.Element {
  const heights = seededHeights(seed, bars)
  const barW = width / bars
  const gap = barW * 0.35
  const mid = height / 2

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {heights.map((val, i) => {
        const barH = val * height
        const x = i * barW + gap / 2
        const w = barW - gap
        return (
          <rect
            key={i}
            x={x}
            y={mid - barH / 2}
            width={w}
            height={barH}
            rx={Math.min(1, w / 2)}
            fill={color}
          />
        )
      })}
    </svg>
  )
}
