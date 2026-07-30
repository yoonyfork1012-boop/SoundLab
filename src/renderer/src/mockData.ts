import type { Collection, Library, Track } from "@shared/types";

// Electron preload(window.api)이 없는 순수 브라우저 프리뷰 환경에서
// UI를 채워 보여주기 위한 샘플 데이터. 실제 앱 동작에는 영향 없음.
export const isBrowserPreview = typeof window !== "undefined" && !window.api;

const ROOT = "D:/SFX/Slot Machine Pack";

export const mockLibrary: Library = {
  id: 1,
  rootPath: ROOT,
  name: "Slot Machine Pack",
  createdAt: Date.now(),
  monitor: false,
  analyzedAt: null,
};

// [파일명 base, 카테고리, 서브카테고리, 하위폴더]
const DEFS: Array<[string, string, string, string]> = [
  ["jackpot_mega_hit", "JACKPOT", "Big Win", "Jackpot"],
  ["jackpot_grand_loop", "JACKPOT", "Loop", "Jackpot"],
  ["bigwin_fanfare", "JACKPOT", "Fanfare", "Jackpot"],
  ["multipot_appear", "JACKPOT", "Appear", "Jackpot"],
  ["reel_spin_loop", "REEL", "Spin", "Reels"],
  ["reel_nudge_short", "REEL", "Nudge", "Reels"],
  ["reel_stop_thud", "REEL", "Stop", "Reels"],
  ["anticipation_riser", "REEL", "Riser", "Reels"],
  ["symbol_land_soft", "REEL", "Land", "Reels"],
  ["megaways_reveal", "REEL", "Reveal", "Reels"],
  ["ui_button_tap", "UI", "Button", "UI"],
  ["ui_button_hover", "UI", "Hover", "UI"],
  ["ui_menu_open", "UI", "Menu", "UI"],
  ["ui_menu_close", "UI", "Menu", "UI"],
  ["bonus_wheel_tick", "UI", "Tick", "UI"],
  ["coin_burst_big", "FOLEY", "Coin", "Foley"],
  ["coin_single_drop", "FOLEY", "Coin", "Foley"],
  ["coin_shower_long", "FOLEY", "Coin", "Foley"],
  ["lever_pull_mechanical", "FOLEY", "Lever", "Foley"],
  ["bell_ring_classic", "FOLEY", "Bell", "Foley"],
  ["casino_ambience_bg", "AMBIENCE", "Casino", "Ambience"],
  ["scatter_hit", "AMBIENCE", "Hit", "Ambience"],
  ["wild_expand", "AMBIENCE", "Expand", "Ambience"],
  ["win_count_up_loop", "MUSIC", "Loop", "Music"],
  ["freespin_trigger", "MUSIC", "Trigger", "Music"],
  ["level_up_sparkle", "MUSIC", "Sparkle", "Music"],
  ["transition_whoosh", "MUSIC", "Whoosh", "Music"],
  ["announcer_you_win", "VOICE", "Announcer", "Voice"],
  ["cascade_pop_01", "VOICE", "Pop", "Voice"],
  ["cascade_pop_02", "VOICE", "Pop", "Voice"],
];

const SR = [48000, 44100, 96000];
const BITS = [16, 24];
const CH = [1, 2];

// 3벌 변형으로 늘려 실제 규모(스크롤 필요)에 가깝게
const VARIANTS = ["", "_v2", "_v3"];
const EXPANDED = VARIANTS.flatMap((suffix) =>
  DEFS.map(
    ([base, category, subcategory, folder]) =>
      [`${base}${suffix}`, category, subcategory, folder] as [
        string,
        string,
        string,
        string,
      ],
  ),
);

export const mockTracks: Track[] = EXPANDED.map(
  ([base, category, subcategory, folder], i) => ({
    id: i + 1,
    libraryId: 1,
    filePath: `${ROOT}/${folder}/${base}.wav`,
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
    tags: [
      category.toLowerCase(),
      subcategory.toLowerCase().replace(/\s+/g, "_"),
      "slot",
      "game",
    ],
    starred: i % 7 === 0,
    artworkPath: null,
    artworkSource: "generated",
    addedAt: Date.now() - i * 3600_000,
    // 일부는 미리듣기한 상태(previewed → 회색)로 표시해 프리뷰에서 확인
    lastPlayedAt: i % 4 === 1 ? Date.now() - i * 60_000 : null,
    fileSize: 200_000 + ((i * 54321) % 8_000_000),
    publisher: i % 3 === 0 ? "Acme Sound Co." : null,
    isFloat: BITS[i % BITS.length] === 32,
    fileHash: null,
    markers: [],
  }),
);

export const mockCollections: Collection[] = [
  {
    id: 1,
    name: "Favorites",
    trackIds: [1, 5, 9, 12],
    createdAt: Date.now(),
    color: null,
  },
  {
    id: 2,
    name: "Trailer Hits",
    trackIds: [2, 3],
    createdAt: Date.now(),
    color: null,
  },
];
