import { app } from "electron";
import { join } from "path";
import { cpus } from "os";
import { getDb } from "./db";
import { translateKoreanQuery } from "../shared/koreanTerms";

// 의미 검색용 텍스트 임베딩 ------------------------------------------------
//
// 키워드 검색(FTS5)은 라이브러리에 들어 있는 정확한 단어를 알아야 찾을 수 있다.
// "긴 금속 긁힌 소리" 같은 설명으로 찾으려면 뜻이 가까운 것을 재는 수단이 필요하다.
//
// 오디오가 아니라 파일명·카테고리 텍스트를 임베딩한다. 이 라이브러리는 오디오가 3.10TB인
// 반면 파일명이 100% 채워져 있고(평균 41자) 충분히 서술적이다 — 오디오를 디코딩하면
// 하루 단위 작업인데 텍스트는 실측 130건/초로 전량 약 65분이면 끝난다.
//
// 모델은 multilingual-e5-small(int8, 384차원). e5 계열은 문서에 "passage: ",
// 질의에 "query: " 접두어를 요구한다 — 빼면 검색 품질이 눈에 띄게 떨어진다.
const MODEL_ID = "multilingual-e5-small";
export const EMBED_DIM = 384;

// 모델은 앱에 동봉한다. 런타임에 HuggingFace에서 받아오면 첫 검색이 네트워크에 묶이고,
// 무엇보다 이 앱은 오프라인 전용이 원칙이다(CLAUDE.md: 클라우드 기능 금지).
// 패키징 전에는 프로젝트의 build/models, 패키징 후에는 extraResources로 복사된
// resources/models를 본다 — 아이콘(ICON_PATH)과 같은 방식이다.
function modelRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "models")
    : join(__dirname, "../../build/models");
}

// 배치가 클수록 처리량이 좋지만, 한 배치가 도는 동안은 CPU가 그쪽에 묶여 검색이 밀린다.
// 64건이면 한 덩어리가 0.5초쯤이라 그 사이에 친 검색어가 눈에 띄게 늦게 반응했다.
// 16으로 줄여 최악 대기를 1/4로 만든다 — 처리량은 조금 손해지만 백그라운드 작업이므로
// 총 시간보다 "쓰는 동안 안 걸리는 것"이 중요하다.
const BATCH = 16;
// 한 번에 다 돌리지 않고 끊어서 진행한다 — 그 사이 검색/재생 IPC가 처리되어야 한다.
const CHUNK_PAUSE_MS = 8;

// 모델 추론에 쓸 스레드 수. 기본값은 코어를 전부 쓰는데, 그러면 백필이 도는 동안
// 이 앱뿐 아니라 시스템 전체가 느려진다(실측: 다른 프로그램까지 버벅였다).
// 절반만 쓰게 해서 나머지를 UI와 다른 프로그램에 남긴다.
const INFERENCE_THREADS = Math.max(1, Math.floor(cpus().length / 2));

// 사용자가 앱을 쓰는 동안에는 백필을 멈춘다 ----------------------------------
//
// 백필은 몇 시간에 걸쳐 도는 배경 작업이고(51만 건), 검색·재생은 사용자가 지금 기다리는
// 작업이다. 둘이 같은 CPU를 놓고 다투면 항상 사용자 쪽이 이겨야 한다. 상호작용 IPC가
// 들어오면 "언제까지 조용히 있을지"를 찍어두고, 백필은 그때까지 새 배치를 시작하지
// 않는다. 이미 시작한 배치는 끝까지 간다 — 그래서 BATCH를 작게 잡았다.
//
// 조용히 있을 시간은 작업마다 다르다. 검색은 IPC가 끝나면 사실상 끝나지만, 재생은
// IPC가 돌려준 뒤부터가 진짜다 — 렌더러가 파일을 디코딩해 웨이브폼을 그리는 동안
// CPU를 많이 쓰는데 그건 메인 프로세스에서 보이지 않는다. 그래서 더 길게 잡는다.
const QUIET_AFTER_SEARCH_MS = 1500;
const QUIET_AFTER_PLAYBACK_MS = 5000;

let busyUntil = 0;

/** 사용자가 뭔가 하고 있음을 알린다. 백필이 이걸 보고 비켜준다. */
export function noteUserActivity(quietMs = QUIET_AFTER_SEARCH_MS): void {
  busyUntil = Math.max(busyUntil, Date.now() + quietMs);
}

/** 재생·웨이브폼처럼 IPC가 끝난 뒤에도 렌더러가 한참 일하는 작업용. */
export function noteUserPlayback(): void {
  noteUserActivity(QUIET_AFTER_PLAYBACK_MS);
}

/** 지금 백필이 비켜줘야 하는가. 루프가 이걸 보고 배치 시작을 미룬다. */
export function shouldYieldToUser(now = Date.now()): boolean {
  return now < busyUntil;
}

