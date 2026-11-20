import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Skull, type LucideIcon } from 'lucide-react';
import { BookmarkType, type Bookmark } from '../Models/types';
import { formatTime, formatTimecode, timeStringToSeconds } from '../Utils/NumberUtils';

interface BookmarkTrackProps {
  bookmarks: Bookmark[];
  replayStarts: ReadonlyMap<number, number>;
  duration: number;
  icons: Record<BookmarkType, LucideIcon>;
  label: (type: BookmarkType) => string;
  screenshotPreviewUrl: (bookmark: Bookmark) => string;
  onSelect: (bookmark: Bookmark, trigger: HTMLElement) => void;
  onDelete?: (id: number) => void;
  fullscreen?: boolean;
  rulerWidth?: number;
}

interface Marker {
  bookmark: Bookmark;
  time: number;
  start?: number;
}

function markerTimeLabel({ bookmark, time }: Marker) {
  return bookmark.type === BookmarkType.ScreenshotSaved ? formatTime(time) : formatTimecode(time);
}

const MARKER_WIDTH = 22;
const MARKER_PITCH = MARKER_WIDTH + 4;
const PREVIEW_WIDTH = 160;

// Fit the icons near their timestamps with a fixed gap. Adjacent runs slide together
// continuously as zoom changes. Additional rows are needed only when one row is full.
function layoutMarkers(markers: Marker[], width: number, duration: number) {
  const capacity = Math.max(1, Math.floor((width + MARKER_PITCH - MARKER_WIDTH) / MARKER_PITCH));
  const rows = Math.max(1, Math.ceil(markers.length / capacity));
  const positions = new Array<{ center: number; row: number; ordinal?: string }>(markers.length);
  for (let row = 0; row < rows; row++) {
    const count = Math.ceil((markers.length - row) / rows);
    const maxLeft = Math.max(0, width - MARKER_WIDTH - (count - 1) * MARKER_PITCH);
    const runs: { first: number; count: number; sum: number }[] = [];
    for (let i = 0; i < count; i++) {
      const x = (markers[i * rows + row].time / duration) * width;
      const run = { first: i, count: 1, sum: x - MARKER_WIDTH / 2 - i * MARKER_PITCH };
      let previous;
      while (
        (previous = runs[runs.length - 1]) &&
        previous.sum / previous.count > run.sum / run.count
      ) {
        runs.pop();
        run.first = previous.first;
        run.count += previous.count;
        run.sum += previous.sum;
      }
      runs.push(run);
    }
    for (const run of runs) {
      const left = Math.min(maxLeft, Math.max(0, run.sum / run.count));
      for (let j = 0; j < run.count; j++) {
        const i = run.first + j;
        const index = i * rows + row;
        positions[index] = {
          center: left + i * MARKER_PITCH + MARKER_WIDTH / 2,
          row,
          ordinal:
            rows > 1
              ? `${index + 1} of ${markers.length}`
              : run.count > 1
                ? `${j + 1} of ${run.count}`
                : undefined,
        };
      }
    }
  }
  return { positions, rows };
}

