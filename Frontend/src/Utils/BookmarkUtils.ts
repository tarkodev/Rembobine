import {
  BookmarkType,
  type Bookmark,
  type Content,
  type Recording,
  type Settings,
} from '../Models/types';
import { timeStringToSeconds } from './NumberUtils';

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

export interface SourceExcerpt {
  source?: Content;
  start: number;
  end: number;
  offset?: number;
}

export function findSourceExcerpts(
  mediaId: string | undefined,
  bookmarkType: BookmarkType,
  content: Content[],
  recording?: Recording,
): SourceExcerpt[] {
  const isClip = bookmarkType === BookmarkType.ClipSaved;
  const matches: SourceExcerpt[] = [];
  if (!mediaId) return matches;
  const excerpts = isClip ? content.find((item) => item.id === mediaId)?.sourceExcerpts : undefined;
  for (const excerpt of excerpts ?? []) {
    const source = content.find((item) => item.id === excerpt.sourceId);
    if (source)
      matches.push({ source, start: excerpt.start, end: excerpt.end, offset: excerpt.offset });
  }
  const collect = (marks: Bookmark[], source?: Content) => {
    for (const mark of marks) {
      if (mark.type !== bookmarkType || mark.mediaId !== mediaId || mark.inherited) continue;
      const end = timeStringToSeconds(mark.time);
      const start = mark.clipStart == null ? end : timeStringToSeconds(mark.clipStart);
      matches.push({ source, start, end, offset: mark.clipOffset });
    }
  };
  for (const source of content) {
    if (source.id !== mediaId && (isClip || source.type === 'Session')) {
      collect(source.bookmarks ?? [], source);
    }
  }
  if (recording?.filePath) collect(recording.bookmarks ?? []);
  return matches;
}
