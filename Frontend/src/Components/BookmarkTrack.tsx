import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, Skull, type LucideIcon } from 'lucide-react';
import { BookmarkType, type Bookmark } from '../Models/types';
import { formatTimecode, timeStringToSeconds } from '../Utils/NumberUtils';

interface BookmarkTrackProps {
  bookmarks: Bookmark[];
  duration: number;
  icons: Record<BookmarkType, LucideIcon>;
  label: (type: BookmarkType) => string;
  onSelect: (bookmark: Bookmark, trigger: HTMLElement) => void;
  onDelete?: (id: number) => void;
  fullscreen?: boolean;
}

interface Marker {
  bookmark: Bookmark;
  time: number;
  start?: number;
}

interface MarkerGroup {
  markers: Marker[];
  center: number;
  width: number;
}

// Lay out the actual button footprints. Growing a single marker into a count badge
// can also make it overlap its neighbour on the left.
function groupMarkers(markers: Marker[], width: number, duration: number): MarkerGroup[] {
  const groups: { first: number; last: number; center: number; width: number }[] = [];
  for (let last = 0; last < markers.length; last++) {
    let first = last;
    while (true) {
      const count = last - first + 1;
      const size = count === 1 ? 22 : 27 + String(count).length * 7;
      const middleTime = (markers[first].time + markers[last].time) / 2;
      const center = Math.max(
        size / 2,
        Math.min(width - size / 2, (middleTime / duration) * width),
      );
      const previous = groups[groups.length - 1];
      if (!previous || center - size / 2 >= previous.center + previous.width / 2 + 2) {
        groups.push({ first, last, center, width: size });
        break;
      }
      groups.pop();
      first = previous.first;
    }
  }
  return groups.map(({ first, last, center, width }) => ({
    markers: markers.slice(first, last + 1),
    center,
    width,
  }));
}

