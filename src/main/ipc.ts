import {
  ipcMain,
  dialog,
  shell,
  clipboard,
  app,
  BrowserWindow,
  nativeImage,
  screen,
} from "electron";
import { readFile, stat, rename, copyFile } from "fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname, basename, extname } from "path";
import { pathToFileURL } from "url";
import { scanLibrary } from "./scanner";
import { startWatching, stopWatching } from "./watcher";
import {
  findCoverInDir,
  getEmbeddedArtworkDataUrl,
  getFolderCoverDataUrl,
} from "./artwork";
import {
  getAllLibraries,
  getAllTracks,
  getTrackPathsByLibrary,
  getFolderTrackRows,
  removeTracksUnderFolder,
  updateFolderTrackPaths,
  deleteLibrary,
  deleteEmptyLibraries,
  getEmptyLibraryIds,
  toggleStarred,
  updateLastPlayed,
  getCollections,
  createCollection,
  deleteCollection,
  renameCollection,
  setCollectionColor,
  addTrackToCollection,
  addTracksToCollection,
  removeTrackFromCollection,
  reorderCollectionTracks,
  hasTrackFilePath,
  clearDirSnapshot,
  renameLibrary,
  setLibraryMonitor,
  markLibraryAnalyzed,
  computeSimilarityKeys,
  removeTrack,
  renameTrackFile,
  updateTrackMetadata,
  batchUpdateTrackMetadata,
  findDuplicateGroups,
  updateTrackMarkers,
} from "./db/queries";
import { runExclusive } from "./db/txLock";
import type {
  Library,
  ScanProgress,
  ScanSummary,
  Track,
  TrackMetadataPatch,
} from "../shared/types";
import { buildFolderTree, type LibraryTree } from "../shared/folderTree";

// 스캔류 IPC의 공통 응답. tracks는 실제로 바뀐 게 있을 때만 싣는다 — 변경이 0건인데도
// 519k 트랙을 IPC로 넘기면 그 직렬화/역직렬화만으로 앱이 몇 초씩 멈춘다.
export interface ScanResult {
  libraries: Library[];
  tracks: Track[] | null;
  summary: ScanSummary;
}

function scanResult(summary: ScanSummary): ScanResult {
  const changed =
    summary.added + summary.updated + summary.moved + summary.removed > 0;
  return {
    libraries: getAllLibraries(),
    tracks: changed ? getAllTracks() : null,
    summary,
  };
}

function mergeSummaries(list: ScanSummary[]): ScanSummary {
  return list.reduce<ScanSummary>(
    (acc, s) => ({
      added: acc.added + s.added,
      updated: acc.updated + s.updated,
      moved: acc.moved + s.moved,
      removed: acc.removed + s.removed,
      skipped: acc.skipped + s.skipped,
      errors: [...acc.errors, ...s.errors].slice(0, 200),
    }),
    { added: 0, updated: 0, moved: 0, removed: 0, skipped: 0, errors: [] },
  );
}