export default memo(function BookmarkTrack({
  bookmarks,
  replayStarts,
  duration,
  icons,
  label,
  screenshotPreviewUrl,
  onSelect,
  onDelete,
  fullscreen = false,
  rulerWidth,
}: BookmarkTrackProps) {
  const track = useRef<HTMLDivElement>(null);
  const previewId = useId();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = rulerWidth ?? measuredWidth;
  const [hovered, setHovered] = useState<{ id: number; width: number; anchor?: DOMRect } | null>(
    null,
  );
  const anchor = hovered?.anchor;
  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => setHovered(null);
    window.addEventListener('resize', dismiss);
    document.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('resize', dismiss);
      document.removeEventListener('scroll', dismiss, true);
    };
  }, [anchor]);
  const measureTrack = rulerWidth === undefined;
  useLayoutEffect(() => {
    if (!measureTrack) return;
    const element = track.current!;
    const measure = () => setMeasuredWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [measureTrack]);

  const markers = useMemo(
    () =>
      bookmarks
        .flatMap((bookmark): Marker[] => {
          const sourceTime = timeStringToSeconds(bookmark.time);
          if (!Number.isFinite(sourceTime) || sourceTime < 0) return [];
          // A final frame can round slightly past the duration reported by the decoder.
          const time = Math.min(sourceTime, duration);
          const start =
            bookmark.type === BookmarkType.ClipSaved && bookmark.clipStart
              ? timeStringToSeconds(bookmark.clipStart)
              : replayStarts.get(bookmark.id);
          return [
            {
              bookmark,
              time,
              start: start !== undefined && start >= 0 && start < time ? start : undefined,
            },
          ];
        })
        .sort((a, b) => a.time - b.time),
    [bookmarks, replayStarts, duration],
  );
  const { positions, rows } = useMemo(
    () =>
      width > 0 && duration > 0
        ? layoutMarkers(markers, width, duration)
        : { positions: [], rows: 1 },
    [markers, width, duration],
  );

  const markerDescription = (marker: Marker) => {
    const { bookmark, time, start } = marker;
    const name = `${label(bookmark.type)}${bookmark.subtype ? ` · ${bookmark.subtype}` : ''}`;
    if (start === undefined) return `${name} · ${markerTimeLabel(marker)}`;
    return `${name} · ${formatTimecode(start)} – ${formatTimecode(time)} (${formatTimecode(time - start)})`;
  };

  return (
    <div
      ref={track}
      className={`z-20 pointer-events-none ${fullscreen ? 'absolute inset-x-[6px] bottom-[calc(50%+2px)]' : 'relative w-full'}`}
      style={{ height: (fullscreen ? 31 : markers.length ? 52 : 42) + (rows - 1) * MARKER_PITCH }}
    >
      {markers.map(({ bookmark, start, time }) =>
        start === undefined ? null : (
          <span
            key={bookmark.id}
            aria-hidden="true"
            className={`absolute bottom-0 h-[5px] border-l transition-colors ${hovered?.id === bookmark.id ? 'z-10 bg-[#efaf2b] border-[#efaf2b]' : 'bg-[#efaf2b]/30 border-[#efaf2b]/60'}`}
            style={{
              left: `${(start / duration) * 100}%`,
              width: `${((time - start) / duration) * 100}%`,
            }}
          />
        ),
      )}
      {positions.map(({ center, row, ordinal }, index) => {
        const marker = markers[index];
        const { bookmark, time } = marker;
        const hasPreview = bookmark.type === BookmarkType.ScreenshotSaved;
        const preview =
          hasPreview && hovered?.id === bookmark.id && hovered.width === width ? anchor : undefined;
        const highlight = (trigger: HTMLButtonElement) =>
          setHovered({
            id: bookmark.id,
            width,
            anchor: hasPreview ? trigger.getBoundingClientRect() : undefined,
          });
        const Icon = icons[bookmark.type] ?? Skull;
        const stem = (fullscreen ? 9 : 12) + row * MARKER_PITCH;
        return (
          <button
            key={bookmark.id}
            type="button"
            data-bookmark-control
            aria-label={`${label(bookmark.type)} at ${bookmark.time}${ordinal ? `, ${ordinal}` : ''}`}
            title={hasPreview ? undefined : markerDescription(marker)}
            aria-describedby={preview ? previewId : undefined}
            className="absolute z-10 flex -translate-x-1/2 cursor-pointer items-center justify-center rounded-full bg-[#efaf2b] text-[#25272e] pointer-events-auto"
            style={{ left: center, bottom: stem, width: MARKER_WIDTH, height: MARKER_WIDTH }}
            onPointerEnter={(e) => {
              if (e.pointerType !== 'touch') highlight(e.currentTarget);
            }}
            onPointerLeave={() => setHovered(null)}
            onFocus={(e) => highlight(e.currentTarget)}
            onBlur={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation();
              setHovered(null);
              onSelect(bookmark, e.currentTarget);
            }}
            onContextMenu={(e) => {
              if (!onDelete) return;
              e.preventDefault();
              setHovered(null);
              onDelete(bookmark.id);
            }}
          >
            <Icon size={16} strokeWidth={2.5} />
            <svg
              aria-hidden="true"
              width="2"
              height={stem}
              className="absolute top-full left-1/2 -translate-x-1/2 pointer-events-none overflow-visible"
            >
              <line
                x1="1"
                y1="0"
                x2={1 + (time / duration) * width - center}
                y2="100%"
                stroke="#efaf2b"
                strokeWidth="1.5"
              />
            </svg>
            {preview &&
              createPortal(
                <div
                  id={previewId}
                  role="tooltip"
                  className="pointer-events-none fixed z-[85] overflow-hidden rounded-md bg-base-300 text-center text-xs text-white shadow-lg ring-1 ring-white/15"
                  style={{
                    width: PREVIEW_WIDTH,
                    left: Math.max(
                      4,
                      Math.min(
                        window.innerWidth - PREVIEW_WIDTH - 4,
                        preview.left + preview.width / 2 - PREVIEW_WIDTH / 2,
                      ),
                    ),
                    ...(preview.top > 125
                      ? { bottom: window.innerHeight - preview.top + 5 }
                      : { top: preview.bottom + 5 }),
                  }}
                >
                  <img
                    src={screenshotPreviewUrl(bookmark)}
                    alt=""
                    className="h-[90px] w-full bg-black object-contain"
                    onError={(e) => {
                      e.currentTarget.hidden = true;
                    }}
                  />
                  <span className="block py-1 tabular-nums">{markerTimeLabel(marker)}</span>
                </div>,
                document.body,
              )}
          </button>
        );
      })}
    </div>
  );
});
