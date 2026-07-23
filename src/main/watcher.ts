import { watch as fsWatch, type FSWatcher } from "fs";
import { existsSync } from "fs";
import { stat as fsStat } from "fs/promises";
import { join } from "path";
import type { BrowserWindow } from "electron";
import {
  collectAudioFilesUnder,
  computeFileHash,
  indexSingleFile,
  isIgnoredFilename,
  isIndexableAudioFile,
} from "./scanner";
import {
  deleteTrackByPath,
  findRenameCandidate,
  getTrackByPath,
  updateTrackPathOnly,
} from "./db/queries";
import { schedulePersist } from "./db";
import { runExclusive } from "./db/txLock";
import { removeEmbeddedArtworkCache } from "./artwork";
import type { Track, TracksChanged, WatchStatus } from "../shared/types";

// 실시간 라이브러리 감시 — Soundly의 "Monitor for changes".
//
// 처음에는 chokidar(폴더 1개당 네이티브 watch 핸들을 개별로 여는 방식)로 구현했으나, 실제
// 대용량 라이브러리(4만+ 파일, 1.2만+ 하위폴더)에서 초기 감시 설정에만 몇 분이 걸려 사실상
// 동작하지 않는 문제가 있었다(직접 재현 테스트로 확인). 그래서 Node/Windows가 기본 제공하는
// 단일 재귀 watch 핸들(fs.watch(root, {recursive:true}))을 이벤트 소스로 쓰고, 그 위에
// 디바운스·안정화(파일 복사 중 감지 방지)·큐 기반 순차 처리·이름변경/이동 감지 로직을 직접
// 얹었다. 폴더 개수와 무관하게 OS 레벨에서 하나의 핸들로 트리 전체를 감시하므로 대용량
// 라이브러리에서도 즉시 반응한다.

// 같은 경로에 대해 연속으로 들어오는 raw 이벤트를 이 시간만큼 모아서 한 번만 처리한다
// (복사/저장 중 여러 번 이벤트가 튀는 것을 방지).
const DEBOUNCE_MS = 400;
// 안정화 체크 — 이 간격을 두고 두 번 stat해서 size/mtime이 같으면 "쓰기가 끝났다"고 판단한다.
// 대용량 파일 복사 도중에는 계속 달라지므로 안정될 때까지 재검사를 반복한다.
const STABILITY_GAP_MS = 400;
// 안정화 재시도 상한 — 계속 쓰이는 로그성 파일이 무한 루프를 돌지 않도록.
const MAX_SETTLE_ATTEMPTS = 40;
// unlink 이후 이 시간 안에 동일 내용의 add가 오면 rename/move로 간주. 그 전에는 실제 삭제를
// 확정하지 않는다 — "삭제 후 재추가" 같은 연속 이벤트에도 중복/오탐 없이 대응하기 위함.
const RENAME_GRACE_MS = 3000;
// 배치가 끝난 뒤 "Indexed N files" 같은 요약 상태를 보여주는 시간 — 이후 자동으로 Watching으로 복귀.
const STATUS_LINGER_MS = 3000;
// watcher 오류 발생 시 자동 재시작까지의 대기 시간
const RESTART_DELAY_MS = 5000;
// 폴더 하나가 통째로 복사되었을 때 한 번에 받아들일 파일 수 상한 — 그 이상은 수동/증분
// 스캔이 처리한다(감시 큐가 수만 건으로 부풀어 앱이 굳는 것을 방지).
const DIR_ADD_LIMIT = 5000;

type QueueEvent = {
  type: "add" | "change" | "unlink" | "adddir";
  path: string;
};

interface PendingRemoval {
  filePath: string;
  trackId: number;
  size: number | null;
  hash: string | null;
  timer: NodeJS.Timeout;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LibraryWatcher {
  private watcher: FSWatcher | null = null;
  private queue: QueueEvent[] = [];
  private queued = new Set<string>();
  private draining = false;
  private restarting = false;
  private stopped = false;
  private pendingUnlinks = new Map<string, PendingRemoval>();
  // 경로별 디바운스 타이머 — 안정화 체크가 끝나기 전에 또 이벤트가 오면 다시 미룬다.
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private settleAttempts = new Map<string, number>();
  private batchIndexed = 0;
  private batchMoved = 0;
  // 렌더러로 한 번에 보낼 변경분. 트랙 1건마다 IPC를 보내면 렌더러가 수십만 트랙의 파생
  // 인덱스(폴더트리/검색 인덱스)를 매 건마다 통째로 다시 만들어 앱이 굳는다.
  private batchAdded: Track[] = [];
  private batchUpdated: Track[] = [];
  private lingerTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly libraryId: number,
    private readonly rootPath: string,
    private readonly win: BrowserWindow,
  ) {
    this.start();
  }

