import { useMemo } from 'react'
import type { Collection, Track } from '@shared/types'
import { colorForCategory } from '@shared/ucsCategories'
import { toTitleCase } from '@shared/textCase'

interface CollectionHeroProps {
  collection: Collection
  tracks: Track[]
}

function fmtTotalDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

// 컬렉션에 담긴 첫 4개 사운드의 카테고리 색으로 만드는 2x2 모자이크 —
// 실제 아트워크 대신, 이 크레이트가 어떤 사운드들로 구성됐는지 색으로 즉시 보여준다.
function MosaicCover({ tracks }: { tracks: Track[] }): JSX.Element {
  const quads = [0, 1, 2, 3].map((i) => (tracks[i] ? colorForCategory(tracks[i].category) : null))
  return (
    <div className="coll-hero__mosaic">
      {quads.map((color, i) => (
        <div
          key={i}
          className="coll-hero__quad"
          style={{ background: color ?? 'var(--bg-elevated-2)' }}
        />
      ))}
    </div>
  )
}

export default function CollectionHero({ collection, tracks }: CollectionHeroProps): JSX.Element {
  const totalMs = useMemo(() => tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0), [tracks])

  const breakdown = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of tracks) {
      const key = t.category ?? 'Other'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count, color: colorForCategory(category) }))
      .sort((a, b) => b.count - a.count)
  }, [tracks])

  const shown = breakdown.slice(0, 4)
  const restCount = breakdown.slice(4).reduce((sum, b) => sum + b.count, 0)

  return (
    <div className="coll-hero">
      <MosaicCover tracks={tracks} />
      <div className="coll-hero__body">
        <div className="coll-hero__name">{collection.name}</div>
        <div className="coll-hero__stats">
          {tracks.length.toLocaleString()} sounds · {fmtTotalDuration(totalMs)}
        </div>
        {breakdown.length > 0 && (
          <>
            <div className="coll-hero__bar">
              {breakdown.map((b) => (
                <div
                  key={b.category}
                  className="coll-hero__bar-seg"
                  style={{ width: `${(b.count / tracks.length) * 100}%`, background: b.color }}
                  title={`${toTitleCase(b.category)}: ${b.count}`}
                />
              ))}
            </div>
            <div className="coll-hero__legend">
              {shown.map((b) => (
                <span className="coll-hero__legend-item" key={b.category}>
                  <span className="coll-hero__legend-dot" style={{ background: b.color }} />
                  {toTitleCase(b.category)}
                  <span className="coll-hero__legend-count">{b.count}</span>
                </span>
              ))}
              {restCount > 0 && <span className="coll-hero__legend-item coll-hero__legend-item--rest">+{restCount} more</span>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
