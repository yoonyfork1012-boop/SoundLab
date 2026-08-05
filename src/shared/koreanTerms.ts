// 한국어 검색어를 영어 사운드 용어로 바꾼다.
//
// 라이브러리 파일명·카테고리는 전부 영어라, 한국어로 치면 지금은 아무것도 안 나온다.
// 다국어 임베딩 모델(multilingual-e5)로 해결해보려 했지만 실측에서 실패했다 —
// 같은 표본에서 "gun reload"는 Gun Reloading을 0.882로 정확히 찾는데 "총 장전"은
// 엉뚱한 타격음을 물어왔고, 모델을 small→base로 키워도 마찬가지였다. 사운드 용어는
// 어휘가 한정적이라 사전 쪽이 훨씬 정확하고 빠르다(Soundly도 "search translation"을
// 의미 검색과 별도로 광고한다).
//
// 여기서 나온 영어 질의는 기존 키워드 검색과 의미 검색 양쪽에 그대로 쓰인다.

// 긴 표현이 먼저 잡혀야 한다("발자국"이 "발"보다, "자동차"가 "차"보다 먼저).
// 정렬은 아래에서 자동으로 하므로 여기서는 신경 쓰지 않아도 된다.
const TERMS: Record<string, string> = {
  // 문·여닫기
  문: "door",
  현관: "door",
  서랍: "drawer",
  창문: "window",
  여는: "open",
  열기: "open",
  열림: "open",
  닫는: "close",
  닫기: "close",
  닫힘: "close",
  잠그는: "lock",
  잠금: "lock",
  노크: "knock",
  두드리는: "knock",

  // 재질
  금속: "metal",
  쇠: "metal",
  철: "metal",
  유리: "glass",
  나무: "wood",
  목재: "wood",
  플라스틱: "plastic",
  종이: "paper",
  천: "cloth",
  옷: "cloth",
  돌: "rock",
  바위: "rock",
  흙: "dirt",
  모래: "sand",
  자갈: "gravel",
  얼음: "ice",
  눈: "snow",

  // 동작
  긁는: "scrape",
  긁힘: "scrape",
  긁기: "scrape",
  부딪히는: "impact",
  충돌: "impact",
  타격: "impact",
  때리는: "hit",
  치는: "hit",
  깨지는: "break",
  깨짐: "break",
  부서지는: "break",
  부수는: "break",
  떨어지는: "drop",
  떨어짐: "drop",
  흐르는: "flow",
  흐름: "flow",
  구르는: "roll",
  미끄러지는: "slide",
  긁적: "scratch",
  삐걱: "squeak",
  끼익: "squeak",
  쾅: "slam",
  펑: "explosion",

  // 발소리·사람
  발자국: "footstep",
  발소리: "footstep",
  걷는: "walk",
  걸음: "walk",
  뛰는: "run",
  달리는: "run",
  목소리: "voice",
  음성: "voice",
  사람: "human",
  남자: "male",
  여자: "female",
  아이: "child",
  군중: "crowd",
  비명: "scream",
  웃음: "laugh",
  숨: "breath",
  호흡: "breath",

  // 무기·전투
  총: "gun",
  총성: "gunshot",
  총소리: "gunshot",
  발사: "shot",
  장전: "reload",
  무기: "weapon",
  칼: "knife",
  검: "sword",
  폭발: "explosion",
  전쟁: "war",

  // 자연·환경
  물: "water",
  비: "rain",
  바람: "wind",
  천둥: "thunder",
  번개: "lightning",
  불: "fire",
  화염: "fire",
  파도: "wave",
  바다: "ocean",
  강: "river",
  숲: "forest",
  새: "bird",
  개: "dog",
  고양이: "cat",
  동물: "animal",
  괴물: "monster",
  생명체: "creature",
  앰비언스: "ambience",
  배경음: "ambience",

  // 탈것·기계
  자동차: "car",
  차량: "vehicle",
  엔진: "engine",
  기계: "machine",
  기계음: "mechanical",
  모터: "motor",
  비행기: "airplane",
  헬리콥터: "helicopter",
  기차: "train",
  경적: "horn",

  // 게임·UI·연출
  마법: "magic",
  버튼: "button",
  클릭: "click",
  메뉴: "menu",
  알림: "notification",
  동전: "coin",
  휙: "whoosh",
  휘두르는: "whoosh",
  스윙: "whoosh",
  발소리음: "footstep",
  음악: "music",
  타이핑: "typing",
  키보드: "keyboard",

  // 형용사·수식
  큰: "large",
  작은: "small",
  긴: "long",
  짧은: "short",
  무거운: "heavy",
  가벼운: "light",
  빠른: "fast",
  느린: "slow",
  높은: "high",
  낮은: "low",
  깊은: "deep",
  부드러운: "soft",
  거친: "rough",
  단단한: "hard",
};

// "소리"·"효과음" 같은 말은 모든 파일에 해당해서 검색에 도움이 안 된다 — 떨어낸다.
const FILLERS = new Set([
  "소리",
  "사운드",
  "효과음",
  "음",
  "나는",
  "내는",
  "하는",
]);

// 긴 것부터 매칭해야 "발자국"이 "발"로 쪼개지지 않는다.
const SORTED_TERMS = Object.keys(TERMS).sort((a, b) => b.length - a.length);

const HANGUL = /[가-힣]/;

