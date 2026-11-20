import { useMemo, type RefObject } from 'react';
import { Film, Scissors } from 'lucide-react';
import { useAppState } from '../Context/AppStateContext';
import { useSelectedVideo } from '../Context/SelectedVideoContext';
import { useSegments } from '../Context/SegmentsContext';
import { useSettings } from '../Context/SettingsContext';
import { useRecordingSnapshot } from '../Hooks/useRecordingSnapshot';
import { BookmarkType, type Bookmark, type Content } from '../Models/types';
import { getBookmarkPlaybackStart } from '../Utils/BookmarkUtils';
import { timeStringToSeconds } from '../Utils/NumberUtils';
import Button from './Button';

interface OpenFullSessionButtonProps {
  bookmarkType: BookmarkType.ReplaySaved | BookmarkType.ScreenshotSaved | BookmarkType.ClipSaved;
  mediaId?: string;
  previewUrl?: string;
  videoRef?: RefObject<HTMLVideoElement | null>;
  clipTime?: number;
  duration?: number;
}

interface SourceExcerpt {
  source?: Content;
  start: number;
  end: number;
  offset?: number;
}

export default function OpenFullSessionButton({
  bookmarkType,
  mediaId,
  previewUrl,
  videoRef,
  clipTime,
  duration = Infinity,
}: OpenFullSessionButtonProps) {
  const { content, recording } = useAppState();
  const settings = useSettings();
  const { opening, openSnapshot } = useRecordingSnapshot();
  const { previousVideoId, openLinkedMedia } = useSelectedVideo();
  const { segments, addSegment, setActiveSegmentId } = useSegments();
  const isClip = bookmarkType === BookmarkType.ClipSaved;
  const links = useMemo(() => {
    const matches: SourceExcerpt[] = [];
    if (!mediaId) return matches;
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
    // Prefer the original recording, then a replay, then the nearest available derived video.
    const rank = (link: SourceExcerpt) =>
      !link.source || link.source.type === 'Session' ? 0 : link.source.type === 'Buffer' ? 1 : 2;
    return matches.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (b.offset ?? 0) - (a.offset ?? 0) ||
        Number(b.source?.id === previousVideoId) - Number(a.source?.id === previousVideoId),
    );
  }, [
    content,
    recording?.bookmarks,
    recording?.filePath,
    bookmarkType,
    mediaId,
    isClip,
    previousVideoId,
  ]);

  function excerptAt(time: number | undefined, fullSessionOnly: boolean) {
    return links.find((link) => {
      if (fullSessionOnly && link.source && link.source.type !== 'Session') return false;
      if (!isClip || time === undefined) return true;
      if (link.offset == null || link.end <= link.start) return false;
      const end = link.offset + link.end - link.start;
      return (
        time >= link.offset &&
        (time <= end || (time <= duration && Math.abs(duration - end) < 0.05))
      );
    });
  }

  function openSource(adjust: boolean) {
    const player = videoRef?.current;
    const time = clipTime === undefined ? undefined : (player?.currentTime ?? clipTime);
    const link = excerptAt(time, !adjust);
    if (!link) return;
    const position = player ? { time: player.currentTime, paused: player.paused } : undefined;
    const navigate = (source: Content) => {
      let target = link.start;
      if (adjust && mediaId && link.offset != null) {
        const existing = segments.find(
          (s) =>
            s.contentId === source.id &&
            s.adjustedFrom?.mediaId === mediaId &&
            s.adjustedFrom.offset === link.offset,
        );
        if (existing) {
          setActiveSegmentId(existing.id);
          target = existing.startTime;
        } else {
          addSegment({
            id: Date.now(),
            contentId: source.id,
            type: source.type,
            startTime: link.start,
            endTime: link.end,
            adjustedFrom: { mediaId, offset: link.offset },
            fileName: source.fileName,
            filePath: source.filePath,
            game: source.game,
            title: source.title,
            igdbId: source.igdbId,
            isLoading: false,
          });
        }
      } else if (bookmarkType === BookmarkType.ReplaySaved) {
        target = getBookmarkPlaybackStart(link.start, bookmarkType, source, settings);
      } else if (time !== undefined && link.offset != null) {
        target += Math.min(time - link.offset, link.end - link.start);
      }
      openLinkedMedia(
        { type: 'video', video: source, previewUrl, startPaused: adjust ? true : undefined },
        position,
        target,
      );
    };
    if (link.source) navigate(link.source);
    else if (recording?.filePath) openSnapshot(recording.filePath, navigate, link.end);
  }

  const canOpenSession = !!excerptAt(clipTime, true);
  const canAdjust = isClip && !!excerptAt(clipTime, false);
  const multipleExcerpts = isClip && links.some((link) => (link.offset ?? 0) > 0);
  return (
    <>
      <span title={canOpenSession ? undefined : 'No linked Full Session'}>
        <Button
          size="sm"
          className="h-10 hover:text-accent"
          disabled={!canOpenSession || opening}
          onClick={() => openSource(false)}
        >
          <Film className="w-5 h-5" />
          {opening ? 'Opening…' : 'Open Full Session'}
        </Button>
      </span>
      {isClip && (
        <span
          title={
            canAdjust
              ? 'Adjust this excerpt in its source and save a new clip'
              : 'The source for this excerpt is unavailable'
          }
        >
          <Button
            size="sm"
            className="h-10 hover:text-accent"
            disabled={!canAdjust || opening}
            onClick={() => openSource(true)}
          >
            <Scissors className="w-5 h-5" />
            {multipleExcerpts ? 'Adjust this excerpt' : 'Adjust cut'}
          </Button>
        </span>
      )}
    </>
  );
}
