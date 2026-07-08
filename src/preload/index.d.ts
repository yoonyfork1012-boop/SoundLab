import type { Collection, Library, ScanProgress, Track } from '../shared/types';
declare const api: {
    selectFolder: () => Promise<string | null>;
    scanLibrary: (rootPath: string) => Promise<{
        libraries: Library[];
        tracks: Track[];
    }>;
    loadAll: () => Promise<{
        libraries: Library[];
        tracks: Track[];
    }>;
    notifyReady: () => void;
    removeLibrary: (libraryId: number) => Promise<{
        libraries: Library[];
        tracks: Track[];
    }>;
    renameLibrary: (libraryId: number, name: string) => Promise<Library[]>;
    scanNewFiles: (libraryId: number, rootPath: string) => Promise<{
        libraries: Library[];
        tracks: Track[];
        addedCount: number;
    }>;
    showInExplorer: (rootPath: string) => Promise<void>;
    setLibraryMonitor: (libraryId: number, rootPath: string, on: boolean) => Promise<Library[]>;
    analyzeLibrary: (libraryId: number) => Promise<{
        libraries: Library[];
        analyzedCount: number;
    }>;
    onScanProgress: (callback: (progress: ScanProgress) => void) => (() => void);
    onLibraryUpdated: (callback: (data: { libraries: Library[]; tracks: Track[] }) => void) => (() => void);
    toggleStar: (trackId: number) => Promise<boolean>;
    updateLastPlayed: (trackId: number) => Promise<void>;
    getCollections: () => Promise<Collection[]>;
    createCollection: (name: string) => Promise<Collection[]>;
    deleteCollection: (id: number) => Promise<Collection[]>;
    renameCollection: (id: number, name: string) => Promise<Collection[]>;
    setCollectionColor: (id: number, color: string | null) => Promise<Collection[]>;
    addTrackToCollection: (collectionId: number, trackId: number) => Promise<Collection[]>;
    addTracksToCollection: (collectionId: number, trackIds: number[]) => Promise<Collection[]>;
    removeTrackFromCollection: (collectionId: number, trackId: number) => Promise<Collection[]>;
    reorderCollectionTracks: (collectionId: number, orderedTrackIds: number[]) => Promise<Collection[]>;
    getAudioAccess: (filePath: string) => Promise<{ url: string; size: number; mtimeMs: number }>;
    readAudioFile: (filePath: string) => Promise<Uint8Array>;
    writeClipboardText: (text: string) => Promise<void>;
    removeTrack: (trackId: number) => Promise<void>;
    renameTrackFile: (trackId: number, filePath: string, newName: string) => Promise<{ filePath: string; filename: string }>;
    openExternal: (filePath: string) => Promise<void>;
    showItemInFolder: (filePath: string) => Promise<void>;
    copyToFolder: (filePath: string) => Promise<string | null>;
    getTrackArtwork: (filePath: string, folderCoverPath: string | null) => Promise<{ url: string; source: 'embedded' | 'folder' } | null>;
    getFolderCover: (folderPath: string) => Promise<{ url: string; source: 'folder' } | null>;
    startDrag: (filePath: string) => void;
    startDragFromBuffer: (bytes: Uint8Array, filename: string) => void;
    windowMinimize: () => void;
    windowToggleMaximize: () => void;
    windowClose: () => void;
    windowIsMaximized: () => Promise<boolean>;
    onWindowMaximized: (callback: (maximized: boolean) => void) => (() => void);
    setDockMode: (on: boolean) => Promise<void>;
};
export type SoundLibApi = typeof api;
declare global {
    interface Window {
        api?: SoundLibApi;
    }
}
export {};
