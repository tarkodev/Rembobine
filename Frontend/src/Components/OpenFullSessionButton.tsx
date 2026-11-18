import { useMemo, type RefObject } from 'react';
import { Film } from 'lucide-react';
import { useAppState } from '../Context/AppStateContext';
import { useSelectedVideo } from '../Context/SelectedVideoContext';
import { BookmarkType, type Content } from '../Models/types';
import { timeStringToSeconds } from '../Utils/NumberUtils';
import Button from './Button';

interface OpenFullSessionButtonProps {
  bookmarkType: BookmarkType.ReplaySaved | BookmarkType.ScreenshotSaved | BookmarkType.ClipSaved;
  mediaId?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  clipTime?: number;
  duration?: number;
}

export default function OpenFullSessionButton({
  bookmarkType,
  mediaId,
  videoRef,
  clipTime,
  duration = Infinity,
}: OpenFullSessionButtonProps) {
  const { content } = useAppState();
  const { previousVideoId, openLinkedMedia } = useSelectedVideo();
  const links = useMemo(() => {
    const matches: { session: Content; sourceStart: number; offset?: number; length?: number }[] =
      [];
    if (!mediaId) return matches;
    for (const session of content) {
      if (session.type !== 'Session') continue;
      for (const bookmark of session.bookmarks ?? []) {
        if (bookmark.type !== bookmarkType || bookmark.mediaId !== mediaId) continue;
        const time = timeStringToSeconds(bookmark.time);
        const start =
          bookmark.clipStart === undefined ? undefined : timeStringToSeconds(bookmark.clipStart);
        matches.push({
          session,
          sourceStart: start ?? time,
          offset: bookmark.clipOffset,
          length: start === undefined ? undefined : time - start,
        });
      }
    }
    // Prefer the excerpt under the playhead, then the session the viewer came from.
    return matches.sort(
      (a, b) =>
        (b.offset ?? 0) - (a.offset ?? 0) ||
        Number(b.session.id === previousVideoId) - Number(a.session.id === previousVideoId) ||
        Date.parse(a.session.createdAt) - Date.parse(b.session.createdAt),
    );
  }, [content, bookmarkType, mediaId, previousVideoId]);

  const sessionAt = (time?: number) => {
    if (time === undefined) return links[0];
    return links.find(({ offset, length }) => {
      if (offset === undefined || length === undefined) return false;
      const end = offset + length;
      // The encoded file can contain a final partial frame of audio past the selected cut.
      return time >= offset && (time <= end || (time <= duration && duration - end < 0.05));
    });
  };
  const linkedSession = sessionAt(clipTime);

  const openSession = () => {
    const player = videoRef?.current;
    const time = clipTime === undefined ? undefined : (player?.currentTime ?? clipTime);
    const link = sessionAt(time);
    if (!link) return;
    const elapsed = time === undefined ? 0 : Math.min(time - (link.offset ?? 0), link.length ?? 0);
    openLinkedMedia(
      { type: 'video', video: link.session },
      player ? { time: player.currentTime, paused: player.paused } : undefined,
      link.sourceStart + elapsed,
    );
  };

  return (
    <span title={linkedSession ? undefined : 'No linked Full Session'}>
      <Button
        size="sm"
        className="h-10 hover:text-accent"
        disabled={!linkedSession}
        onClick={openSession}
      >
        <Film className="w-5 h-5" />
        Open Full Session
      </Button>
    </span>
  );
}
