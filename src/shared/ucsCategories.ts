export interface UcsCategory {
  category: string
  color: string
}

// 카테고리별 색상 매핑 (스펙 3번 항목 참조). 필요 시 UCS 전체 목록으로 확장.
export const UCS_CATEGORIES: UcsCategory[] = [
  { category: 'JACKPOT', color: '#d9a441' }, // amber
  { category: 'UI', color: '#4a90d9' }, // blue
  { category: 'REEL', color: '#3fb8a0' }, // teal
  { category: 'FOLEY', color: '#8a7fd1' },
  { category: 'AMBIENCE', color: '#6fbf73' },
  { category: 'MUSIC', color: '#d96f9c' },
  { category: 'VOICE', color: '#d95f5f' },
  { category: 'OTHER', color: '#8a8f98' }
]

// 알려지지 않은(UCS 등) 카테고리는 이름 해시로 일관된 파스텔 색 생성
function hashColor(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  const hue = h % 360
  return `hsl(${hue}, 52%, 62%)`
}

export function colorForCategory(category: string | null | undefined): string {
  if (!category) return '#8a8f98'
  const found = UCS_CATEGORIES.find((c) => c.category.toLowerCase() === category.toLowerCase())
  return found?.color ?? hashColor(category.toUpperCase())
}