  private start(): void {
    const watcher = fsWatch(
      this.rootPath,
      { recursive: true },
      (_eventType, filename) => {
        if (!filename) return;
        const name = filename.toString();
        const base = name.split(/[\\/]/).pop() ?? name;
        // 임시 파일/숨김 파일은 아예 큐에 올리지 않는다(복사 중 만들어졌다 사라지는 것들).
        if (isIgnoredFilename(base)) return;
        this.scheduleCheck(join(this.rootPath, name));
      },
    );
    watcher.on("error", (err) => this.handleError(err as Error));
    this.watcher = watcher;
    this.sendStatus({ kind: "watching" });
  }

  // raw 이벤트를 경로별로 모아 디바운스한 뒤, 안정화 체크(settleAndEnqueue)로 넘긴다.
  private scheduleCheck(absPath: string): void {
    const existing = this.debounceTimers.get(absPath);
    if (existing) clearTimeout(existing);
    this.sendStatus({
      kind: "updating",
      count: this.debounceTimers.size + this.queue.length + 1,
    });
    const timer = setTimeout(() => {
      this.debounceTimers.delete(absPath);
      void this.settleAndEnqueue(absPath);
    }, DEBOUNCE_MS);
    this.debounceTimers.set(absPath, timer);
  }

  // 파일이 삭제됐는지, 아직 쓰는 중(크기가 계속 바뀜)인지, 다 쓰고 안정된 상태인지 판별한다.
  // 안정됐을 때만 큐에 넣어 실제 인덱싱/삭제 처리로 넘긴다.
  private async settleAndEnqueue(absPath: string): Promise<void> {
    if (this.stopped) return;
    const first = await fsStat(absPath).catch(() => null);
    if (!first) {
      this.settleAttempts.delete(absPath);
      // 사라진 경로 — DB에 있던 오디오 파일일 때만 삭제 후보로 다룬다.
      if (isIndexableAudioFile(absPath)) this.enqueue("unlink", absPath);
      return;
    }
    // 새로 생긴 폴더(폴더째 복사/이동) — 하위 파일 이벤트가 개별로 오지 않는 경우가 있어
    // 폴더 단위로 훑어 보완한다.
    if (first.isDirectory()) {
      this.settleAttempts.delete(absPath);
      this.enqueue("adddir", absPath);
      return;
    }
    if (!isIndexableAudioFile(absPath)) {
      this.settleAttempts.delete(absPath);
      return;
    }

    await delay(STABILITY_GAP_MS);
    if (this.stopped) return;
    const second = await fsStat(absPath).catch(() => null);
    if (!second) {
      this.settleAttempts.delete(absPath);
      this.enqueue("unlink", absPath);
      return;
    }
    if (second.size !== first.size || second.mtimeMs !== first.mtimeMs) {
      // 아직 쓰는 중(대용량 파일 복사 등) — 다시 한 번 디바운스 사이클을 건다.
      // 끝없이 쓰이는 파일에 물리지 않도록 재시도 횟수에 상한을 둔다.
      const attempts = (this.settleAttempts.get(absPath) ?? 0) + 1;
      if (attempts > MAX_SETTLE_ATTEMPTS) {
        this.settleAttempts.delete(absPath);
        return;
      }
      this.settleAttempts.set(absPath, attempts);
      this.scheduleCheck(absPath);
      return;
    }
    this.settleAttempts.delete(absPath);
    const alreadyIndexed = !!getTrackByPath(absPath);
    this.enqueue(alreadyIndexed ? "change" : "add", absPath);
  }

