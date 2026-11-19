import type { Screenshot } from '../Models/types';

function parentDirectory(path: string) {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(0, normalized.lastIndexOf('/'));
}

export function resolveScreenshot(screenshots: Screenshot[], selected: Screenshot | null) {
  if (!selected) return undefined;
  const exact = screenshots.find((item) => item.filePath === selected.filePath);
  if (exact || selected.isImported) return exact;

  // The game-folder setting moves captures by one directory level without rewriting the image.
  const oldFolder = parentDirectory(selected.filePath);
  const matches = screenshots.filter((item) => {
    if (
      item.isImported ||
      item.fileName !== selected.fileName ||
      item.createdAt !== selected.createdAt ||
      item.fileSizeBytes !== selected.fileSizeBytes
    )
      return false;
    const folder = parentDirectory(item.filePath);
    return parentDirectory(folder) === oldFolder || parentDirectory(oldFolder) === folder;
  });
  return matches.length === 1 ? matches[0] : undefined;
}
