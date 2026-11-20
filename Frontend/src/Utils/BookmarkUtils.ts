import { BookmarkType, type Content, type Settings } from '../Models/types';

export function getBookmarkPlaybackStart(
  time: number,
  type: BookmarkType,
  session: Content,
  settings: Settings,
): number {
  if (type === BookmarkType.ScreenshotSaved) return time;
  if (type === BookmarkType.Manual) return Math.max(0, time - 10);

  const game = settings.games.find(
    (g) =>
      (g.igdbId != null && g.igdbId === session.igdbId) ||
      g.name.toLowerCase() === session.game?.toLowerCase(),
  );
  const lead = game?.highlightPaddingOverride?.before ?? settings.highlightPaddingBefore;
  return Math.max(0, time - lead);
}
