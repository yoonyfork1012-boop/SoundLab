import { app } from "electron";
import { join } from "path";
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

// 배치가 클수록 처리량이 좋지만 메모리도 는다. 실측 130건/초는 이 크기 기준이다.
const BATCH = 64;
// 한 번에 다 돌리지 않고 끊어서 진행한다 — 그 사이 검색/재생 IPC가 처리되어야 한다.
const CHUNK_PAUSE_MS = 8;

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

/** 임베딩이 아직 없는 트랙 수 */
export function pendingEmbedCount(): number {
  return getDb()
    .prepare(
      `SELECT count(*) FROM tracks
       WHERE id NOT IN (SELECT rowid FROM tracks_vec)`,
    )
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
      `SELECT id, filename, category, subcategory FROM tracks
       WHERE id NOT IN (SELECT rowid FROM tracks_vec) LIMIT ?`,
    );
    const insert = d.prepare(
      "INSERT INTO tracks_vec(rowid, embedding) VALUES (?, vec_int8(?))",
    );

    let done = 0;
    for (;;) {
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
