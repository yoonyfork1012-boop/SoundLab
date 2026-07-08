// Category/Subcategory 하이브리드 분류기.
//
// 구조: 고정 트리(대분류→소분류) taxonomy를 기본 골격으로 삼되, 각 노드(대/소분류)를
// "키워드 벡터"로 표현하고 파일명/폴더명/태그/설명을 합친 입력 텍스트와의 키워드 중첩
// 정도(단순화된 벡터 유사도 점수)를 모든 노드에 대해 계산해 가장 높은 점수의 대분류를
// 고르는 방식이다. 첫 번째로 매칭되는 키워드에서 멈추지 않고 카테고리+모든 소분류
// 키워드의 점수를 합산하므로, 사운드가 여러 특성 키워드를 동시에 가질 때도 가장 근거가
// 많이 모이는 카테고리로 수렴한다.
//
// 새 카테고리/소분류나 키워드를 추가하려면 TAXONOMY 배열에 항목만 추가하면 된다.

export interface SubcategoryRule {
  name: string;
  keywords: string[];
}

export interface CategoryRule {
  category: string;
  keywords: string[];
  subcategories: SubcategoryRule[];
}

export const UNCATEGORIZED = "Uncategorized";

export const TAXONOMY: CategoryRule[] = [
  {
    category: "Impact",
    keywords: [
      "impact",
      "hit",
      "punch",
      "slam",
      "boom",
      "smash",
      "thud",
      "bang",
      "crash",
      "strike",
      "thump",
    ],
    subcategories: [
      {
        name: "Metal Impact",
        keywords: ["metal", "metallic", "steel", "iron", "pipe"],
      },
      {
        name: "Wood Impact",
        keywords: ["wood", "wooden", "plank", "crate", "timber"],
      },
      {
        name: "Soft Hit",
        keywords: ["soft", "pillow", "cloth", "muffled", "light"],
      },
      {
        name: "Heavy Hit",
        keywords: ["heavy", "big", "large", "huge", "massive", "deep"],
      },
    ],
  },
  {
    category: "UI",
    keywords: [
      "ui",
      "button",
      "click",
      "select",
      "confirm",
      "cancel",
      "menu",
      "tap",
      "beep",
      "notification",
      "popup",
    ],
    subcategories: [
      { name: "Button Click", keywords: ["click", "tap", "press", "button"] },
      { name: "Hover", keywords: ["hover", "rollover", "over"] },
      {
        name: "Confirm",
        keywords: ["confirm", "accept", "ok", "success", "complete"],
      },
      {
        name: "Error",
        keywords: ["error", "fail", "denied", "wrong", "invalid", "warning"],
      },
    ],
  },
  {
    category: "Whoosh",
    keywords: [
      "whoosh",
      "swipe",
      "swish",
      "transition",
      "passby",
      "pass by",
      "flyby",
      "fly by",
      "swoosh",
    ],
    subcategories: [
      { name: "Fast Whoosh", keywords: ["fast", "quick", "rapid", "sharp"] },
      { name: "Slow Whoosh", keywords: ["slow", "long", "smooth"] },
      {
        name: "Magical Whoosh",
        keywords: ["magic", "magical", "sparkle", "fairy", "shimmer"],
      },
    ],
  },
  {
    category: "Ambience",
    keywords: [
      "ambience",
      "ambiance",
      "atmos",
      "atmosphere",
      "background",
      "roomtone",
      "room tone",
      "ambient",
    ],
    subcategories: [
      {
        name: "Interior",
        keywords: ["interior", "room", "indoor", "house", "office"],
      },
      {
        name: "Exterior",
        keywords: ["exterior", "outdoor", "street", "city", "urban"],
      },
      {
        name: "Nature",
        keywords: [
          "forest",
          "wind",
          "rain",
          "nature",
          "birds",
          "water",
          "storm",
        ],
      },
    ],
  },
  {
    category: "Coin",
    keywords: [
      "coin",
      "money",
      "cash",
      "collect",
      "collectible",
      "gem",
      "gold",
    ],
    subcategories: [
      { name: "Coin Drop", keywords: ["drop", "fall", "single"] },
      {
        name: "Coin Collect",
        keywords: ["collect", "pickup", "pick up", "get", "reward"],
      },
      {
        name: "Coin Count",
        keywords: ["count", "tally", "counter", "stack", "total"],
      },
    ],
  },
  {
    category: "Slot",
    // 슬롯 전용 어휘만 카테고리 키워드로 둔다(일반 SFX 파일명엔 거의 없어 오분류 위험이 낮음).
    // 'spin'·'wild'처럼 다른 라이브러리에도 나올 수 있는 일반어는 소분류 키워드로만 둔다.
    keywords: [
      "reel",
      "respin",
      "nospin",
      "slot",
      "scatter",
      "payout",
      "payline",
      "freespin",
      "multipot",
      "bigwin",
      "megaways",
      "jackpot",
    ],
    subcategories: [
      {
        name: "Reel Spin",
        keywords: ["spin", "spinning", "respin", "roll", "rolling"],
      },
      {
        name: "Reel Stop",
        keywords: ["stop", "stopping", "halt", "land", "landing"],
      },
      { name: "Scatter", keywords: ["scatter"] },
      {
        name: "Bonus",
        keywords: [
          "bonus",
          "feature",
          "freespin",
          "free spin",
          "pick",
          "wheel",
          "respin",
        ],
      },
      {
        name: "Payout",
        keywords: [
          "payout",
          "payline",
          "pay",
          "win",
          "bigwin",
          "collect",
          "payline",
        ],
      },
      {
        name: "Jackpot",
        keywords: [
          "jackpot",
          "multipot",
          "grand",
          "major",
          "minor",
          "mini",
          "mega",
          "ultra",
          "super",
        ],
      },
      {
        name: "Wild",
        keywords: ["wild", "multiplier", "multiply", "link", "lock"],
      },
    ],
  },
  {
    category: "Voice",
    keywords: [
      "voice",
      "voc",
      "vox",
      "vocal",
      "character",
      "speech",
      "shout",
      "yell",
      "scream",
      "talk",
      "laugh",
      "announcer",
    ],
    subcategories: [
      { name: "Male Voice", keywords: ["male", "man", "guy"] },
      { name: "Female Voice", keywords: ["female", "woman", "girl"] },
      { name: "Crowd", keywords: ["crowd", "group", "chatter", "audience"] },
    ],
  },
  {
    category: "Music",
    keywords: [
      "music",
      "bgm",
      "theme",
      "melody",
      "song",
      "score",
      "orchestral",
    ],
    subcategories: [
      { name: "Main BGM", keywords: ["main", "theme", "intro"] },
      { name: "Bonus BGM", keywords: ["bonus", "feature"] },
      { name: "Loop", keywords: ["loop", "looping"] },
      { name: "Stinger", keywords: ["stinger", "sting", "cue"] },
    ],
  },
  {
    category: "Magic",
    keywords: [
      "magic",
      "magical",
      "sparkle",
      "fairy",
      "spell",
      "enchant",
      "mystic",
    ],
    subcategories: [
      { name: "Spell Cast", keywords: ["cast", "spell"] },
      {
        name: "Sparkle",
        keywords: ["sparkle", "shimmer", "twinkle", "glitter"],
      },
      { name: "Transformation", keywords: ["transform", "morph", "shift"] },
    ],
  },
  {
    category: "Mechanical",
    keywords: [
      "mechanical",
      "gear",
      "machine",
      "lever",
      "motor",
      "engine",
      "servo",
      "ratchet",
      "winch",
    ],
    subcategories: [
      { name: "Gear", keywords: ["gear", "cog"] },
      { name: "Lever", keywords: ["lever", "switch", "latch"] },
      { name: "Engine", keywords: ["engine", "motor"] },
    ],
  },
  {
    category: "Creature",
    keywords: [
      "animal",
      "monster",
      "creature",
      "beast",
      "growl",
      "roar",
      "snarl",
      "hiss",
    ],
    subcategories: [
      { name: "Growl", keywords: ["growl", "snarl"] },
      { name: "Roar", keywords: ["roar"] },
      { name: "Bird", keywords: ["bird", "chirp", "tweet"] },
    ],
  },
  {
    category: "Foley",
    keywords: [
      "footstep",
      "footsteps",
      "foot step",
      "walk",
      "run",
      "shoe",
      "boot",
      "cloth",
      "fabric",
    ],
    subcategories: [
      { name: "Walk", keywords: ["walk", "walking"] },
      { name: "Run", keywords: ["run", "running", "sprint"] },
      { name: "Jump", keywords: ["jump", "leap", "land"] },
    ],
  },
  {
    category: "Weapon",
    keywords: [
      "weapon",
      "sword",
      "gun",
      "explosion",
      "blast",
      "rifle",
      "pistol",
      "blade",
      "shot",
      "bomb",
    ],
    subcategories: [
      {
        name: "Gunshot",
        keywords: ["gun", "rifle", "pistol", "shot", "shoot"],
      },
      { name: "Sword", keywords: ["sword", "blade", "sabre", "saber"] },
      { name: "Explosion", keywords: ["explosion", "blast", "bomb"] },
    ],
  },
];

