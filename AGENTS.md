# Repository Guidelines

## Project Structure & Module Organization

SoundLab is an Electron desktop application built with React and TypeScript. Keep process-specific code within its existing boundary:

- `src/main/`: Electron lifecycle, IPC handlers, filesystem watching, scanning, artwork, and database access.
- `src/preload/`: the typed `contextBridge` API exposed to the renderer.
- `src/renderer/`: React UI; components live in `src/renderer/src/components/`, reusable UI logic in `lib/`, and static files in `public/` or `assets/`.
- `src/shared/`: types, taxonomy data, and utilities shared across processes.
- `build/` and `Assets/`: application icons and source artwork. Generated output belongs in `out/` and packaged releases in `release/`; do not commit generated artifacts.

Consult `PROJECT_SPEC.md` for product behavior and `CLAUDE.md` for additional implementation context.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: launch Electron through electron-vite with hot reload.
- `npm run build`: compile the main, preload, and renderer bundles; use this as the minimum pre-commit validation.
- `npm start`: preview the production build locally.
- `npm run pack:win`: build and create the Windows installer in `release/`.

There is currently no dedicated `test`, `lint`, or formatter script. Do not document or rely on one without adding its configuration and package script.

## Coding Style & Naming Conventions

TypeScript runs in strict mode. Follow the existing style: two-space indentation, double quotes, semicolons, and trailing commas in multiline structures. Name React components and their folders in `PascalCase` (for example, `PlayerBar/PlayerBar.tsx`); use `camelCase` for functions, variables, and utility modules. Prefer shared aliases such as `@shared/types` and `@renderer/*` over deep relative imports. Keep IPC contracts typed and expose privileged operations through preload rather than accessing Node APIs from renderer code.

## Testing Guidelines

Until a test framework is introduced, run `npm run build` and manually exercise affected desktop flows in `npm run dev`. Verify scanning, playback, database persistence, and Windows packaging when changes touch those areas. If adding tests, place `*.test.ts` or `*.test.tsx` beside the code under test and add a documented `npm test` script.

## Commit & Pull Request Guidelines

Recent commits use concise, outcome-focused subjects, often grouping closely related UI and behavior changes. Keep each commit scoped and write an imperative summary that states the user-visible result. Pull requests should include a short rationale, validation steps, linked issues when applicable, and screenshots or recordings for UI changes. Call out database, IPC, or packaging impacts explicitly.
