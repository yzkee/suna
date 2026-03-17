/**
 * FilesPage — Full file manager page for the "Files" page tab.
 *
 * Uses the OpenCode file API (GET {sandboxUrl}/file?path=...) — the same
 * approach as the web frontend — to list, upload, delete, and create files.
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  TouchableOpacity,
  Text as RNText,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { KortixLoader } from '@/components/ui';
import {
  Upload,
  FolderPlus,
  FilePlus,
  Trash2,

  X,
  Check,
  AlertCircle,
  RefreshCw,
  LayoutGrid,
  List,
  ChevronRight,
  Folder,
  Home,
  MoreVertical,
  Download,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { useSandboxContext } from '@/contexts/SandboxContext';
import { FileItem } from '@/components/files/FileItem';
import { FileBreadcrumb } from '@/components/files/FileBreadcrumb';
import { FileViewer } from '@/components/files/FileViewer';
import {
  useOpenCodeFiles,
  useOpenCodeUploadFile,
  useOpenCodeDeleteFile,
  useOpenCodeMkdir,
} from '@/lib/files/hooks';
import type { SandboxFile } from '@/api/types';
import type { PageTab } from '@/stores/tab-store';

// Helper functions
function normalizePath(path: string | null | undefined): string {
  if (!path || typeof path !== 'string') return '/workspace';
  const trimmed = path.trim();
  if (trimmed === '' || trimmed === '/') return '/workspace';
  return trimmed.startsWith('/workspace')
    ? trimmed
    : `/workspace/${trimmed.replace(/^\//, '')}`;
}

function getBreadcrumbSegments(path: string) {
  const normalized = normalizePath(path);
  const cleanPath = normalized.replace(/^\/workspace\/?/, '');

  if (!cleanPath) return [];

  const parts = cleanPath.split('/').filter(Boolean);
  let currentPath = '/workspace';

  return parts.map((part, index) => {
    currentPath = `${currentPath}/${part}`;
    return {
      name: part,
      path: currentPath,
      isLast: index === parts.length - 1,
    };
  });
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface FilesPageProps {
  page: PageTab;
  onBack: () => void;
  onOpenDrawer?: () => void;
  onOpenRightDrawer?: () => void;
}

export function FilesPage({ page, onBack, onOpenDrawer, onOpenRightDrawer }: FilesPageProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const { sandboxId, sandboxUrl } = useSandboxContext();

  const fgColor = isDark ? '#F8F8F8' : '#121215';
  const mutedColor = isDark ? '#888' : '#777';

  // View mode state
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Show/hide dotfiles (hidden by default, same as frontend)
  const [showHidden, setShowHidden] = useState(false);

  // Navigation state
  const [currentPath, setCurrentPath] = useState('/workspace');

  // Viewer state
  const [viewerVisible, setViewerVisible] = useState(false);
  const [selectedFile, setSelectedFile] = useState<SandboxFile | null>(null);

  // Create folder state
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Fetch files via OpenCode API (same as frontend)
  const {
    data: files,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useOpenCodeFiles(sandboxUrl, currentPath);

  // Mutations via OpenCode API
  const uploadMutation = useOpenCodeUploadFile();
  const deleteMutation = useOpenCodeDeleteFile();
  const createFolderMutation = useOpenCodeMkdir();

  // Breadcrumbs
  const breadcrumbs = useMemo(() => getBreadcrumbSegments(currentPath), [currentPath]);

  // Separate folders and files, sorted, with dotfile filtering
  const { folders, regularFiles } = useMemo(() => {
    if (!files || !Array.isArray(files)) {
      return { folders: [], regularFiles: [] };
    }
    const visible = showHidden ? files : files.filter((f) => !f.name.startsWith('.'));
    const sortFn = (a: SandboxFile, b: SandboxFile) => a.name.localeCompare(b.name);
    const folders = visible.filter((f) => f.type === 'directory').sort(sortFn);
    const regularFiles = visible.filter((f) => f.type === 'file').sort(sortFn);
    return { folders, regularFiles };
  }, [files, showHidden]);

  // Handlers
  const handleFilePress = useCallback((file: SandboxFile) => {
    if (file.type === 'directory') {
      setCurrentPath(normalizePath(file.path));
    } else {
      setSelectedFile(file);
      setViewerVisible(true);
    }
  }, []);

  const handleFileLongPress = useCallback(
    (file: SandboxFile) => {
      Alert.alert('Delete', `Delete "${file.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!sandboxUrl) return;
            try {
              await deleteMutation.mutateAsync({
                sandboxUrl,
                filePath: file.path,
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert('Error', 'Failed to delete file');
            }
          },
        },
      ]);
    },
    [sandboxUrl, deleteMutation],
  );

  const handleNavigate = useCallback((path: string) => {
    setCurrentPath(normalizePath(path));
  }, []);

  const handleUploadDocument = useCallback(async () => {
    if (!sandboxUrl) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const file = result.assets[0];
      await uploadMutation.mutateAsync({
        sandboxUrl,
        file: {
          uri: file.uri,
          name: file.name,
          type: file.mimeType || 'application/octet-stream',
        },
        targetPath: currentPath,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to upload file');
    }
  }, [sandboxUrl, uploadMutation, currentPath]);

  const handleUploadImage = useCallback(async () => {
    if (!sandboxUrl) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      await uploadMutation.mutateAsync({
        sandboxUrl,
        file: {
          uri: asset.uri,
          name: asset.fileName || 'image.jpg',
          type: asset.type === 'image' ? 'image/jpeg' : 'application/octet-stream',
        },
        targetPath: currentPath,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to upload image');
    }
  }, [sandboxUrl, uploadMutation, currentPath]);

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim() || !sandboxUrl) return;
    try {
      const folderPath = `${currentPath}/${newFolderName.trim()}`;
      await createFolderMutation.mutateAsync({
        sandboxUrl,
        dirPath: folderPath,
      });
      setShowCreateFolder(false);
      setNewFolderName('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Alert.alert('Error', 'Failed to create folder');
    }
  }, [sandboxUrl, createFolderMutation, currentPath, newFolderName]);

  const isAtRoot = currentPath === '/workspace';

  // No sandbox available
  if (!sandboxUrl) {
    return (
      <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#f5f5f5' }}>
        {/* Header */}
        <View style={{ paddingTop: insets.top }} className="px-4 pb-3 bg-background">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={onOpenDrawer}
              className="mr-3 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="menu" size={24} color={fgColor} />
            </TouchableOpacity>
            <View className="flex-1">
              <RNText
                style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }}
                numberOfLines={1}
              >
                {page.label}
              </RNText>
            </View>
            <TouchableOpacity
              onPress={onOpenRightDrawer}
              className="ml-3 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="apps-outline" size={20} color={fgColor} />
            </TouchableOpacity>
          </View>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <ActivityIndicator size="large" color={mutedColor} />
          <Text className="text-sm mt-3 text-muted-foreground">
            Connecting to sandbox...
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121215' : '#f5f5f5' }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: isDark ? '#121215' : '#ffffff',
          borderBottomWidth: 1,
          borderBottomColor: isDark
            ? 'rgba(248, 248, 248, 0.1)'
            : 'rgba(18, 18, 21, 0.1)',
        }}
      >
        <View className="px-4 py-3 flex-row items-center justify-between">
          <View className="flex-row items-center flex-1">
            <TouchableOpacity
              onPress={onOpenDrawer}
              className="mr-3 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="menu" size={24} color={fgColor} />
            </TouchableOpacity>
            <RNText
              style={{ fontSize: 18, fontFamily: 'Roobert-SemiBold', color: fgColor }}
              numberOfLines={1}
            >
              Files
            </RNText>
          </View>

          {/* Action buttons */}
          <View className="flex-row items-center gap-1">
            {/* View mode toggle */}
            <AnimatedPressable
              onPress={() => setViewMode((v) => (v === 'list' ? 'grid' : 'list'))}
              className="p-2.5 rounded-xl active:opacity-70"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.1)'
                  : 'rgba(18, 18, 21, 0.05)',
              }}
            >
              <Icon
                as={viewMode === 'list' ? LayoutGrid : List}
                size={18}
                color={fgColor}
                strokeWidth={2}
              />
            </AnimatedPressable>
            {/* Show/hide dotfiles */}
            <AnimatedPressable
              onPress={() => setShowHidden((v) => !v)}
              className="p-2.5 rounded-xl active:opacity-70"
              style={{
                backgroundColor: showHidden
                  ? isDark
                    ? 'rgba(248, 248, 248, 0.18)'
                    : 'rgba(18, 18, 21, 0.1)'
                  : isDark
                    ? 'rgba(248, 248, 248, 0.1)'
                    : 'rgba(18, 18, 21, 0.05)',
              }}
            >
              <Icon
                as={showHidden ? Eye : EyeOff}
                size={18}
                color={showHidden ? fgColor : mutedColor}
                strokeWidth={2}
              />
            </AnimatedPressable>
            {/* Upload */}
            <AnimatedPressable
              onPress={handleUploadDocument}
              className="p-2.5 rounded-xl active:opacity-70"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.1)'
                  : 'rgba(18, 18, 21, 0.05)',
              }}
            >
              <Icon as={Upload} size={18} color={fgColor} strokeWidth={2} />
            </AnimatedPressable>
            {/* New folder */}
            <AnimatedPressable
              onPress={() => setShowCreateFolder(true)}
              className="p-2.5 rounded-xl active:opacity-70"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.1)'
                  : 'rgba(18, 18, 21, 0.05)',
              }}
            >
              <Icon as={FolderPlus} size={18} color={fgColor} strokeWidth={2} />
            </AnimatedPressable>
            {/* Right drawer */}
            <TouchableOpacity
              onPress={onOpenRightDrawer}
              className="p-1 ml-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="apps-outline" size={20} color={fgColor} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Breadcrumbs */}
        <View className="pb-2">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 12,
            }}
          >
            {/* Root */}
            <Pressable
              onPress={() => handleNavigate('/workspace')}
              className="flex-row items-center px-2 py-1 rounded-lg active:opacity-70"
            >
              <Icon
                as={Home}
                size={14}
                color={
                  isAtRoot
                    ? fgColor
                    : isDark
                      ? 'rgba(248, 248, 248, 0.4)'
                      : 'rgba(18, 18, 21, 0.4)'
                }
                strokeWidth={2}
              />
              <Text
                style={{
                  color: isAtRoot
                    ? fgColor
                    : isDark
                      ? 'rgba(248, 248, 248, 0.5)'
                      : 'rgba(18, 18, 21, 0.5)',
                  marginLeft: 6,
                }}
                className={`text-sm ${isAtRoot ? 'font-roobert-medium' : 'font-roobert'}`}
              >
                My Kortix
              </Text>
            </Pressable>

            {/* Path segments */}
            {breadcrumbs.map((segment) => (
              <React.Fragment key={segment.path}>
                <Icon
                  as={ChevronRight}
                  size={12}
                  color={
                    isDark
                      ? 'rgba(248, 248, 248, 0.25)'
                      : 'rgba(18, 18, 21, 0.25)'
                  }
                  strokeWidth={2}
                  style={{ marginHorizontal: 2 }}
                />
                <Pressable
                  onPress={() =>
                    !segment.isLast && handleNavigate(segment.path)
                  }
                  disabled={segment.isLast}
                  className="px-2 py-1 rounded-lg active:opacity-70"
                >
                  <Text
                    style={{
                      color: segment.isLast
                        ? fgColor
                        : isDark
                          ? 'rgba(248, 248, 248, 0.5)'
                          : 'rgba(18, 18, 21, 0.5)',
                    }}
                    className={`text-sm ${segment.isLast ? 'font-roobert-medium' : 'font-roobert'}`}
                    numberOfLines={1}
                  >
                    {segment.name}
                  </Text>
                </Pressable>
              </React.Fragment>
            ))}
          </ScrollView>
        </View>
      </View>

      {/* Content */}
      <View className="flex-1">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <KortixLoader size="large" />
            <Text
              className="text-sm mt-4 font-roobert"
              style={{
                color: isDark
                  ? 'rgba(248, 248, 248, 0.5)'
                  : 'rgba(18, 18, 21, 0.5)',
              }}
            >
              Loading files...
            </Text>
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center p-8">
            <View
              className="w-16 h-16 rounded-2xl items-center justify-center mb-4"
              style={{
                backgroundColor: isDark
                  ? 'rgba(239, 68, 68, 0.1)'
                  : 'rgba(239, 68, 68, 0.05)',
              }}
            >
              <Icon as={AlertCircle} size={32} color="#ef4444" strokeWidth={2} />
            </View>
            <Text
              className="text-lg font-roobert-semibold text-center mb-2"
              style={{ color: fgColor }}
            >
              Failed to load files
            </Text>
            <Text
              className="text-sm text-center mb-6 font-roobert"
              style={{
                color: isDark
                  ? 'rgba(248, 248, 248, 0.5)'
                  : 'rgba(18, 18, 21, 0.5)',
              }}
            >
              {error?.message || 'An error occurred'}
            </Text>
            <Pressable
              onPress={() => refetch()}
              className="px-8 py-3.5 rounded-2xl active:opacity-80"
              style={{ backgroundColor: isDark ? '#f8f8f8' : '#121215' }}
            >
              <Text
                className="text-sm font-roobert-medium"
                style={{ color: isDark ? '#121215' : '#f8f8f8' }}
              >
                Retry
              </Text>
            </Pressable>
          </View>
        ) : !files || files.length === 0 ? (
          <ScrollView
            className="flex-1"
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: 40,
              paddingBottom: 60,
            }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
            }
          >
            <View
              className="w-20 h-20 rounded-3xl items-center justify-center mb-6"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.04)'
                  : 'rgba(18, 18, 21, 0.03)',
              }}
            >
              <Icon
                as={Folder}
                size={36}
                strokeWidth={1.2}
                color={
                  isDark
                    ? 'rgba(248, 248, 248, 0.15)'
                    : 'rgba(18, 18, 21, 0.15)'
                }
              />
            </View>
            <Text
              className="text-base font-roobert-semibold text-center mb-2"
              style={{ color: fgColor }}
            >
              This folder is empty
            </Text>
            <Text
              className="text-sm font-roobert text-center mb-8"
              style={{
                color: isDark
                  ? 'rgba(248, 248, 248, 0.35)'
                  : 'rgba(18, 18, 21, 0.35)',
                lineHeight: 20,
              }}
            >
              Upload files or create a folder{'\n'}to get started
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleUploadDocument}
                className="flex-row items-center px-5 py-3 rounded-2xl active:opacity-70"
                style={{
                  backgroundColor: isDark ? '#f8f8f8' : '#121215',
                }}
              >
                <Icon
                  as={Upload}
                  size={16}
                  color={isDark ? '#121215' : '#f8f8f8'}
                  strokeWidth={2}
                  style={{ marginRight: 8 }}
                />
                <Text
                  className="text-sm font-roobert-medium"
                  style={{ color: isDark ? '#121215' : '#f8f8f8' }}
                >
                  Upload
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShowCreateFolder(true)}
                className="flex-row items-center px-5 py-3 rounded-2xl active:opacity-70"
                style={{
                  backgroundColor: isDark
                    ? 'rgba(248, 248, 248, 0.1)'
                    : 'rgba(18, 18, 21, 0.06)',
                }}
              >
                <Icon
                  as={FolderPlus}
                  size={16}
                  color={fgColor}
                  strokeWidth={2}
                  style={{ marginRight: 8 }}
                />
                <Text
                  className="text-sm font-roobert-medium"
                  style={{ color: fgColor }}
                >
                  New folder
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : viewMode === 'grid' ? (
          /* ── Grid View ── */
          <ScrollView
            className="flex-1"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
            }
          >
            {/* Folders */}
            {folders.length > 0 && (
              <View className="px-4 pt-4">
                <Text
                  className="text-xs font-roobert-medium mb-3 uppercase tracking-wider"
                  style={{
                    color: isDark
                      ? 'rgba(248, 248, 248, 0.4)'
                      : 'rgba(18, 18, 21, 0.4)',
                  }}
                >
                  Folders
                </Text>
                <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
                  {folders.map((file) => (
                    <View
                      key={file.path}
                      style={{ width: '50%', paddingHorizontal: 4, marginBottom: 8 }}
                    >
                      <Pressable
                        onPress={() => handleFilePress(file)}
                        onLongPress={() => handleFileLongPress(file)}
                        className="flex-row items-center rounded-xl border active:opacity-70"
                        style={{
                          borderColor: isDark
                            ? 'rgba(248, 248, 248, 0.1)'
                            : 'rgba(18, 18, 21, 0.1)',
                          backgroundColor: isDark ? '#1a1a1c' : '#ffffff',
                          paddingHorizontal: 12,
                          paddingVertical: 10,
                        }}
                      >
                        <Icon
                          as={Folder}
                          size={18}
                          color="#3b82f6"
                          strokeWidth={2}
                          style={{ marginRight: 8 }}
                        />
                        <Text
                          style={{ color: fgColor }}
                          className="text-sm font-roobert-medium flex-1"
                          numberOfLines={1}
                        >
                          {file.name}
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Files */}
            {regularFiles.length > 0 && (
              <View className="px-4 pt-2">
                <Text
                  className="text-xs font-roobert-medium mb-3 uppercase tracking-wider"
                  style={{
                    color: isDark
                      ? 'rgba(248, 248, 248, 0.4)'
                      : 'rgba(18, 18, 21, 0.4)',
                  }}
                >
                  Files
                </Text>
                <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
                  {regularFiles.map((file) => (
                    <View
                      key={file.path}
                      style={{ width: '50%', paddingHorizontal: 4, marginBottom: 8 }}
                    >
                      <FileGridCard
                        file={file}
                        isDark={isDark}
                        fgColor={fgColor}
                        onPress={() => handleFilePress(file)}
                        onLongPress={() => handleFileLongPress(file)}
                      />
                    </View>
                  ))}
                </View>
              </View>
            )}
          </ScrollView>
        ) : (
          /* ── List View ── */
          <ScrollView
            className="flex-1 px-4 pt-3"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 20 }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
            }
          >
            {/* Folders section */}
            {folders.length > 0 && (
              <View className="mb-2">
                <Text
                  className="text-xs font-roobert-medium mb-2 uppercase tracking-wider px-1"
                  style={{
                    color: isDark
                      ? 'rgba(248, 248, 248, 0.4)'
                      : 'rgba(18, 18, 21, 0.4)',
                  }}
                >
                  Folders
                </Text>
                {folders.map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    onPress={handleFilePress}
                    onLongPress={handleFileLongPress}
                  />
                ))}
              </View>
            )}

            {/* Files section */}
            {regularFiles.length > 0 && (
              <View>
                <Text
                  className="text-xs font-roobert-medium mb-2 uppercase tracking-wider px-1"
                  style={{
                    color: isDark
                      ? 'rgba(248, 248, 248, 0.4)'
                      : 'rgba(18, 18, 21, 0.4)',
                  }}
                >
                  Files
                </Text>
                {regularFiles.map((file) => (
                  <FileItem
                    key={file.path}
                    file={file}
                    onPress={handleFilePress}
                    onLongPress={handleFileLongPress}
                  />
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* Create Folder Dialog */}
      {showCreateFolder && (
        <View
          className="absolute inset-0 items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        >
          <Animated.View
            entering={FadeIn.duration(200)}
            className="rounded-3xl p-6 mx-8 w-full max-w-sm"
            style={{
              backgroundColor: isDark ? '#1f1f21' : '#ffffff',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 16,
              elevation: 12,
            }}
          >
            <Text
              style={{ color: fgColor }}
              className="text-xl font-roobert-semibold mb-4"
            >
              New Folder
            </Text>

            <TextInput
              value={newFolderName}
              onChangeText={setNewFolderName}
              placeholder="Folder name"
              placeholderTextColor={
                isDark ? 'rgba(248, 248, 248, 0.3)' : 'rgba(18, 18, 21, 0.4)'
              }
              autoFocus
              className="px-4 py-3.5 rounded-xl border mb-6 font-roobert"
              style={{
                backgroundColor: isDark
                  ? 'rgba(248, 248, 248, 0.05)'
                  : '#f4f4f5',
                borderColor: isDark
                  ? 'rgba(248, 248, 248, 0.15)'
                  : 'rgba(18, 18, 21, 0.1)',
                color: fgColor,
              }}
            />

            <View className="flex-row gap-3">
              <Pressable
                onPress={() => {
                  setShowCreateFolder(false);
                  setNewFolderName('');
                }}
                className="flex-1 px-4 py-3.5 rounded-2xl active:opacity-70"
                style={{
                  backgroundColor: isDark
                    ? 'rgba(248, 248, 248, 0.1)'
                    : 'rgba(18, 18, 21, 0.05)',
                }}
              >
                <Text
                  style={{ color: fgColor }}
                  className="text-center font-roobert-medium"
                >
                  Cancel
                </Text>
              </Pressable>

              <Pressable
                onPress={handleCreateFolder}
                disabled={!newFolderName.trim()}
                className="flex-1 px-4 py-3.5 rounded-2xl active:opacity-90"
                style={{
                  backgroundColor: newFolderName.trim()
                    ? isDark
                      ? '#f8f8f8'
                      : '#121215'
                    : isDark
                      ? 'rgba(248, 248, 248, 0.2)'
                      : 'rgba(18, 18, 21, 0.2)',
                  opacity: newFolderName.trim() ? 1 : 0.5,
                }}
              >
                <Text
                  className="text-center font-roobert-medium"
                  style={{
                    color: newFolderName.trim()
                      ? isDark
                        ? '#121215'
                        : '#f8f8f8'
                      : isDark
                        ? 'rgba(248, 248, 248, 0.5)'
                        : 'rgba(18, 18, 21, 0.5)',
                  }}
                >
                  Create
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      )}

      {/* File Viewer */}
      <FileViewer
        visible={viewerVisible}
        onClose={() => {
          setViewerVisible(false);
          setSelectedFile(null);
        }}
        file={selectedFile}
        sandboxId={sandboxId || ''}
        sandboxUrl={sandboxUrl}
      />
    </View>
  );
}

// ── Grid card for files ────────────────────────────────────────────────────

import {
  File,
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
} from 'lucide-react-native';
import { FilePreviewType, getFilePreviewType } from '@/components/files/FilePreviewRenderers';

function getFileIconComponent(file: SandboxFile): typeof File {
  if (file.type === 'directory') return Folder;
  const previewType = getFilePreviewType(file.name);
  switch (previewType) {
    case FilePreviewType.IMAGE:
      return FileImage;
    case FilePreviewType.PDF:
    case FilePreviewType.MARKDOWN:
    case FilePreviewType.TEXT:
      return FileText;
    case FilePreviewType.CSV:
    case FilePreviewType.XLSX:
      return FileSpreadsheet;
    case FilePreviewType.JSON:
    case FilePreviewType.CODE:
    case FilePreviewType.HTML:
      return FileCode;
    default:
      return File;
  }
}

function getFileIconColor(file: SandboxFile, isDark: boolean): string {
  const previewType = getFilePreviewType(file.name);
  switch (previewType) {
    case FilePreviewType.IMAGE:
      return '#10b981';
    case FilePreviewType.PDF:
      return '#ef4444';
    case FilePreviewType.MARKDOWN:
    case FilePreviewType.TEXT:
      return '#8b5cf6';
    case FilePreviewType.CSV:
    case FilePreviewType.XLSX:
      return '#22c55e';
    case FilePreviewType.JSON:
    case FilePreviewType.CODE:
    case FilePreviewType.HTML:
      return '#f59e0b';
    default:
      return isDark ? '#a1a1aa' : '#71717a';
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function FileGridCard({
  file,
  isDark,
  fgColor,
  onPress,
  onLongPress,
}: {
  file: SandboxFile;
  isDark: boolean;
  fgColor: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const IconComponent = getFileIconComponent(file);
  const iconColor = getFileIconColor(file, isDark);
  const fileSize = formatFileSize(file.size);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      className="rounded-xl border overflow-hidden active:opacity-70"
      style={{
        borderColor: isDark
          ? 'rgba(248, 248, 248, 0.1)'
          : 'rgba(18, 18, 21, 0.1)',
        backgroundColor: isDark ? '#1a1a1c' : '#ffffff',
      }}
    >
      {/* Thumbnail area */}
      <View
        className="items-center justify-center"
        style={{
          height: 80,
          backgroundColor: isDark
            ? 'rgba(248, 248, 248, 0.03)'
            : 'rgba(18, 18, 21, 0.02)',
        }}
      >
        <Icon as={IconComponent} size={28} color={iconColor} strokeWidth={1.5} />
      </View>
      {/* Name */}
      <View
        className="px-3 py-2.5"
        style={{
          borderTopWidth: 1,
          borderTopColor: isDark
            ? 'rgba(248, 248, 248, 0.05)'
            : 'rgba(18, 18, 21, 0.05)',
        }}
      >
        <Text
          style={{ color: fgColor }}
          className="text-sm font-roobert-medium"
          numberOfLines={1}
        >
          {file.name}
        </Text>
        {fileSize ? (
          <Text
            className="text-xs font-roobert mt-0.5"
            style={{
              color: isDark
                ? 'rgba(248, 248, 248, 0.4)'
                : 'rgba(18, 18, 21, 0.4)',
            }}
          >
            {fileSize}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
