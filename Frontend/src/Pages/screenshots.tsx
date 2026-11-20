import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import LibraryFolderActions from '../Components/LibraryFolderActions';
import ContentFilters, { ALL_GAMES, matchesGameFilter } from '../Components/ContentFilters';
import type { SortOption } from '../Components/ContentFilters';
import LibraryMediaMetadata from '../Components/LibraryMediaMetadata';
import {
  ScreenshotCardMenu,
  ScreenshotRenameInput,
  type ScreenshotMenuAnchor,
} from '../Components/ScreenshotActions';
import ScreenshotViewer from '../Components/ScreenshotViewer';
import { useAppState } from '../Context/AppStateContext';
import { useScroll } from '../Context/ScrollContext';
import { useLibraryGames } from '../Hooks/useLibraryGames';
import type { Screenshot } from '../Models/types';
import { resolveScreenshot } from '../Utils/ScreenshotUtils';
import { getContentFileUrl } from '../Utils/FileUtils';

const SECTION_ID = 'screenshots';
const SCREENSHOT_SORTS: SortOption[] = ['newest', 'oldest', 'size', 'game'];

interface ScreenshotsProps {
  selectedScreenshot: Screenshot | null;
  onSelect: (screenshot: Screenshot | null) => void;
}

function readPreference(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(`${SECTION_ID}-${key}`) ?? 'null');
  } catch {
    return null;
  }
}

export default function Screenshots({ selectedScreenshot, onSelect }: ScreenshotsProps) {
  const { screenshots } = useAppState();
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ path: string; anchor: ScreenshotMenuAnchor } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [selectedGame, setSelectedGame] = useState(() => {
    const saved = readPreference('filters');
    return typeof saved === 'string' ? saved : ALL_GAMES;
  });
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    const saved = readPreference('sort');
    return SCREENSHOT_SORTS.find((sort) => sort === saved) ?? 'newest';
  });
  const galleryRef = useRef<HTMLDivElement>(null);
  const { scrollPositions, setScrollPosition } = useScroll();

  const { gameOptions, gamesByName } = useLibraryGames(screenshots);

  const gameFilter = gameOptions.some((game) => game.key === selectedGame)
    ? selectedGame
    : ALL_GAMES;

  const filtered = useMemo(
    () =>
      screenshots
        .filter((screenshot) => matchesGameFilter(screenshot, gameFilter))
        .sort((a, b) => {
          const newestFirst = Date.parse(b.createdAt) - Date.parse(a.createdAt);
          switch (sortOption) {
            case 'oldest':
              return -newestFirst;
            case 'size':
              return b.fileSizeBytes - a.fileSizeBytes || newestFirst;
            case 'game':
              return (a.game ?? a.title).localeCompare(b.game ?? b.title) || newestFirst;
            default:
              return newestFirst;
          }
        }),
    [gameFilter, screenshots, sortOption],
  );

  const saved = resolveScreenshot(screenshots, selectedScreenshot);
  const selectedIndex = saved ? filtered.indexOf(saved) : -1;
  const selected = filtered[selectedIndex];

  useEffect(() => {
    if (selectedScreenshot && selectedScreenshot.filePath !== saved?.filePath)
      onSelect(saved ?? null);
  }, [selectedScreenshot, saved, onSelect]);

  useLayoutEffect(() => {
    if (!selected && galleryRef.current) galleryRef.current.scrollTop = scrollPositions.screenshots;
  }, [selected, scrollPositions.screenshots]);

  if (selected) {
    return (
      <ScreenshotViewer
        screenshot={selected}
        navigation={{
          previous: filtered[selectedIndex - 1],
          next: filtered[selectedIndex + 1],
          onSelect,
        }}
        onBack={() => onSelect(null)}
      />
    );
  }

  return (
    <div
      className="relative h-full space-y-6 overflow-y-scroll overflow-x-hidden bg-base-200 p-5"
      ref={galleryRef}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.75rem] font-bold">Screenshots</h1>
        <div className="flex flex-wrap items-center gap-2">
          <LibraryFolderActions
            sectionId={SECTION_ID}
            filter={gameOptions.find((game) => game.key === gameFilter)}
          />
          <ContentFilters
            games={gameOptions}
            totalCount={screenshots.length}
            onGameFilterChange={setSelectedGame}
            onSortChange={setSortOption}
            sectionId={SECTION_ID}
            selectedGame={gameFilter}
            sortOption={sortOption}
            showDurationSort={false}
          />
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-gray-500">
          <Camera size={60} className="mb-4" aria-hidden="true" />
          <h2 className="text-xl">No screenshots found</h2>
          <p className="text-sm">
            Import an image, use <strong>Take Screenshot</strong> in game, or save a paused video
            frame.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 min-[90rem]:grid-cols-4 min-[112.5rem]:grid-cols-5">
          {filtered.map((screenshot) => (
            <article
              key={screenshot.filePath}
              className="card card-compact w-full cursor-pointer bg-base-300 text-gray-300"
              onContextMenu={(event) => {
                if (event.target instanceof HTMLInputElement) return;
                event.preventDefault();
                setMenu({
                  path: screenshot.filePath,
                  anchor: { x: event.clientX, y: event.clientY },
                });
              }}
              onClick={() => {
                setScrollPosition('screenshots', galleryRef.current?.scrollTop ?? 0);
                onSelect(screenshot);
              }}
            >
              <figure className="relative aspect-video border border-b-0 border-[#49515b] bg-base-200">
                <img
                  className="absolute inset-0 h-full w-full select-none object-contain"
                  src={getContentFileUrl(screenshot.filePath)}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  decoding="async"
                />
                <button
                  type="button"
                  className="absolute inset-0 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  aria-label={`View screenshot ${screenshot.title}`}
                />
              </figure>
              <div className="card-body gap-1 rounded-b-[inherit] border border-t-0 border-[#49515b] pt-2">
                <div className="flex items-center justify-between gap-1">
                  {renamingPath === screenshot.filePath ? (
                    <ScreenshotRenameInput
                      screenshot={screenshot}
                      onClose={() => setRenamingPath(null)}
                    />
                  ) : (
                    <h2 className="card-title min-w-0 truncate !block" title={screenshot.fileName}>
                      {screenshot.title}
                    </h2>
                  )}
                  <div
                    className="relative z-20 shrink-0"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <ScreenshotCardMenu
                      screenshot={screenshot}
                      anchor={menu?.path === screenshot.filePath ? menu.anchor : null}
                      onOpen={() => setMenu({ path: screenshot.filePath, anchor: 'button' })}
                      onClose={closeMenu}
                      onRename={() => setRenamingPath(screenshot.filePath)}
                    />
                  </div>
                </div>
                <div className="text-sm text-gray-200">
                  <LibraryMediaMetadata
                    game={screenshot.game}
                    gameIcon={screenshot.game ? gamesByName.get(screenshot.game)?.icon : null}
                    fileSize={screenshot.fileSize}
                    createdAt={screenshot.createdAt}
                  />
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