export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  const sendProgress = (progress: ScanProgress): void => {
    if (!mainWindow.isDestroyed())
      mainWindow.webContents.send("library:scanProgress", progress);
  };

  ipcMain.handle("dialog:selectFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle("file:isDirectory", async (_event, filePath: string) => {
    try {
      return (await stat(filePath)).isDirectory();
    } catch {
      return false;
    }
  });

  // 폴더 추가 = 라이브러리 누적. 스캔 후 전체(모든 라이브러리/트랙)를 반환.
  ipcMain.handle("library:scan", async (_event, rootPath: string) => {
    // 스캔 전 이미 비어 있던 라이브러리는 이번 재귀속의 결과가 아니므로 보호한다.
    const preEmpty = getEmptyLibraryIds();
    const { library, summary } = await scanLibrary(rootPath, {
      onProgress: sendProgress,
    });
    startWatching(library.id, library.rootPath, mainWindow);
    // 폴더를 겹쳐 추가해 파일이 이 라이브러리로 재귀속되면서 "이번에" 비게 된 예전 라이브러리만 정리
    for (const removedId of deleteEmptyLibraries([library.id, ...preEmpty]))
      stopWatching(removedId);
    // 폴더 추가는 항상 목록을 새로 그려야 하므로 변경 여부와 무관하게 전체 트랙을 싣는다.
    return {
      libraries: getAllLibraries(),
      tracks: getAllTracks(),
      summary,
    } satisfies ScanResult;
  });

  // 앱 시작 시 저장돼 있던 전체 라이브러리/트랙 로드
  ipcMain.handle("app:loadAll", () => {
    return { libraries: getAllLibraries(), tracks: getAllTracks() };
  });

  // 시작 시 사이드바를 즉시 그리기 위한 경량 로드 — 전체 트랙(모든 컬럼, 수백 MB)을 넘기지
  // 않고 file_path만으로 폴더 트리를 메인에서 만들어 보낸다. 렌더러는 이 트리를 먼저 띄우고,
  // 무거운 전체 트랙 로드(app:loadAll)는 백그라운드로 이어서 수행한다.
  ipcMain.handle("app:loadTree", () => {
    const libraries = getAllLibraries();
    const pathsByLib = getTrackPathsByLibrary();
    const trees: LibraryTree[] = libraries.map((library) => ({
      library,
      node: buildFolderTree(
        (pathsByLib.get(library.id) ?? []).map((filePath) => ({ filePath })),
        library.rootPath,
      ),
    }));
    return { libraries, trees };
  });

  ipcMain.handle("library:remove", (_event, libraryId: number) => {
    stopWatching(libraryId);
    deleteLibrary(libraryId);
    return { libraries: getAllLibraries(), tracks: getAllTracks() };
  });

  ipcMain.handle(
    "library:rename",
    (_event, libraryId: number, name: string) => {
      renameLibrary(libraryId, name);
      return getAllLibraries();
    },
  );

  // "Scan for new files" — 디스크에서 사라진 파일은 건드리지 않고 새 파일만 추가하는
  // 비파괴 스캔. 변경 없는 파일은 폴더 mtime 프루닝으로 stat조차 하지 않는다.
  ipcMain.handle(
    "library:scanNew",
    async (_event, _libraryId: number, rootPath: string) => {
      const { summary } = await scanLibrary(rootPath, {
        deleteMissing: false,
        onProgress: sendProgress,
      });
      return scanResult(summary);
    },
  );

  // 수동 "Refresh / Rescan" — 실시간 감시와 별개로, 사용자가 선택한 라이브러리 폴더 하나만
  // 다시 훑어 추가/삭제/변경을 한 번에 반영한다. 증분이므로 변경되지 않은 기존 파일은
  // 다시 분석하지 않는다.
  ipcMain.handle("library:rescan", async (_event, rootPath: string) => {
    const preEmpty = getEmptyLibraryIds();
    const { library, summary } = await scanLibrary(rootPath, {
      onProgress: sendProgress,
    });
    startWatching(library.id, library.rootPath, mainWindow);
    for (const removedId of deleteEmptyLibraries([library.id, ...preEmpty]))
      stopWatching(removedId);
    return scanResult(summary);
  });

  // Local 옆 인덱싱 버튼 — 등록된 모든 라이브러리에 대한 "증분" 인덱싱.
  // 새로 추가/변경/이동/삭제된 것만 찾아 처리하고, 그대로인 파일은 손대지 않는다.
  ipcMain.handle("library:refreshAll", async () => {
    const summaries: ScanSummary[] = [];
    for (const library of getAllLibraries()) {
      const { summary } = await scanLibrary(library.rootPath, {
        onProgress: sendProgress,
      });
      summaries.push(summary);
      startWatching(library.id, library.rootPath, mainWindow);
    }
    return scanResult(mergeSummaries(summaries));
  });

  // 보조 메뉴 전용 "전체 재인덱싱" — 증분 비교를 전부 무시하고 모든 파일을 다시 분석한다.
  // 인덱스가 실제 파일과 어긋났을 때의 복구 수단이며, 일반 인덱싱 버튼과는 분리돼 있다.
  ipcMain.handle(
    "library:fullReindex",
    async (_event, libraryId: number, rootPath: string) => {
      clearDirSnapshot(libraryId);
      const { library, summary } = await scanLibrary(rootPath, {
        mode: "full",
        onProgress: sendProgress,
      });
      startWatching(library.id, library.rootPath, mainWindow);
      return {
        libraries: getAllLibraries(),
        tracks: getAllTracks(),
        summary,
      } satisfies ScanResult;
    },
  );

  ipcMain.handle("library:showInExplorer", async (_event, rootPath: string) => {
    // 사이드바 하위 폴더는 정규화 경로(슬래시)를 넘길 수 있으므로 OS 구분자로 되돌린다.
    const osPath =
      process.platform === "win32" ? rootPath.replace(/\//g, "\\") : rootPath;
    const err = await shell.openPath(osPath);
    if (err) console.error("openPath failed:", err);
  });

  // "Monitor for changes" On/Off — 켜면 폴더 변경 감시 시작, 끄면 감시 중단
  ipcMain.handle(
    "library:setMonitor",
    (_event, libraryId: number, rootPath: string, on: boolean) => {
      setLibraryMonitor(libraryId, on);
      if (on) startWatching(libraryId, rootPath, mainWindow);
      else stopWatching(libraryId);
      return getAllLibraries();
    },
  );

  // "Analyze for Find Similar" — 메타데이터(길이/채널/샘플레이트/비트뎁스) 기반 근사 유사도 키 생성
  ipcMain.handle("library:analyze", (_event, libraryId: number) => {
    const analyzedCount = computeSimilarityKeys(libraryId);
    markLibraryAnalyzed(libraryId, Date.now());
    return { libraries: getAllLibraries(), analyzedCount };
  });

  ipcMain.handle("track:toggleStar", (_event, trackId: number) => {
    return toggleStarred(trackId);
  });

  ipcMain.handle("track:updateLastPlayed", (_event, trackId: number) => {
    updateLastPlayed(trackId);
  });

  // 메타데이터 패널 인라인 편집 — 카테고리/서브카테고리/설명/태그
  ipcMain.handle(
    "track:updateMetadata",
    (_event, trackId: number, patch: TrackMetadataPatch) => {
      return updateTrackMetadata(trackId, patch);
    },
  );

  // 다중 선택 일괄 편집
  ipcMain.handle(
    "track:batchUpdateMetadata",
    (_event, trackIds: number[], patch: TrackMetadataPatch) => {
      return batchUpdateTrackMetadata(trackIds, patch);
    },
  );

  // file_hash+file_size가 일치하는 트랙 그룹(중복 후보) 조회
  ipcMain.handle("library:findDuplicates", () => {
    return findDuplicateGroups();
  });

  // 포인트 마커 저장
  ipcMain.handle(
    "track:updateMarkers",
    (_event, trackId: number, markers: number[]) => {
      return updateTrackMarkers(trackId, markers);
    },
  );

  // 리스트 우클릭 메뉴 "Remove" — 실제 파일은 그대로 두고 인덱스에서만 제거
  ipcMain.handle("track:remove", (_event, trackId: number) => {
    removeTrack(trackId);
  });

  // 사이드바 하위 폴더 "Remove" — 폴더 하위 트랙을 인덱스에서만 제거(실제 파일 보존).
  // folderPath는 트리 노드의 정규화 경로(슬래시). 갱신된 목록을 돌려준다.
  ipcMain.handle(
    "folder:remove",
    async (_event, libraryId: number, folderPath: string) => {
      // 트랜잭션을 여는 쓰기라 진행 중인 스캔과 겹치면 안 된다 — 같은 큐로 직렬화한다.
      await runExclusive(() => removeTracksUnderFolder(libraryId, folderPath));
      return { libraries: getAllLibraries(), tracks: getAllTracks() };
    },
  );

  // 사이드바 하위 폴더 "Rename" — 실제 디스크 폴더를 리네임하고 하위 트랙들의 경로를 갱신.
  // 트리는 file_path에서 파생되므로, 이름 변경이 영속되려면 실제 폴더를 바꿔야 한다.
  ipcMain.handle(
    "folder:rename",
    async (_event, libraryId: number, folderPath: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) throw new Error("Folder name cannot be empty");
      if (/[\\/:*?"<>|]/.test(trimmed))
        throw new Error('Folder name cannot contain \\ / : * ? " < > |');

      const rows = getFolderTrackRows(libraryId, folderPath);
      if (rows.length === 0)
        throw new Error("No tracks found under this folder");

      // 실제 OS 폴더 경로는 트랙의 실제 file_path에서 잘라 얻는다(정규화는 길이를 보존).
      const oldRealFolder = rows[0].filePath.slice(0, folderPath.length);
      const newRealFolder = join(dirname(oldRealFolder), trimmed);
      if (newRealFolder === oldRealFolder) return null;
      if (existsSync(newRealFolder))
        throw new Error("A folder with that name already exists");

      await rename(oldRealFolder, newRealFolder);
      // 트랜잭션을 여는 쓰기라 진행 중인 스캔과 겹치면 안 된다 — 같은 큐로 직렬화한다.
      // (디스크 rename은 느린 I/O라 큐 밖에서 먼저 끝낸다.)
      await runExclusive(() =>
        updateFolderTrackPaths(rows, oldRealFolder, newRealFolder),
      );
      return {
        libraries: getAllLibraries(),
        tracks: getAllTracks(),
        renamed: rows.length,
      };
    },
  );

  // 리스트 우클릭 메뉴 "Rename" — 실제 파일을 같은 폴더 안에서 리네임하고 DB 경로를 갱신
  ipcMain.handle(
    "track:rename",
    async (_event, trackId: number, filePath: string, newName: string) => {
      const dir = dirname(filePath);
      const ext = extname(filePath);
      const trimmed = newName.trim();
      if (!trimmed) throw new Error("File name cannot be empty");
      const finalName = trimmed.toLowerCase().endsWith(ext.toLowerCase())
        ? trimmed
        : `${trimmed}${ext}`;
      const newPath = join(dir, finalName);
      if (newPath !== filePath) {
        if (existsSync(newPath))
          throw new Error("A file with that name already exists");
        await rename(filePath, newPath);
      }
      renameTrackFile(trackId, newPath, finalName);
      return { filePath: newPath, filename: finalName };
    },
  );

  // 우클릭 메뉴 "Open in external editor" — OS 기본 연결 프로그램으로 열기
  ipcMain.handle("file:openExternal", async (_event, filePath: string) => {
    const err = await shell.openPath(filePath);
    if (err) console.error("openPath failed:", err);
  });

  // 우클릭 메뉴 "Show in File Explorer" — 탐색기에서 해당 파일을 선택된 상태로 표시
  ipcMain.handle("file:showItemInFolder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  // 우클릭 메뉴 "Send to folder" — 대상 폴더를 고른 뒤 파일을 그 폴더로 복사
  ipcMain.handle("file:copyToFolder", async (_event, filePath: string) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const destDir = result.filePaths[0];
    const dest = join(destDir, basename(filePath));
    await copyFile(filePath, dest);
    return dest;
  });

  // Collections
  ipcMain.handle("collections:getAll", () => getCollections());
  ipcMain.handle("collections:create", (_event, name: string) => {
    createCollection(name);
    return getCollections();
  });
  ipcMain.handle("collections:delete", (_event, id: number) => {
    deleteCollection(id);
    return getCollections();
  });
  ipcMain.handle("collections:rename", (_event, id: number, name: string) => {
    renameCollection(id, name);
    return getCollections();
  });
  ipcMain.handle(
    "collections:setColor",
    (_event, id: number, color: string | null) => {
      setCollectionColor(id, color);
      return getCollections();
    },
  );
  ipcMain.handle(
    "collections:addTrack",
    (_event, collectionId: number, trackId: number) => {
      addTrackToCollection(collectionId, trackId);
      return getCollections();
    },
  );
  ipcMain.handle(
    "collections:addTracks",
    (_event, collectionId: number, trackIds: number[]) => {
      addTracksToCollection(collectionId, trackIds);
      return getCollections();
    },
  );
  ipcMain.handle(
    "collections:removeTrack",
    (_event, collectionId: number, trackId: number) => {
      removeTrackFromCollection(collectionId, trackId);
      return getCollections();
    },
  );
  ipcMain.handle(
    "collections:reorder",
    (_event, collectionId: number, orderedTrackIds: number[]) => {
      reorderCollectionTracks(collectionId, orderedTrackIds);
      return getCollections();
    },
  );

  ipcMain.handle("clipboard:writeText", (_event, text: string) => {
    clipboard.writeText(text);
  });

  // 트랙 커버: 임베디드 아트워크 우선 → 폴더 커버(스캔 시 저장한 경로) → null(플레이스홀더)
  ipcMain.handle(
    "artwork:getForTrack",
    async (_event, filePath: string, folderCoverPath: string | null) => {
      try {
        const { parseFile } = await import("music-metadata");
        const embedded = await getEmbeddedArtworkDataUrl(filePath, (p) =>
          parseFile(p),
        );
        if (embedded) return { url: embedded, source: "embedded" as const };
      } catch {
        /* 임베디드 추출 실패는 무시하고 폴더 커버로 폴백 */
      }
      if (folderCoverPath) {
        const folder = getFolderCoverDataUrl(folderCoverPath);
        if (folder) return { url: folder, source: "folder" as const };
      }
      return null;
    },
  );

  // 폴더 커버(그리드 카드용): 폴더 안 커버 이미지 → 리사이즈 data URL
  //
  // findCoverInDir(readdirSync) + 이미지 디코드/리사이즈는 전부 동기라, 폴더 수십~수백 개가
  // 한꺼번에 요청되면 메인 프로세스가 그동안 통째로 멈춘다(= Local 메뉴를 누를 때마다 렉).
  // 결과를 프로세스 수명 동안 캐시해 두 번째 요청부터는 디스크를 건드리지 않고,
  // 같은 폴더에 대한 동시 요청은 하나로 합친다.
  type FolderCover = { url: string; source: "folder" } | null;
  const folderCoverCache = new Map<string, FolderCover>();
  const folderCoverInflight = new Map<string, Promise<FolderCover>>();

  ipcMain.handle(
    "artwork:getFolderCover",
    (_event, folderPath: string): Promise<FolderCover> => {
      const cached = folderCoverCache.get(folderPath);
      if (cached !== undefined) return Promise.resolve(cached);
      const inflight = folderCoverInflight.get(folderPath);
      if (inflight) return inflight;

      // setImmediate로 한 틱 미뤄, 동시에 밀려든 요청들이 이벤트 루프를 독점하지 않고
      // 그 사이 다른 IPC(검색/재생)가 처리될 틈을 준다.
      const task = new Promise<FolderCover>((resolve) => {
        setImmediate(() => {
          let result: FolderCover = null;
          try {
            const cover = findCoverInDir(folderPath);
            const url = cover ? getFolderCoverDataUrl(cover) : null;
            if (url) result = { url, source: "folder" };
          } catch {
            /* 커버는 장식이므로 실패는 조용히 무시하고 플레이스홀더를 쓴다 */
          }
          folderCoverCache.set(folderPath, result);
          folderCoverInflight.delete(folderPath);
          resolve(result);
        });
      });
      folderCoverInflight.set(folderPath, task);
      return task;
    },
  );

  ipcMain.handle("file:getAudioAccess", async (_event, filePath: string) => {
    if (!hasTrackFilePath(filePath)) {
      throw new Error("Audio file is not registered in the library");
    }
    const info = await stat(filePath);
    return {
      url: pathToFileURL(filePath).toString(),
      size: info.size,
      mtimeMs: info.mtimeMs,
    };
  });
  ipcMain.handle("file:readAudio", async (_event, filePath: string) => {
    if (!hasTrackFilePath(filePath)) {
      throw new Error("Audio file is not registered in the library");
    }
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  });

  // 리스트에서 바로 끌어다 DAW/탐색기로 놓는 네이티브 드래그아웃 (Soundly 방식)
  // Windows는 비어있지 않은 드래그 아이콘이 필수 (24x24 RGBA PNG)
  const dragIcon = nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAJUlEQVR4nGOIWtV0gpaYYdSCUQtGLRi1YNSCUQtGLRi1YGhYAAAehC/M66tF4QAAAABJRU5ErkJggg==",
  );
  ipcMain.on("drag:start", (event, filePaths: string | string[]) => {
    const files = Array.isArray(filePaths) ? filePaths : [filePaths];
    if (files.length === 0) return;
    try {
      event.sender.startDrag({
        file: files[0],
        files: files.length > 1 ? files : undefined,
        icon: dragIcon,
      });
    } catch (err) {
      console.error("startDrag failed:", (err as Error)?.message);
    }
  });

  // Waveform에서 선택한 구간만 잘라 만든 임시 오디오를 DAW로 드래그 아웃.
  // 드래그 제스처가 끊기지 않도록 파일 쓰기부터 startDrag까지 전부 동기로 처리.
  const dragExportDir = join(app.getPath("temp"), "soundlib-dragexports");
  ipcMain.on(
    "drag:startFromBuffer",
    (event, bytes: Uint8Array, filename: string) => {
      try {
        if (!existsSync(dragExportDir))
          mkdirSync(dragExportDir, { recursive: true });
        const filePath = join(dragExportDir, filename);
        writeFileSync(filePath, Buffer.from(bytes));
        event.sender.startDrag({ file: filePath, icon: dragIcon });
      } catch (err) {
        console.error("drag:startFromBuffer failed:", (err as Error)?.message);
      }
    },
  );

  // 커스텀 타이틀바 창 제어
  ipcMain.on("window:minimize", () => mainWindow.minimize());
  ipcMain.on("window:toggleMaximize", () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on("window:close", () => mainWindow.close());
  ipcMain.handle("window:isMaximized", () => mainWindow.isMaximized());

  // Dock Mode: 창을 화면 하단에 눕힌 얇은 트랜스포트 바로 축소해 다른 앱(DAW) 위에 항상 띄운다.
  // 이전 창 크기/위치를 기억해뒀다가 해제 시 그대로 복원한다.
  let dockPrevBounds: Electron.Rectangle | null = null;
  ipcMain.handle("window:setDockMode", (_event, on: boolean) => {
    const isDocked = dockPrevBounds !== null;
    if (on === isDocked) return;
    if (on) {
      dockPrevBounds = mainWindow.getBounds();
      const { workArea } = screen.getDisplayMatching(mainWindow.getBounds());
      const width = Math.min(880, workArea.width - 32);
      const height = 92;
      mainWindow.setMinimumSize(360, height);
      mainWindow.setResizable(false);
      mainWindow.setBounds({
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: workArea.y + workArea.height - height - 14,
        width,
        height,
      });
      mainWindow.setAlwaysOnTop(true, "floating");
    } else {
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(980, 640);
      if (dockPrevBounds) mainWindow.setBounds(dockPrevBounds);
      dockPrevBounds = null;
    }
  });
}

// 앱이 꺼져 있는 동안 폴더에서 일어난 변경(추가/수정/삭제/이동)을 시작 직후 조용히 따라잡는다.
// 실시간 감시는 앱이 떠 있을 때만 동작하므로, 종료 구간의 공백은 이 시작 시 대조가 메운다.
// 폴더 mtime 프루닝 덕에 변경이 없으면 폴더 stat만 하고 곧바로 끝난다.
export async function runStartupReconcile(
  mainWindow: BrowserWindow,
): Promise<void> {
  const summaries: ScanSummary[] = [];
  for (const library of getAllLibraries()) {
    if (mainWindow.isDestroyed()) return;
    try {
      const { summary } = await scanLibrary(library.rootPath, {
        onProgress: (progress) => {
          if (!mainWindow.isDestroyed())
            mainWindow.webContents.send("library:scanProgress", progress);
        },
      });
      summaries.push(summary);
    } catch (err) {
      console.error(
        "startup reconcile failed for",
        library.rootPath,
        (err as Error)?.message,
      );
    }
  }
  if (mainWindow.isDestroyed()) return;
  const merged = mergeSummaries(summaries);
  const changed =
    merged.added + merged.updated + merged.moved + merged.removed > 0;
  // 변경이 없으면 아무것도 보내지 않는다 — 519k 트랙을 IPC로 넘기는 것 자체가 비싸다.
  if (!changed) {
    mainWindow.webContents.send("library:scanDone", merged);
    return;
  }
  mainWindow.webContents.send("library:updated", {
    libraries: getAllLibraries(),
    tracks: getAllTracks(),
    summary: merged,
  });
}
