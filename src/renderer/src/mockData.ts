import type { Library, Track } from '@shared/types'

// Electron preload(window.api)이 없는 순수 브라우저 프리뷰 환경에서
// UI를 채워 보여주기 위한 샘플 데이터. 실제 앱 동작에는 영향 없음.
export const isBrowserPreview = typeof window !== 'undefined' && !window.api

export const mockLibrary: Library = {
  id: 1,
  rootPath: 'D:/SFX/Slot Machine Pack',
  name: 'Slot Machine Pack',
  createdAt: Date.now()
}

const CATEGORIES: Array<[string, string]> = [
  ['JACKPOT', 'Big Win'],
  ['UI', 'Button'],
  ['REEL', 'Spin'],
  ['REEL', 'Stop'],
  ['FOLEY', 'Coin'],
  ['AMBIENCE', 'Casino'],
  ['MUSIC', 'Loop'],
  ['VOICE', 'Announcer']
]

const NAMES = [
  'jackpot_mega_hit',
  'reel_spin_loop',
  'reel_nudge_short',
  'ui_button_tap',
  'ui_button_hover',
  'multipot_appear',
  'coin_burst_big',
  'coin_single_drop',
  'bigwin_fanfare',
  'freespin_trigger',
  'anticipation_riser',
  'symbol_land_soft',
  'scatter_hit',
  'wild_expand',
  'casino_ambience_bg',
  'announcer_you_win',
  'bonus_wheel_tick',
  'reel_stop_thud',
  'level_up_sparkle',
  'megaways_reveal',
  'cascade_pop_01',
  'cascade_pop_02',
  'ui_menu_open',
  'ui_menu_close',
  'jackpot_grand_loop',
  'coin_shower_long',
  'bell_ring_classic',
  'lever_pull_mechanical',
  'win_count_up_loop',
  'transition_whoosh'
]

const SR = [48000, 44100, 96000]
const BITS = [16, 24]
const CH = [1, 2]

export const mockTracks: Track[] = NAMES.map((base, i) => {
  const [category, subcategory] = CATEGORIES[i % CATEGORIES.length]
  return {
    id: i + 1,
    libraryId: 1,
    filePath: `${mockLibrary.rootPath}/${base}.wav`,
    filename: `${base}.wav`,
    durationMs: 800 + ((i * 977) % 9000),
    sampleRate: SR[i % SR.length],
    bitDepth: BITS[i % BITS.length],
    channels: CH[i % CH.length],
    category,
    subcategory,
    description:
      i % 3 === 0
        ? `${subcategory} sound for slot game, designed and mastered`
        : `${subcategory} element`,
    tags: [category.toLowerCase(), subcategory.toLowerCase().replace(/\s+/g, '_'), 'slot', 'game'],
    starred: i % 7 === 0,
    artworkPath: null,
    artworkSource: 'generated',
    addedAt: Date.now() - i * 3600_000,
    lastPlayedAt: null
  }
})