function tokenize(text: string): string[] {
  return text
    .replace(/[_.\-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// 단어 하나짜리 키워드는 토큰 정확 일치로만 점수를 주고(예: "Blastwave FX" 폴더명의
// "blastwave"가 "blast" 키워드와 substring으로 우연히 겹쳐 오분류되는 것을 방지),
// 공백이 들어간 구문 키워드("free spin" 등)만 원문 문자열 substring으로 매칭한다.
function scoreKeywords(
  text: string,
  tokens: Set<string>,
  keywords: string[],
): number {
  let score = 0;
  for (const raw of keywords) {
    const kw = raw.toLowerCase();
    if (kw.includes(" ")) {
      if (text.includes(kw)) score += 2;
      continue;
    }
    if (tokens.has(kw)) score += 2;
  }
  return score;
}

export interface ClassifyInput {
  filename: string;
  folderPath?: string;
  tags?: string[];
  description?: string | null;
}

export interface ClassifyResult {
  category: string;
  subcategory: string;
}

export function classifySound(input: ClassifyInput): ClassifyResult {
  // 원본 대소문자를 유지한 채 토큰화해야 CamelCase("MetalPipeImpact"→metal/pipe/impact)가
  // 올바로 분리된다. 구문(공백 포함) 키워드 매칭에는 소문자화한 text를 사용.
  const rawText = [
    input.filename,
    input.folderPath ?? "",
    ...(input.tags ?? []),
    input.description ?? "",
  ].join(" ");
  const text = rawText.toLowerCase();
  const tokens = new Set(tokenize(rawText));

  let best: { category: string; subcategory: string; score: number } | null =
    null;

  for (const rule of TAXONOMY) {
    // 대분류 자체 키워드 + 모든 소분류 키워드(가중치 절반)를 합산해 다중 특성을 반영
    let categoryScore = scoreKeywords(text, tokens, rule.keywords);
    for (const sub of rule.subcategories) {
      categoryScore += scoreKeywords(text, tokens, sub.keywords) * 0.5;
    }
    if (categoryScore <= 0) continue;

    let bestSub: { name: string; score: number } | null = null;
    for (const sub of rule.subcategories) {
      const subScore = scoreKeywords(text, tokens, sub.keywords);
      if (!bestSub || subScore > bestSub.score)
        bestSub = { name: sub.name, score: subScore };
    }

    if (!best || categoryScore > best.score) {
      best = {
        category: rule.category,
        subcategory: bestSub && bestSub.score > 0 ? bestSub.name : "General",
        score: categoryScore,
      };
    }
  }

  // 최소 점수 임계값: 대분류 키워드 1개(=2점) 또는 소분류 키워드 2개 이상(=2점)이 모여야 분류.
  // 이렇게 하면 'wild'·'spin' 같은 일반어 하나만으로는(=1점) 카테고리가 성립하지 않아
  // 다른 라이브러리(동물/차량 등)의 오분류를 크게 줄인다.
  if (!best || best.score < 2)
    return { category: UNCATEGORIZED, subcategory: "" };
  return { category: best.category, subcategory: best.subcategory };
}