async function waitUntilUserIsIdle(shouldStop?: () => boolean): Promise<void> {
  while (shouldYieldToUser()) {
    if (shouldStop?.()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

type Extractor = (
  texts: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

let extractorPromise: Promise<Extractor> | null = null;

// transformers.js는 ESM 전용이라 패키징된 CJS 빌드에서 static import가 깨진다 —
// music-metadata와 같은 이유로 동적 import를 쓴다.
function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // 동봉한 모델만 쓴다 — 네트워크로 나가지 않게 못을 박는다.
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = modelRoot();
      return (await pipeline("feature-extraction", MODEL_ID, {
        dtype: "q8",
        // session_options는 onnxruntime의 InferenceSession.create()로 그대로 넘어간다.
        session_options: {
          intraOpNumThreads: INFERENCE_THREADS,
          interOpNumThreads: 1,
        },
      })) as unknown as Extractor;
    })();
  }
  return extractorPromise;
}

/**
 * 임베딩에 넣을 텍스트. 파일명은 언더스코어·하이픈으로 이어붙은 형태가 많아 낱말로
 * 풀어줘야 모델이 제대로 읽는다(`footstep_a_mech_mega_01` → `footstep a mech mega 01`).
 */
export function embedText(row: {
  filename: string;
  category: string | null;
  subcategory: string | null;
}): string {
  const name = row.filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cat = [row.category, row.subcategory].filter(Boolean).join(" ");
  return cat ? `${name} ${cat}` : name;
}

/** float32 → int8. 정규화된 벡터라 값이 [-1,1]이므로 127을 곱해 반올림하면 된다. */
export function quantize(vec: Float32Array | number[]): Buffer {
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
  }
  return Buffer.from(out.buffer);
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const extract = await getExtractor();
  const out = await extract(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

/** 검색어 하나를 임베딩한다. e5는 질의에 "query: " 접두어를 요구한다. */
export async function embedQuery(query: string): Promise<Buffer> {
  // 한국어 질의는 사전으로 영어로 옮긴 뒤 임베딩한다 — 다국어 모델의 한국어→영어
  // 교차 검색이 실측에서 신통치 않았다(koreanTerms.ts 주석 참조).
  const [vec] = await embedBatch(["query: " + translateKoreanQuery(query)]);
  return quantize(vec);
}

export interface EmbedProgress {
  done: number;
  total: number;
}

let running = false;

// "벡터가 없는 트랙"을 고르는 조건. NOT IN (SELECT rowid FROM tracks_vec)로 쓰면
// tracks_vec을 매번 통째로 훑어 배치마다 35ms가 든다(51만 건 실측). rowid로 LEFT JOIN하면
// 인덱스를 타서 1ms다 — 배치가 수만 번 도는 작업이라 이 차이가 그대로 쌓인다.
const MISSING_VECTOR_JOIN = `
  FROM tracks t LEFT JOIN tracks_vec v ON v.rowid = t.id
  WHERE v.rowid IS NULL`;

/** 임베딩이 아직 없는 트랙 수 */
export function pendingEmbedCount(): number {
  return getDb()
    .prepare(`SELECT count(*) ${MISSING_VECTOR_JOIN}`)
    .pluck()
    .get() as number;
}

/**
 * 임베딩이 없는 트랙을 채운다. 중단되면 다음 호출이 남은 것부터 이어서 한다 —
 * 51만 건은 한 번에 끝나지 않을 수 있고, 앱을 껐다 켜도 진행이 유지돼야 한다.
 */
export async function backfillEmbeddings(
  onProgress?: (p: EmbedProgress) => void,
  shouldStop?: () => boolean,
): Promise<void> {
  if (running) return; // 동시에 두 번 돌면 같은 행을 두 번 넣는다
  running = true;
  try {
    const d = getDb();
    const total = pendingEmbedCount();
    if (total === 0) return;

    const pick = d.prepare(
      `SELECT t.id, t.filename, t.category, t.subcategory
       ${MISSING_VECTOR_JOIN} LIMIT ?`,
    );
    const insert = d.prepare(
      "INSERT INTO tracks_vec(rowid, embedding) VALUES (?, vec_int8(?))",
    );

    let done = 0;
    for (;;) {
      if (shouldStop?.()) return;
      // 사용자가 검색을 치고 있으면 조용해질 때까지 비켜준다.
      await waitUntilUserIsIdle(shouldStop);
      if (shouldStop?.()) return;
      const rows = pick.all(BATCH) as {
        id: number;
        filename: string;
        category: string | null;
        subcategory: string | null;
      }[];
      if (rows.length === 0) return;

      const vecs = await embedBatch(
        rows.map((r) => "passage: " + embedText(r)),
      );
      // 배치 단위 트랜잭션 — 건건이 쓰면 51만 건에서 디스크가 병목이 된다.
      d.transaction(() => {
        rows.forEach((r, i) => {
          // sqlite-vec의 rowid는 BigInt로 넘겨야 한다(숫자로 주면 정수가 아니라고 거부한다)
          insert.run(BigInt(r.id), quantize(vecs[i]));
        });
      })();

      done += rows.length;
      onProgress?.({ done, total });
      await new Promise((r) => setTimeout(r, CHUNK_PAUSE_MS));
    }
  } finally {
    running = false;
  }
}
