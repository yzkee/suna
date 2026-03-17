/**
 * File Item Component
 * Reusable file/folder item with beautiful animations
 * Matches SelectableListItem design pattern from AgentDrawer
 */

import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { 
  Folder, 
  File, 
  FileText, 
  FileImage, 
  FileCode,
  FileSpreadsheet,
  ChevronRight,
} from 'lucide-react-native';
import { useColorScheme } from 'nativewind';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { SandboxFile } from '@/api/types';
// FilePreviewRenderers used for viewer, not needed for icon mapping

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Helper to get file extension
function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

// Helper to get base filename
function getBasename(name: string): string {
  return name.toLowerCase();
}

interface FileItemProps {
  file: SandboxFile;
  onPress: (file: SandboxFile) => void;
  onLongPress?: (file: SandboxFile) => void;
}

/**
 * Get icon + color for a file, matching the frontend's colored file-icon mapping.
 */
export function getFileIconAndColor(
  file: SandboxFile,
  isDark: boolean,
): { icon: typeof File; color: string } {
  if (file.type === 'directory') {
    return { icon: Folder, color: '#60a5fa' }; // blue-400
  }

  const ext = getExt(file.name);
  const base = getBasename(file.name);

  // ── Special filenames ────────────────────────────────────────────────
  if (base === 'dockerfile' || base.startsWith('docker-compose'))
    return { icon: FileCode, color: '#38bdf8' }; // sky-400
  if (base === '.env' || base.startsWith('.env.'))
    return { icon: FileCode, color: '#eab308' }; // yellow-500
  if (base === 'package.json' || base.includes('-lock') || base === 'yarn.lock' || base === 'bun.lockb')
    return { icon: FileCode, color: '#4ade80' }; // green-400
  if (base === 'license' || base === 'license.md' || base === 'license.txt')
    return { icon: FileText, color: '#fbbf24' }; // amber-400
  if (base === '.gitignore' || base === '.gitattributes' || base === '.gitmodules')
    return { icon: FileCode, color: '#fb923c' }; // orange-400
  if (base === 'makefile' || base === 'cmakelists.txt')
    return { icon: FileCode, color: '#f59e0b' }; // amber-500
  if (base.startsWith('tsconfig') || base.startsWith('jsconfig'))
    return { icon: FileCode, color: '#60a5fa' }; // blue-400

  // ── Extensions ───────────────────────────────────────────────────────
  switch (ext) {
    // TypeScript
    case '.ts': case '.tsx':
      return { icon: FileCode, color: '#60a5fa' }; // blue-400

    // JavaScript
    case '.js': case '.jsx': case '.mjs': case '.cjs':
      return { icon: FileCode, color: '#facc15' }; // yellow-400

    // Python
    case '.py': case '.pyi': case '.pyx': case '.pyw':
      return { icon: FileCode, color: '#38bdf8' }; // sky-400

    // Rust
    case '.rs':
      return { icon: FileCode, color: '#fb923c' }; // orange-400

    // Go
    case '.go':
      return { icon: FileCode, color: '#22d3ee' }; // cyan-400

    // Ruby
    case '.rb': case '.erb': case '.gemspec':
      return { icon: FileCode, color: '#f87171' }; // red-400

    // Java / Kotlin
    case '.java': case '.kt': case '.kts':
      return { icon: FileCode, color: '#f97316' }; // orange-500

    // C / C++ / Obj-C
    case '.c': case '.cpp': case '.cc': case '.cxx': case '.h': case '.hpp': case '.hxx': case '.m': case '.mm':
      return { icon: FileCode, color: '#3b82f6' }; // blue-500

    // C#
    case '.cs':
      return { icon: FileCode, color: '#a78bfa' }; // violet-400

    // Swift
    case '.swift':
      return { icon: FileCode, color: '#fb923c' }; // orange-400

    // PHP
    case '.php':
      return { icon: FileCode, color: '#818cf8' }; // indigo-400

    // Shell
    case '.sh': case '.bash': case '.zsh': case '.fish': case '.bat': case '.cmd': case '.ps1':
      return { icon: FileCode, color: '#4ade80' }; // green-400

    // Lua
    case '.lua':
      return { icon: FileCode, color: '#2563eb' }; // blue-600

    // Haskell
    case '.hs': case '.lhs':
      return { icon: FileCode, color: '#a78bfa' }; // violet-400

    // R
    case '.r': case '.rmd':
      return { icon: FileCode, color: '#60a5fa' }; // blue-400

    // Frontend / Web
    case '.vue':
      return { icon: FileCode, color: '#34d399' }; // emerald-400
    case '.svelte':
      return { icon: FileCode, color: '#f97316' }; // orange-500
    case '.html': case '.htm':
      return { icon: FileCode, color: '#fb923c' }; // orange-400
    case '.css': case '.scss': case '.sass': case '.less': case '.styl':
      return { icon: FileCode, color: '#f472b6' }; // pink-400

    // Data / Config
    case '.json': case '.jsonc': case '.json5':
      return { icon: FileCode, color: '#eab308' }; // yellow-500
    case '.yaml': case '.yml': case '.toml':
      return { icon: FileCode, color: '#c084fc' }; // purple-400
    case '.xml': case '.xsl': case '.xslt':
      return { icon: FileCode, color: '#f59e0b' }; // amber-500
    case '.ini': case '.cfg': case '.conf': case '.properties': case '.editorconfig':
      return { icon: FileCode, color: isDark ? '#a1a1aa' : '#9ca3af' }; // gray-400
    case '.sql': case '.sqlite': case '.db':
      return { icon: FileCode, color: '#60a5fa' }; // blue-400
    case '.proto': case '.graphql': case '.gql':
      return { icon: FileCode, color: '#ec4899' }; // pink-500

    // Documents
    case '.md': case '.mdx':
      return { icon: FileText, color: isDark ? '#a1a1aa' : '#71717a' };
    case '.txt': case '.rst': case '.rtf':
      return { icon: FileText, color: isDark ? '#a1a1aa' : '#71717a' };
    case '.pdf':
      return { icon: FileText, color: '#ef4444' }; // red-500
    case '.doc': case '.docx': case '.odt':
      return { icon: FileText, color: '#3b82f6' }; // blue-500

    // Images
    case '.png': case '.jpg': case '.jpeg': case '.gif': case '.svg': case '.webp': case '.ico': case '.bmp': case '.tiff':
      return { icon: FileImage, color: '#c084fc' }; // purple-400

    // Spreadsheets
    case '.csv': case '.tsv':
      return { icon: FileSpreadsheet, color: '#4ade80' }; // green-400
    case '.xlsx': case '.xls': case '.ods':
      return { icon: FileSpreadsheet, color: '#4ade80' }; // green-400

    // Archives
    case '.zip': case '.tar': case '.gz': case '.bz2': case '.7z': case '.rar': case '.xz':
      return { icon: File, color: '#f59e0b' }; // amber-500

    // Lock / secrets
    case '.lock': case '.pem': case '.crt': case '.cer': case '.key':
      return { icon: File, color: '#eab308' }; // yellow-500

    // Log
    case '.log':
      return { icon: FileText, color: isDark ? '#a1a1aa' : '#9ca3af' };

    default:
      return { icon: File, color: isDark ? '#a1a1aa' : '#71717a' };
  }
}