export default memo(function BookmarkTrack({
  bookmarks,
  duration,
  icons,
  label,
  onSelect,
  onDelete,
  fullscreen = false,
}: BookmarkTrackProps) {
  const track = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number>(undefined);
  const panelId = useId();
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<{
    id: number;
    trigger: HTMLButtonElement;
    left: number;
    top: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = track.current!;
    const measure = () => setWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
              : undefined;
          return [
            {
              bookmark,
              time,
              start: start !== undefined && start >= 0 && start < time ? start : undefined,
            },
          ];
        })
        .sort((a, b) => a.time - b.time),
    [bookmarks, duration],
  );
  const groups = useMemo(
    () => (width > 0 && duration > 0 ? groupMarkers(markers, width, duration) : []),
    [markers, width, duration],
  );
  const expandedGroup =
    expanded &&
    groups.find(
      (group) => group.markers.length > 1 && group.markers[0].bookmark.id === expanded.id,
    );

  const cancelClose = () => window.clearTimeout(closeTimer.current);
  const close = () => {
    cancelClose();
    setExpanded(null);
    setHovered(null);
  };
  const closeAfterLeave = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      if (!panel.current?.contains(document.activeElement)) close();
    }, 180);
  };
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !expanded.trigger.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (panel.current?.contains(document.activeElement)) expanded.trigger.focus();
      close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', close);
    };
  }, [expanded]);

  const show = (group: MarkerGroup, trigger: HTMLButtonElement) => {
    cancelClose();
    const rect = trigger.getBoundingClientRect();
    const bounds =
      track.current!.closest('.timeline-wrapper')?.getBoundingClientRect() ??
      track.current!.getBoundingClientRect();
    const availableLeft = Math.max(4, bounds.left);
    const availableRight = Math.min(window.innerWidth - 4, bounds.right);
    const panelWidth = Math.min(680, group.markers.length * 170, availableRight - availableLeft);
    const left = Math.max(
      availableLeft,
      Math.min(availableRight - panelWidth, rect.left + rect.width / 2 - panelWidth / 2),
    );
    setExpanded({
      id: group.markers[0].bookmark.id,
      trigger,
      width: panelWidth,
      left,
      top: rect.bottom,
      maxHeight: Math.min(180, window.innerHeight - rect.bottom - 4),
    });
    setHovered(null);
  };

  const markerDescription = ({ bookmark, time, start }: Marker) => {
    const name = `${label(bookmark.type)}${bookmark.subtype ? ` · ${bookmark.subtype}` : ''}`;
    if (start === undefined) return `${name} · ${formatTimecode(time)}`;
    return `${name} · ${formatTimecode(start)} – ${formatTimecode(time)} (${formatTimecode(time - start)})`;
  };

  return (
    <div
      ref={track}
      className={`absolute z-20 pointer-events-none h-[34px] ${fullscreen ? 'inset-x-[6px] bottom-[calc(50%+2px)]' : 'inset-x-0 bottom-0'}`}
    >
      {markers.map(({ bookmark, start, time }) =>
        start === undefined ? null : (
          <span
            key={bookmark.id}
            aria-hidden="true"
            className={`absolute bottom-0 h-[5px] border-l transition-colors ${hovered === bookmark.id ? 'z-10 bg-[#efaf2b] border-[#efaf2b]' : 'bg-[#efaf2b]/30 border-[#efaf2b]/60'}`}
            style={{
              left: `${(start / duration) * 100}%`,
              width: `${((time - start) / duration) * 100}%`,
            }}
          />
        ),
      )}
      {groups.map((group) => {
        const first = group.markers[0];
        const multiple = group.markers.length > 1;
        const Icon = multiple ? Layers : (icons[first.bookmark.type] ?? Skull);
        const description = multiple
          ? `${group.markers.length} bookmarks`
          : markerDescription(first);
        return (
          <button
            key={first.bookmark.id}
            type="button"
            data-bookmark-control
            data-bookmark-group={multiple || undefined}
            aria-label={
              multiple ? description : `${label(first.bookmark.type)} at ${first.bookmark.time}`
            }
            title={description}
            aria-expanded={multiple ? expandedGroup === group : undefined}
            aria-controls={multiple && expandedGroup === group ? panelId : undefined}
            className="absolute bottom-0 flex -translate-x-1/2 cursor-pointer flex-col items-center text-[#25272e] pointer-events-auto"
            style={{ left: group.center, width: group.width }}
            onPointerEnter={(e) => {
              if (multiple && e.pointerType === 'mouse') show(group, e.currentTarget);
              else setHovered(first.bookmark.id);
            }}
            onPointerLeave={() => {
              setHovered(null);
              if (multiple) closeAfterLeave();
            }}
            onFocus={() => {
              if (!multiple) setHovered(first.bookmark.id);
            }}
            onBlur={() => setHovered(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (multiple) {
                show(group, e.currentTarget);
                if (e.detail === 0)
                  requestAnimationFrame(() => panel.current?.querySelector('button')?.focus());
              } else {
                close();
                onSelect(first.bookmark, e.currentTarget);
              }
            }}
            onContextMenu={(e) => {
              if (multiple || !onDelete) return;
              e.preventDefault();
              close();
              onDelete(first.bookmark.id);
            }}
          >
            <span className="flex h-[22px] w-full items-center justify-center gap-0.5 rounded-full bg-[#efaf2b] text-[10px] font-bold">
              <Icon size={multiple ? 13 : 16} strokeWidth={2.5} />
              {multiple && group.markers.length}
            </span>
            <span
              className={`w-[2px] bg-[#efaf2b] ${fullscreen ? 'h-[9px]' : 'h-3'}`}
              style={
                multiple
                  ? undefined
                  : { transform: `translateX(${(first.time / duration) * width - group.center}px)` }
              }
            />
          </button>
        );
      })}
      {expanded &&
        expandedGroup &&
        createPortal(
          <div
            id={panelId}
            ref={panel}
            role="group"
            aria-label="Overlapping bookmarks"
            data-bookmark-control
            data-bookmark-popup
            className="fixed z-[75] flex flex-wrap gap-1 overflow-auto rounded-md border border-base-400 bg-base-300 p-1 shadow-lg"
            style={{
              top: expanded.top,
              left: expanded.left,
              width: expanded.width,
              maxHeight: expanded.maxHeight,
            }}
            onPointerEnter={cancelClose}
            onPointerLeave={closeAfterLeave}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (
                !e.currentTarget.contains(e.relatedTarget) &&
                expanded.trigger !== e.relatedTarget
              )
                close();
            }}
          >
            {expandedGroup.markers.map((marker) => {
              const { bookmark } = marker;
              const Icon = icons[bookmark.type] ?? Skull;
              return (
                <button
                  key={bookmark.id}
                  type="button"
                  aria-label={`${label(bookmark.type)} at ${bookmark.time}`}
                  title={markerDescription(marker)}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-white hover:bg-base-100 focus:bg-base-100"
                  onPointerEnter={() => setHovered(bookmark.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => setHovered(bookmark.id)}
                  onClick={() => {
                    expanded.trigger.focus({ preventScroll: true });
                    onSelect(bookmark, expanded.trigger);
                    close();
                  }}
                  onContextMenu={(e) => {
                    if (onDelete) {
                      e.preventDefault();
                      close();
                      onDelete(bookmark.id);
                    }
                  }}
                >
                  <Icon size={14} className="text-[#efaf2b]" />
                  <span>
                    {label(bookmark.type)}
                    {bookmark.subtype && ` · ${bookmark.subtype}`}
                  </span>
                  <span className="tabular-nums text-white/70">{formatTimecode(marker.time)}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
});
