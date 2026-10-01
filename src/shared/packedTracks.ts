import type { Track } from "./types";

// 시작 시 전체 트랙을 렌더러로 넘기는 압축 형식. 53만 트랙을 { 키: 값 } 객체로 보내면 필드 이름
// 22개가 트랙마다 반복돼 JSON이 327MB가 되고, 메인이 행마다 객체를 만들고 다시 직렬화하느라
// 수 초를 쓴다. 대신 SQLite 행을 배열 그대로(raw) 보내고 렌더러에서 Track으로 되살린다.
// 열 순서가 곧 형식이다 — 메인의 SELECT와 아래 unpackTrack이 이 순서를 공유한다.
export const PACKED_TRACK_COLUMNS = [
  "id",
  "library_id",
  "file_path",
  "filename",
  "duration_ms",
  "sample_rate",
  "bit_depth",
  "channels",
  "category",
  "subcategory",
  "description",
  "tags",
  "starred",
  "artwork_path",
  "artwork_source",
  "added_at",
  "last_played_at",
  "file_size",
  "publisher",
  "is_float",
  "file_hash",
  "markers",
] as const;

export type PackedTrack = unknown[];

/** main/db/queries.ts의 rowToTrack과 같은 결과를 내야 한다(테스트로 묶여 있다). */
export function unpackTrack(r: PackedTrack): Track {
  return {
    id: r[0] as number,
    libraryId: r[1] as number,
    filePath: r[2] as string,
    filename: r[3] as string,
    durationMs: (r[4] as number | null) ?? null,
    sampleRate: (r[5] as number | null) ?? null,
    bitDepth: (r[6] as number | null) ?? null,
    channels: (r[7] as number | null) ?? null,
    category: (r[8] as string | null) ?? null,
    subcategory: (r[9] as string | null) ?? null,
    description: (r[10] as string | null) ?? null,
    tags: r[11] ? (JSON.parse(r[11] as string) as string[]) : [],
    starred: r[12] === 1,
    artworkPath: (r[13] as string | null) ?? null,
    artworkSource: (r[14] as Track["artworkSource"]) ?? null,
    addedAt: r[15] as number,
    lastPlayedAt: (r[16] as number | null) ?? null,
    fileSize: (r[17] as number | null) ?? null,
    publisher: (r[18] as string | null) ?? null,
    isFloat: r[19] === 1,
    fileHash: (r[20] as string | null) ?? null,
    markers: r[21] ? (JSON.parse(r[21] as string) as number[]) : [],
  };
}