export function hasKorean(text: string): boolean {
  return HANGUL.test(text);
}

/**
 * 한국어가 섞인 검색어를 영어 사운드 용어로 바꾼다. 한국어가 없으면 그대로 돌려준다.
 * 사전에 없는 한국어 조각은 버린다 — 라이브러리에 한글이 없어 남겨봐야 결과를 0건으로
 * 만들 뿐이다. 다만 전부 버려져 빈 문자열이 되면 원본을 그대로 돌려준다(무엇도 못 찾는
 * 것보다 낫고, 호출부가 "번역 실패"를 따로 처리하지 않아도 된다).
 */
export function translateKoreanQuery(query: string): string {
  if (!hasKorean(query)) return query;

  let rest = query;
  const out: string[] = [];

  // 사전 표제어를 긴 것부터 찾아 빼내고, 남은 한글은 마지막에 버린다.
  for (const term of SORTED_TERMS) {
    if (!rest.includes(term)) continue;
    const english = TERMS[term];
    if (!out.includes(english)) out.push(english);
    rest = rest.split(term).join(" ");
  }

  // 한글이 아닌 조각(영어 단어, 숫자)은 그대로 살린다 — "metal 긁힘" 같은 혼용 질의.
  for (const token of rest.split(/\s+/)) {
    const clean = token.replace(/[가-힣]+/g, "").trim();
    if (!clean || FILLERS.has(token)) continue;
    if (!out.includes(clean)) out.push(clean);
  }

  const translated = out.join(" ").replace(/\s+/g, " ").trim();
  return translated || query;
}

// 영어 동의어 ---------------------------------------------------------------
//
// 팩마다 같은 것을 다른 이름으로 부른다 — 어떤 라이브러리는 Car, 어떤 라이브러리는
// Vehicle이다. 사용자가 어느 쪽을 치든 나오게 검색 시 OR로 펼친다. 표에 없는
// 먼 관계("가죽 스치는" ↔ leather rustle)는 임베딩 의미 검색이 맡으므로 여기는
// "다른 이름일 뿐인 것"만 담는다.
//
// 한 단어는 한 무리에만 넣는다(두 곳에 넣으면 뒤에 온 무리가 이긴다).
const SYNONYM_GROUPS: string[][] = [
  // 탈것·기계
  ["car", "vehicle", "automobile"],
  ["engine", "motor", "motorized"],
  ["airplane", "aircraft", "plane", "jet"],
  ["helicopter", "chopper", "rotor"],
  ["train", "railway", "locomotive"],
  ["horn", "honk"],
  ["machine", "machinery", "mechanical", "mechanism"],

  // 무기·전투
  ["gun", "firearm", "pistol", "rifle", "weapon"],
  ["gunshot", "gunfire", "shoot", "shot"],
  ["explosion", "explode", "blast", "detonation"],
  ["knife", "blade", "sword"],

  // 충격·파괴
  ["impact", "hit", "crash", "bang", "thump"],
  ["break", "smash", "shatter", "destroy"],
  ["drop", "fall", "thud"],
  ["scrape", "scratch", "rub", "grind"],
  ["squeak", "creak", "squeal"],
  ["slide", "sliding", "slip"],

  // 재질
  ["metal", "metallic", "steel", "iron"],
  ["wood", "wooden", "timber"],
  ["glass", "crystal"],
  ["cloth", "fabric", "textile", "leather"],
  ["paper", "cardboard"],
  ["rock", "stone", "gravel"],

  // 문·조작
  ["door", "gate", "hatch"],
  ["open", "opening"],
  ["close", "closing", "shut"],
  ["lock", "latch", "bolt"],
  ["knock", "rap"],
  ["switch", "toggle", "lever"],

  // 사람
  ["footstep", "footsteps", "step", "steps", "walk"],
  ["run", "running", "sprint", "jog"],
  ["voice", "vocal", "speech"],
  ["scream", "shout", "yell"],
  ["laugh", "laughter", "giggle"],
  ["crowd", "audience", "people"],
  ["breath", "breathing", "breathe"],

  // 자연·생물
  ["water", "liquid", "splash"],
  ["rain", "storm", "downpour"],
  ["wind", "breeze", "gust"],
  ["fire", "flame", "burn", "burning"],
  ["wave", "ocean", "sea", "surf"],
  ["monster", "creature", "beast", "animal"],
  ["dog", "canine", "bark"],
  ["cat", "feline", "meow"],
  ["bird", "birds", "chirp"],

  // 게임·UI·연출
  ["whoosh", "swoosh", "swish", "swipe"],
  ["click", "tap", "button"],
  ["notification", "alert", "ping"],
  ["alarm", "siren", "buzzer"],
  ["bell", "chime", "ding"],
  ["magic", "spell", "fantasy"],
  ["coin", "money", "cash"],
  ["electric", "electricity", "electrical", "spark"],
  ["computer", "digital", "tech"],
  ["typing", "keyboard", "keystroke"],
  ["ambience", "ambient", "atmosphere", "atmos"],
  ["music", "musical", "melody"],
];

const SYNONYM_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) SYNONYM_INDEX.set(word, group);
}

/** 같은 무리의 단어들(자기 자신 포함). 표에 없으면 자기 자신만. */
export function synonymsOf(word: string): string[] {
  return SYNONYM_INDEX.get(word.toLowerCase()) ?? [word];
}
