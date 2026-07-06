// 앱 재실행 후에도 유지되어야 하는 UI 상태(패널 폭, 트리 펼침상태 등)를
// localStorage에 저장/복원하는 공용 헬퍼.

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* noop */
  }
}

export function loadNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key)
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

export function saveNumber(key: string, value: number): void {
  localStorage.setItem(key, String(value))
}

export function loadBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key)
  if (raw == null) return fallback
  return raw === '1'
}

export function saveBool(key: string, value: boolean): void {
  localStorage.setItem(key, value ? '1' : '0')
}

export function loadStringSet(key: string): Set<string> {
  return new Set(loadJSON<string[]>(key, []))
}

export function saveStringSet(key: string, set: Set<string>): void {
  saveJSON(key, Array.from(set))
}
