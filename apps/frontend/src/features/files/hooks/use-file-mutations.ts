'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  uploadFile,
  deleteFile,
  mkdirFile,
  renameFile,
  createFile,
  copyFile,
  type UploadResult,
} from '../api/opencode-files';
import { fileListKeys } from './use-file-list';
import { fileContentKeys } from './use-file-content';
import { useServerStore } from '@/stores/server-store';
import type { FileNode } from '../types';

type OptimisticListContext = {
  previousData?: FileNode[];
  queryKey: ReturnType<typeof fileListKeys.dir>;
};

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export function useFileUpload() {
  const queryClient = useQueryClient();

  return useMutation<
    UploadResult[],
    Error,
    { file: File | Blob; targetPath?: string }
  >({
    mutationFn: ({ file, targetPath }) => uploadFile(file, targetPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function useFileDelete() {
  const queryClient = useQueryClient();

  return useMutation<boolean, Error, { filePath: string }>({
    mutationFn: ({ filePath }) => deleteFile(filePath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
      queryClient.invalidateQueries({ queryKey: fileContentKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Mkdir
// ---------------------------------------------------------------------------

export function useFileMkdir() {
  const queryClient = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  return useMutation<boolean, Error, { dirPath: string }, OptimisticListContext>({
    mutationFn: ({ dirPath }) => mkdirFile(dirPath),
    onMutate: async ({ dirPath }) => {
      const path = dirPath.trim();
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/workspace';
      const name = path.split('/').pop() || path;
      const queryKey = fileListKeys.dir(serverUrl, parentPath);

      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<FileNode[]>(queryKey);

      if (previousData) {
        const exists = previousData.some((n) => n.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          queryClient.setQueryData<FileNode[]>(queryKey, [
            ...previousData,
            {
              name,
              path,
              absolute: path,
              type: 'directory',
              ignored: false,
            },
          ]);
        }
      }

      return { previousData, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

export function useFileRename() {
  const queryClient = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  return useMutation<boolean, Error, { from: string; to: string }, OptimisticListContext>({
    mutationFn: ({ from, to }) => renameFile(from, to),
    onMutate: async ({ from, to }) => {
      // Optimistically update the file list cache for the parent directory
      const parentPath = from.substring(0, from.lastIndexOf('/')) || '/workspace';
      const newName = to.split('/').pop() || '';
      const queryKey = fileListKeys.dir(serverUrl, parentPath);

      // Cancel any in-flight queries for this dir
      await queryClient.cancelQueries({ queryKey });

      // Snapshot previous data for rollback
      const previousData = queryClient.getQueryData<FileNode[]>(queryKey);

      // Optimistically update the cache
      if (previousData) {
        queryClient.setQueryData<FileNode[]>(queryKey, (old) =>
          old?.map((node) => {
            if (node.path !== from) return node;
            // Update the absolute path by replacing the old name with the new one
            const absoluteDir = node.absolute.substring(0, node.absolute.lastIndexOf('/'));
            return {
              ...node,
              name: newName,
              path: to,
              absolute: `${absoluteDir}/${newName}`,
            };
          })
        );
      }

      return { previousData, queryKey };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency with server
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
      queryClient.invalidateQueries({ queryKey: fileContentKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Create empty file
// ---------------------------------------------------------------------------

export function useFileCreate() {
  const queryClient = useQueryClient();
  const serverUrl = useServerStore((s) => s.getActiveServerUrl());

  return useMutation<UploadResult[], Error, { filePath: string }, OptimisticListContext>({
    mutationFn: ({ filePath }) => createFile(filePath),
    onMutate: async ({ filePath }) => {
      const path = filePath.trim();
      const parentPath = path.substring(0, path.lastIndexOf('/')) || '/workspace';
      const name = path.split('/').pop() || path;
      const queryKey = fileListKeys.dir(serverUrl, parentPath);

      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<FileNode[]>(queryKey);

      if (previousData) {
        const exists = previousData.some((n) => n.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
          queryClient.setQueryData<FileNode[]>(queryKey, [
            ...previousData,
            {
              name,
              path,
              absolute: path,
              type: 'file',
              ignored: false,
            },
          ]);
        }
      }

      return { previousData, queryKey };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(context.queryKey, context.previousData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// Copy file
// ---------------------------------------------------------------------------

export function useFileCopy() {
  const queryClient = useQueryClient();

  return useMutation<UploadResult[], Error, { sourcePath: string; destPath: string }>({
    mutationFn: ({ sourcePath, destPath }) => copyFile(sourcePath, destPath),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: fileListKeys.all });
    },
  });
}