  private enqueue(type: QueueEvent["type"], path: string): void {
    if (this.stopped) return;
    // 같은 경로가 큐에 이미 들어 있으면 다시 넣지 않는다 — 자동 감지와 폴더 단위 보완
    // 스캔이 같은 파일을 두 번 인덱싱하는 것을 막는다.
    const key = `${type}:${path}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push({ type, path });
    this.sendStatus({ kind: "updating", count: this.queue.length });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      this.queued.delete(`${event.type}:${event.path}`);
      try {
        await this.process(event);
      } catch (err) {
        console.error(
          "watcher: failed to process event",
          event,
          (err as Error)?.message,
        );
      }
      if (this.queue.length > 0)
        this.sendStatus({ kind: "updating", count: this.queue.length });
    }
    this.draining = false;
    this.finishBatch();
  }

  private async process(event: QueueEvent): Promise<void> {
    if (event.type === "unlink") return this.handleUnlink(event.path);
    if (event.type === "adddir") return this.handleAddDir(event.path);
    if (event.type === "add") return this.handleAdd(event.path);
    return this.handleChange(event.path);
  }

  // 새로 생긴(또는 이동해 들어온) 폴더 — 하위 오디오 파일을 큐에 밀어 넣는다.
  // 이미 인덱싱된 파일은 큐 dedupe와 handleAdd/handleChange가 알아서 정리한다.
  private async handleAddDir(dirPath: string): Promise<void> {
    const files = await collectAudioFilesUnder(dirPath, DIR_ADD_LIMIT);
    for (let i = 0; i < files.length; i++) {
      // 이미 인덱싱된 파일은 건드리지 않는다(중복 처리 방지)
      if (getTrackByPath(files[i])) continue;
      this.enqueue("add", files[i]);
      // sql.js 조회는 동기라 수천 건을 한 루프에서 돌리면 그동안 메인 프로세스가 멈춘다.
      if (i % 200 === 199) await new Promise((r) => setImmediate(r));
    }
  }

  // 파일이 사라진 즉시 지우지 않고 그레이스 윈도우 동안 보류한다 — 곧 이름변경/이동으로
  // 판명되면 handleAdd에서 이 항목을 찾아 삭제 대신 경로만 갱신한다.
  private handleUnlink(filePath: string): void {
    const track = getTrackByPath(filePath);
    if (!track) return;
    const existing = this.pendingUnlinks.get(filePath);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(
      () => void this.finalizeRemoval(filePath),
      RENAME_GRACE_MS,
    );
    this.pendingUnlinks.set(filePath, {
      filePath,
      trackId: track.id,
      size: track.fileSize,
      hash: track.fileHash,
      timer,
    });
  }

  // 그레이스 윈도우(RENAME_GRACE_MS) 타이머가 만료되면 호출된다 — 이 시점은 큐 드레인
  // 루프가 이미 끝나고 finishBatch()도 이미 실행된 뒤일 수 있으므로(add/change 배치와
  // 타이밍이 완전히 분리돼 있음), 여기서 직접 변경분을 렌더러로 보내고 저장을 예약한다.
  private async finalizeRemoval(filePath: string): Promise<void> {
    const pending = this.pendingUnlinks.get(filePath);
    if (!pending) return;
    this.pendingUnlinks.delete(filePath);
    // 진행 중인 스캔 트랜잭션과 겹치지 않도록 같은 큐를 탄다.
    await runExclusive(() => {
      deleteTrackByPath(filePath);
    });
    removeEmbeddedArtworkCache(filePath);
    schedulePersist();
    this.sendStatus({ kind: "removed", message: "Removed 1 missing file" });
    this.sendChanges({ added: [], updated: [], removedIds: [pending.trackId] });
    this.scheduleLinger();
  }

  private async handleAdd(filePath: string): Promise<void> {
    const info = await fsStat(filePath).catch(() => null);
    if (!info) return;
    const hash = await computeFileHash(filePath);

    // 1) 이번 세션에서 방금 사라진 파일 중 내용이 같은 것이 있는지 확인 (이름변경/이동)
    let matched: PendingRemoval | null = null;
    for (const pending of this.pendingUnlinks.values()) {
      if (pending.size === info.size && hash && pending.hash === hash) {
        matched = pending;
        break;
      }
    }
    // 2) 세션 밖(예: unlink 이벤트를 놓친 경우)에서도 DB에 동일 내용의 트랙이 남아있고,
    //    그 파일이 실제로는 더 이상 존재하지 않으면 이동으로 간주
    let dbCandidateId: number | null = null;
    if (!matched && hash) {
      const candidate = findRenameCandidate(
        this.libraryId,
        info.size,
        hash,
        filePath,
      );
      if (candidate && !existsSync(candidate.filePath))
        dbCandidateId = candidate.id;
    }

    if (matched || dbCandidateId != null) {
      if (matched) {
        clearTimeout(matched.timer);
        this.pendingUnlinks.delete(matched.filePath);
      }
      const trackId = matched?.trackId ?? dbCandidateId!;
      const filename = filePath.split(/[\\/]/).pop() ?? filePath;
      const track = await runExclusive(() => {
        updateTrackPathOnly(
          trackId,
          filePath,
          filename,
          info.mtimeMs,
          info.size,
        );
        return getTrackByPath(filePath);
      });
      this.batchMoved++;
      if (track) this.batchUpdated.push(track);
      this.scheduleLinger();
      return;
    }

    // 3) 완전히 새로운 파일
    const track = await runExclusive(() =>
      indexSingleFile(filePath, this.libraryId, this.rootPath),
    );
    if (track) {
      this.batchIndexed++;
      this.batchAdded.push(track);
      this.scheduleLinger();
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    const track = await runExclusive(() =>
      indexSingleFile(filePath, this.libraryId, this.rootPath),
    );
    if (track) {
      this.batchIndexed++;
      this.batchUpdated.push(track);
      this.scheduleLinger();
    }
  }

  private scheduleLinger(): void {
    if (this.lingerTimer) return;
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      if (this.queue.length === 0 && !this.draining)
        this.sendStatus({ kind: "watching" });
    }, STATUS_LINGER_MS);
  }

  // add/change 이벤트는(삭제와 달리) 큐 드레인 루프 안에서 동기적으로 끝나므로, 배치가
  // 끝난 시점에 카운트가 정확하다 — 삭제(finalizeRemoval)는 별도 그레이스 타이머로
  // 처리되므로 여기서는 다루지 않는다(자체적으로 저장/상태 전송함).
  private finishBatch(): void {
    if (this.batchIndexed === 0 && this.batchMoved === 0) {
      this.sendStatus({ kind: "watching" });
      return;
    }
    // sql.js는 저장할 때마다 DB 전체를 직렬화하므로(대용량에서 수백 ms~수 초) 배치마다
    // 즉시 쓰지 않고 디바운스 저장에 맡긴다. 종료 시에는 flushPersist가 기록을 보장한다.
    schedulePersist();
    this.sendChanges({
      added: this.batchAdded,
      updated: this.batchUpdated,
      removedIds: [],
    });
    const parts: string[] = [];
    if (this.batchIndexed > 0)
      parts.push(
        `Indexed ${this.batchIndexed} file${this.batchIndexed > 1 ? "s" : ""}`,
      );
    if (this.batchMoved > 0)
      parts.push(
        `Updated ${this.batchMoved} file${this.batchMoved > 1 ? "s" : ""}`,
      );
    this.sendStatus({ kind: "indexed", message: parts.join(" · ") });
    this.batchIndexed = 0;
    this.batchMoved = 0;
    this.batchAdded = [];
    this.batchUpdated = [];
    this.scheduleLinger();
  }

  private handleError(err: Error): void {
    console.error("watcher error for", this.rootPath, err.message);
    this.sendStatus({ kind: "error", message: "Watch error — retrying…" });
    if (this.restarting || this.stopped) return;
    this.restarting = true;
    const current = this.watcher;
    this.watcher = null;
    current?.close();
    setTimeout(() => {
      this.restarting = false;
      if (!this.stopped) this.start();
    }, RESTART_DELAY_MS);
  }

  private sendChanges(changes: TracksChanged): void {
    if (this.win.isDestroyed()) return;
    if (
      changes.added.length === 0 &&
      changes.updated.length === 0 &&
      changes.removedIds.length === 0
    )
      return;
    this.win.webContents.send("library:tracksChanged", changes);
  }

  private sendStatus(status: Omit<WatchStatus, "libraryId">): void {
    if (this.win.isDestroyed()) return;
    this.win.webContents.send("library:watchStatus", {
      libraryId: this.libraryId,
      ...status,
    } as WatchStatus);
  }

  stop(): void {
    this.stopped = true;
    for (const pending of this.pendingUnlinks.values())
      clearTimeout(pending.timer);
    this.pendingUnlinks.clear();
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    this.settleAttempts.clear();
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.queue = [];
    this.queued.clear();
    this.watcher?.close();
  }
}

const watchers = new Map<number, LibraryWatcher>();

export function startWatching(
  libraryId: number,
  rootPath: string,
  mainWindow: BrowserWindow,
): void {
  if (watchers.has(libraryId)) return;
  try {
    watchers.set(
      libraryId,
      new LibraryWatcher(libraryId, rootPath, mainWindow),
    );
  } catch (err) {
    console.error("watch failed for", rootPath, (err as Error)?.message);
  }
}

export function stopWatching(libraryId: number): void {
  watchers.get(libraryId)?.stop();
  watchers.delete(libraryId);
}

export function stopAllWatching(): void {
  for (const id of [...watchers.keys()]) stopWatching(id);
}
