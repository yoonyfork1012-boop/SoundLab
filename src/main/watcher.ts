import { watch as fsWatch, type FSWatcher } from "fs";
import { existsSync } from "fs";
import { stat as fsStat } from "fs/promises";
import { extname, join } from "path";
import type { BrowserWindow } from "electron";
import {
  computeFileHash,
  indexSingleFile,
  SUPPORTED_EXTENSIONS,
} from "./scanner";
import {
  deleteTrackByPath,
  findRenameCandidate,
  getTrackByPath,
  updateTrackPathOnly,
} from "./db/queries";
import { persistDb } from "./db";
import { removeEmbeddedArtworkCache } from "./artwork";
import type { WatchStatus } from "../shared/types";

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
// unlink 이후 이 시간 안에 동일 내용의 add가 오면 rename/move로 간주. 그 전에는 실제 삭제를
// 확정하지 않는다 — "삭제 후 재추가" 같은 연속 이벤트에도 중복/오탐 없이 대응하기 위함.
const RENAME_GRACE_MS = 3000;
// 배치가 끝난 뒤 "Indexed N files" 같은 요약 상태를 보여주는 시간 — 이후 자동으로 Watching으로 복귀.
const STATUS_LINGER_MS = 3000;
// watcher 오류 발생 시 자동 재시작까지의 대기 시간
const RESTART_DELAY_MS = 5000;

type QueueEvent = { type: "add" | "change" | "unlink"; path: string };

interface PendingRemoval {
  filePath: string;
  trackId: number;
  size: number | null;
  hash: string | null;
  timer: NodeJS.Timeout;
}

function isSupportedFile(path: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class LibraryWatcher {
  private watcher: FSWatcher | null = null;
  private queue: QueueEvent[] = [];
  private draining = false;
  private restarting = false;
  private stopped = false;
  private pendingUnlinks = new Map<string, PendingRemoval>();
  // 경로별 디바운스 타이머 — 안정화 체크가 끝나기 전에 또 이벤트가 오면 다시 미룬다.
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private batchIndexed = 0;
  private batchMoved = 0;
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
        const absPath = join(this.rootPath, filename.toString());
        if (!isSupportedFile(absPath)) return;
        this.scheduleCheck(absPath);
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
      this.enqueue("unlink", absPath);
      return;
    }
    await delay(STABILITY_GAP_MS);
    if (this.stopped) return;
    const second = await fsStat(absPath).catch(() => null);
    if (!second) {
      this.enqueue("unlink", absPath);
      return;
    }
    if (second.size !== first.size || second.mtimeMs !== first.mtimeMs) {
      // 아직 쓰는 중(대용량 파일 복사 등) — 다시 한 번 디바운스 사이클을 건다
      this.scheduleCheck(absPath);
      return;
    }
    const alreadyIndexed = !!getTrackByPath(absPath);
    this.enqueue(alreadyIndexed ? "change" : "add", absPath);
  }

  private enqueue(type: QueueEvent["type"], path: string): void {
    if (this.stopped) return;
    this.queue.push({ type, path });
    this.sendStatus({ kind: "updating", count: this.queue.length });
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
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
    if (event.type === "add") return this.handleAdd(event.path);
    return this.handleChange(event.path);
  }

  // 파일이 사라진 즉시 지우지 않고 그레이스 윈도우 동안 보류한다 — 곧 이름변경/이동으로
  // 판명되면 handleAdd에서 이 항목을 찾아 삭제 대신 경로만 갱신한다.
  private handleUnlink(filePath: string): void {
    const track = getTrackByPath(filePath);
    if (!track) return;
    const existing = this.pendingUnlinks.get(filePath);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(
      () => this.finalizeRemoval(filePath),
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
  // 타이밍이 완전히 분리돼 있음), finishBatch의 배치 persist에 얹혀가지 않고 여기서
  // 직접 persistDb()를 호출한다 — 그렇지 않으면 삭제가 메모리에서만 반영되고 디스크에는
  // 저장되지 않는 채로 남는다.
  private finalizeRemoval(filePath: string): void {
    const pending = this.pendingUnlinks.get(filePath);
    if (!pending) return;
    this.pendingUnlinks.delete(filePath);
    deleteTrackByPath(filePath);
    removeEmbeddedArtworkCache(filePath);
    persistDb();
    this.sendStatus({ kind: "removed", message: "Removed 1 missing file" });
    this.win.webContents.send("library:trackRemoved", pending.trackId);
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
      updateTrackPathOnly(trackId, filePath, filename, info.mtimeMs, info.size);
      const track = getTrackByPath(filePath);
      this.batchMoved++;
      if (track) this.win.webContents.send("library:trackUpdated", track);
      this.scheduleLinger();
      return;
    }

    // 3) 완전히 새로운 파일
    const track = await indexSingleFile(
      filePath,
      this.libraryId,
      this.rootPath,
    );
    if (track) {
      this.batchIndexed++;
      this.win.webContents.send("library:trackAdded", track);
      this.scheduleLinger();
    }
  }

  private async handleChange(filePath: string): Promise<void> {
    const track = await indexSingleFile(
      filePath,
      this.libraryId,
      this.rootPath,
    );
    if (track) {
      this.batchIndexed++;
      this.win.webContents.send("library:trackUpdated", track);
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
  // 끝난 시점에 batchIndexed/batchMoved 값이 정확하다 — 삭제(finalizeRemoval)는 별도
  // 그레이스 타이머로 처리되므로 여기서는 다루지 않는다(자체적으로 persist/상태 전송함).
  private finishBatch(): void {
    if (this.batchIndexed === 0 && this.batchMoved === 0) {
      this.sendStatus({ kind: "watching" });
      return;
    }
    persistDb();
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
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.queue = [];
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
