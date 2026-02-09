/**
 * Files feature — OpenCode server filesystem browsing.
 *
 * This module replaces the entire legacy sandbox-based file system.
 * All file operations go directly to the active OpenCode server.
 */

// Types
export type {
  FileNode,
  FileContent,
  FileStatus,
  FilePatch,
  FilePatchHunk,
  FindMatch,
  OpenCodeProjectInfo,
  ServerHealth,
} from './types';

// API — read
export {
  listFiles,
  readFile,
  getFileStatus,
  findFiles,
  findText,
  getCurrentProject,
  getServerHealth,
  isServerReachable,
  // write
  uploadFile,
  deleteFile,
  mkdirFile,
  renameFile,
  type UploadResult,
} from './api/opencode-files';

// Hooks
export {
  useFileList,
  useInvalidateFileList,
  useFileContent,
  useInvalidateFileContent,
  useFileStatus,
  useFileStatusMap,
  useFileSearch,
  useTextSearch,
  useServerHealth,
  useCurrentProject,
  useFileEventInvalidation,
  useFileUpload,
  useFileDelete,
  useFileMkdir,
  useFileRename,
  fileListKeys,
  fileContentKeys,
  fileStatusKeys,
  fileSearchKeys,
} from './hooks';

// Store
export { useFilesStore, type FilesView } from './store/files-store';

// Components
export {
  FileBrowser,
  FileViewer,
  FileSearch,
  FileBreadcrumbs,
  FileTreeItem,
  FileStatusBadge,
} from './components';
