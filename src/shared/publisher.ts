import type { Library, PublisherRule, Track } from "./types";

export const DEFAULT_PUBLISHER_RULE: PublisherRule = {
  mode: "library-root-child",
  customPath: null,
};

function normalizePath(input: string): string {
  return input.replace(/\\/g, "/").replace(/\/+$/, "");
}

function splitSegments(input: string): string[] {
  return normalizePath(input)
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter(Boolean);
}

function fileDirSegments(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  return splitSegments(normalized.split("/").slice(0, -1).join("/"));
}

function relSegments(
  filePath: string,
  rootPath: string | null,
): string[] | null {
  if (!rootPath) return null;
  const fileSegs = fileDirSegments(filePath);
  const rootSegs = splitSegments(rootPath);
  if (rootSegs.length === 0 || fileSegs.length < rootSegs.length) return null;
  for (let i = 0; i < rootSegs.length; i++) {
    if (fileSegs[i] !== rootSegs[i]) return null;
  }
  return fileSegs.slice(rootSegs.length);
}

function escapeRegex(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(".", "\\.")
    .replaceAll("+", "\\+")
    .replaceAll("?", "\\?")
    .replaceAll("^", "\\^")
    .replaceAll("$", "\\$")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

function matchesSegment(pattern: string, value: string): boolean {
  if (pattern === "*") return true;
  const source =
    "^" +
    escapeRegex(pattern).replaceAll("\\*", ".*").replaceAll("\\?", ".") +
    "$";
  const regex = new RegExp(source, "i");
  return regex.test(value);
}

function matchesPrefix(pathSegs: string[], patternSegs: string[]): boolean {
  if (patternSegs.length === 0 || pathSegs.length < patternSegs.length)
    return false;
  for (let i = 0; i < patternSegs.length; i++) {
    const pat = patternSegs[i];
    const val = pathSegs[i];
    if (pat === "**") return true;
    if (!matchesSegment(pat, val)) return false;
  }
  return true;
}

function lastConcreteSegment(segments: string[]): string | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg !== "*" && seg !== "**") return seg;
  }
  return null;
}

function customPublisher(
  filePath: string,
  rootPath: string | null,
  customPath: string | null,
): string | null {
  if (!customPath) return null;
  const patternSegs = splitSegments(customPath);
  if (patternSegs.length === 0) return null;
  const rootRel = relSegments(filePath, rootPath);
  if (rootRel && matchesPrefix(rootRel, patternSegs))
    return lastConcreteSegment(patternSegs);
  const fileSegs = fileDirSegments(filePath);
  if (matchesPrefix(fileSegs, patternSegs))
    return lastConcreteSegment(patternSegs);
  return null;
}

export function resolvePublisherFromPath(
  filePath: string,
  libraryRootPath: string | null,
  rule: PublisherRule,
): string | null {
  const rootRel = relSegments(filePath, libraryRootPath);
  if (rule.mode === "custom")
    return customPublisher(filePath, libraryRootPath, rule.customPath);
  if (!rootRel || rootRel.length === 0) return null;

  switch (rule.mode) {
    case "library-root-child":
      return rootRel[0] ?? null;
    case "file-parent-1":
      return rootRel[rootRel.length - 1] ?? null;
    case "file-parent-2":
      return rootRel[rootRel.length - 2] ?? null;
    case "file-parent-3":
      return rootRel[rootRel.length - 3] ?? null;
    default:
      return null;
  }
}

export function resolveTrackPublisher(
  track: Track,
  libraries: Library[],
  rule: PublisherRule,
): string | null {
  const library = libraries.find((item) => item.id === track.libraryId);
  return resolvePublisherFromPath(
    track.filePath,
    library?.rootPath ?? null,
    rule,
  );
}

export function formatPublisherName(value: string | null): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "-";
}
