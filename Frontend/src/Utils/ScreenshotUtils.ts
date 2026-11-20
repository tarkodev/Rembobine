import type { Screenshot } from '../Models/types';

// The old backend saved the complete native PNG filename in Full Session bookmarks.
const legacyCaptureName = /^.+ - \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.\d{3} - [0-9a-f]{8}\.png$/i;

export function getScreenshotMediaId(screenshot: Screenshot) {
  if (screenshot.isImported) return undefined;
  if (screenshot.mediaId === undefined && legacyCaptureName.test(screenshot.fileName))
    return screenshot.fileName;
  return screenshot.mediaId ?? undefined;
}

function parentDirectory(path: string) {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(0, normalized.lastIndexOf('/'));
}

export function resolveScreenshot(screenshots: Screenshot[], selected: Screenshot | null) {
  if (!selected) return undefined;
  if (selected.selectionId) {
    const renamed = screenshots.find((item) => item.selectionId === selected.selectionId);
    if (renamed) return renamed;
  }
  const mediaId = getScreenshotMediaId(selected);
  const exact = screenshots.find(
    (item) => item.filePath === selected.filePath && getScreenshotMediaId(item) === mediaId,
  );
  if (exact || selected.isImported) return exact;
  if (mediaId) {
    const matches = screenshots.filter((item) => getScreenshotMediaId(item) === mediaId);
    return matches.length === 1 ? matches[0] : undefined;
  }

  // The game-folder setting moves captures by one directory level without rewriting the image.
  const oldFolder = parentDirectory(selected.filePath);
  const matches = screenshots.filter((item) => {
    if (
      item.isImported ||
      getScreenshotMediaId(item) ||
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