/**
 * File Item Component
 */
export function FileItem({ file, onPress, onLongPress }: FileItemProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress(file);
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onLongPress?.(file);
  };

  const { icon: IconComponent, color: iconColor } = getFileIconAndColor(file, isDark);

  return (
    <AnimatedPressable
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 15, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 15, stiffness: 400 });
      }}
      onPress={handlePress}
      onLongPress={handleLongPress}
      style={animatedStyle}
      className="flex-row items-center justify-between active:opacity-70 mb-2"
      accessibilityRole="button"
      accessibilityLabel={file.type === 'directory' ? `Folder ${file.name}` : `File ${file.name}`}
    >
      {/* Left: Icon + Text */}
      <View className="flex-row items-center gap-3 flex-1 min-w-0">
        {/* Icon Container - 48x48 matching avatar size */}
        <View
          style={{
            backgroundColor: isDark ? '#232324' : '#f4f4f5',
            width: 48,
            height: 48,
          }}
          className="rounded-xl items-center justify-center flex-shrink-0"
        >
          <Icon 
            as={IconComponent} 
            size={20} 
            color={iconColor}
            strokeWidth={2}
          />
        </View>

        {/* Text Content */}
        <View className="flex-1 min-w-0">
          <Text
            style={{ color: isDark ? '#f8f8f8' : '#121215' }}
            className="text-base font-roobert-medium"
            numberOfLines={1}
          >
            {file.name}
          </Text>
          {file.type === 'directory' && (
            <Text
              style={{ color: isDark ? 'rgba(248, 248, 248, 0.5)' : 'rgba(18, 18, 21, 0.5)' }}
              className="text-xs font-roobert mt-0.5"
            >
              Folder
            </Text>
          )}
        </View>
      </View>

      {/* Right: Chevron */}
      <Icon
        as={ChevronRight}
        size={20}
        color={isDark ? 'rgba(248, 248, 248, 0.3)' : 'rgba(18, 18, 21, 0.3)'}
        strokeWidth={2}
        className="flex-shrink-0"
      />
    </AnimatedPressable>
  );
}

