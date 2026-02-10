# Plan: Consolidate File Browser Into One Implementation

**Created:** 2026-02-10
**Status:** in-progress
**Goal:** Merge two parallel file browsing systems into one set of components used by both the `/files` page and the KortixComputer panel.

## Context

There are two separate file browsing implementations:
- **System A** (`features/files/components/`): `FileBrowser`, `FileViewer`, `FileTreeItem`, `FileSearch`, `FileBreadcrumbs` — used only by `/files` page, read-only, uses `files-store.ts` with relative paths
- **System B** (`kortix-computer/`): `FileBrowserView` (1562 lines), `FileViewerView` (857 lines) — used by KortixComputer panel + Desktop, has upload/download, thumbnails, 3 variants, unsaved content, presentations — uses `kortix-computer-store.ts` with absolute paths

Both use the same OpenCode API hooks underneath. Zero component sharing between them.

## Success Criteria

- [ ] One set of file browser/viewer components
- [ ] `/files` page renders the unified components
- [ ] KortixComputer panel renders the same unified components
- [ ] Desktop renders the same unified components
- [ ] File management actions (upload, delete, rename, mkdir) accessible in the UI
- [ ] Context menus on files with delete/rename/download
- [ ] "New Folder" action in toolbar
- [ ] TypeScript builds clean (0 errors)

## Approach

**Enhance System A** (`features/files/components/`) to absorb the best of System B, then make KortixComputer use it. This approach is chosen because:

1. `features/files/` is the clean, well-structured module — it has the right layered architecture (types → API → hooks → components → store)
2. System B's `FileBrowserView` is 1562 lines of messy code with 3 layout variants, inline sub-components, and legacy sandbox traces — it should be replaced, not preserved
3. The `/files` page already works with System A — we just need to enrich it

### Key design decisions

1. **One store** — enhance `files-store.ts` to support all the state both consumers need. Add `isSearchOpen` (already has), add unsaved content tracking, keep paths relative (the OpenCode API handles both relative and absolute paths). Drop `kortix-computer-store.ts`'s file state — it keeps only panel/view state (activeView, isSidePanelOpen, pendingToolNavIndex).

2. **Props-driven integration** — The unified components accept optional callbacks for context-specific behavior (e.g., `onOpenFile` for when KortixComputer wants to also update its panel state). The /files page doesn't pass these, the KortixComputer panel does.

3. **File management actions in `FileBrowser`** — Add context menu on `FileTreeItem` (right-click) with: Open, Download, Rename, Delete. Add toolbar buttons: Upload, New Folder, Search, Refresh. Use the existing mutation hooks (`useFileUpload`, `useFileDelete`, `useFileMkdir`, `useFileRename`).

4. **FileViewer gets save** — Add save capability from FileViewerView into the unified FileViewer.

5. **Delete old System B browser/viewer** — Remove `FileBrowserView.tsx` and `FileViewerView.tsx`. KortixComputer.tsx renders the unified components directly.

### Alternatives Considered

- **Remove /files page, keep System B only:** Rejected — System B is messy and oversized. The /files page components are cleaner.
- **Keep both, just share sub-components:** Rejected — user explicitly wants ONE implementation.

## Task Breakdown

### Phase A: Enhance `features/files/` components with file management actions

1. **Enhance `files-store.ts`** — add unsaved content tracking, add action callbacks support
2. **Add context menu to `FileTreeItem`** — right-click menu with Open, Download, Rename, Delete  
3. **Add toolbar actions to `FileBrowser`** — Upload button, New Folder button (uses mutation hooks)
4. **Add save capability to `FileViewer`** — for text files, add save button that uses `uploadFile`
5. **Wire up mutation hooks** — `useFileDelete`, `useFileRename`, `useFileMkdir`, `useFileUpload` in `FileBrowser`

### Phase B: Replace System B with unified components

6. **Update KortixComputer.tsx** — replace `FileBrowserView`/`FileViewerView` imports with `FileBrowser`/`FileViewer` from `features/files`
7. **Update Desktop.tsx** — replace `FileBrowserView` usage with `FileBrowser`
8. **Strip file-browsing state from `kortix-computer-store.ts`** — keep only panel/view state
9. **Delete `FileBrowserView.tsx` and `FileViewerView.tsx`**

### Phase C: Verify

10. **TypeScript clean build**
11. **Manual verification** — ensure /files page and KortixComputer panel both work

## Risks

- **KortixComputer's 3 variants (default/library/inline-library):** The enhanced FileBrowser needs to support these or we drop the multi-variant approach. Decision: start with one clean layout, drop the 3-variant complexity.
- **Presentation handling:** FileBrowserView has presentation folder detection. We'll keep this as a thin wrapper or optional prop rather than baking it into the core component.
- **Unsaved content persistence:** Currently in kortix-computer-store keyed by sandboxId. Need to figure out if this stays in its own store or moves.

## Notes

(Updated during execution)
