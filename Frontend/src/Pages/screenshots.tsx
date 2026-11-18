import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileUp } from 'lucide-react';
import Button from '../Components/Button';
import ContentFilters, { ALL_GAMES, IMPORTED } from '../Components/ContentFilters';
import type { GameOption, SortOption } from '../Components/ContentFilters';
import ScreenshotActions from '../Components/ScreenshotActions';
import ScreenshotViewer from '../Components/ScreenshotViewer';
import { useAppState } from '../Context/AppStateContext';
import { useScroll } from '../Context/ScrollContext';
import { useSettings } from '../Context/SettingsContext';
import { getContentFileUrl } from '../Utils/FileUtils';
import { sendMessageToBackend } from '../Utils/MessageUtils';

const SECTION_ID = 'screenshots';
const SCREENSHOT_SORTS: SortOption[] = ['newest', 'oldest', 'size', 'game'];

interface ScreenshotsProps {
  selectedPath: string | null;
  onSelect: (filePath: string | null) => void;
}

function readPreference(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(`${SECTION_ID}-${key}`) ?? 'null');
  } catch {
    return null;
  }
}

export default function Screenshots({ selectedPath, onSelect }: ScreenshotsProps) {
  const { screenshots, gameList } = useAppState();
  const { games: gameSettings, airplaneMode } = useSettings();
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

  const gameOptions = useMemo(() => {
    const byGame = new Map<string, GameOption>();
    let importedCount = 0;
    for (const screenshot of screenshots) {
      if (screenshot.isImported) importedCount++;
      const game = screenshot.game;
      if (!game) continue;

      const group = byGame.get(game);
      if (group) {
        group.count++;
        continue;
      }

      const setting = gameSettings.find((item) => item.name === game);
      const iconId = gameList.find((item) => item.name === game)?.icon || setting?.icon;
      const icon =
        iconId && !airplaneMode
          ? `https://segra.tv/api/games/icon/${iconId}`
          : setting?.customIcon
            ? `data:image/png;base64,${setting.customIcon}`
            : null;
      byGame.set(game, { key: game, name: game, icon, count: 1 });
    }

    const options = [...byGame.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
    if (importedCount > 0)
      options.push({ key: IMPORTED, name: 'Imported', icon: null, count: importedCount });
    return options;
  }, [screenshots, gameList, gameSettings, airplaneMode]);

  const gameFilter = gameOptions.some((game) => game.key === selectedGame)
    ? selectedGame
    : ALL_GAMES;

  const filtered = useMemo(
    () =>
      screenshots
        .filter((screenshot) => {
          if (gameFilter === ALL_GAMES) return true;
          return gameFilter === IMPORTED ? screenshot.isImported : screenshot.game === gameFilter;
        })
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

  const selectedIndex = filtered.findIndex((screenshot) => screenshot.filePath === selectedPath);
  const selected = filtered[selectedIndex];

  useEffect(() => {
    if (selectedPath && !screenshots.some((item) => item.filePath === selectedPath)) onSelect(null);
  }, [screenshots, selectedPath, onSelect]);

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
          <Button
            variant="primary"
            size="sm"
            className="no-animation h-8 gap-1"
            onClick={() => sendMessageToBackend('ImportFile', { sectionId: SECTION_ID })}
          >
            <FileUp size={16} />
            Import
          </Button>
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
              className="card card-compact w-full bg-base-300 text-gray-300"
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
              </figure>
              <button
                type="button"
                className="absolute inset-0 z-10 cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`View screenshot ${screenshot.title}`}
                onClick={() => {
                  setScrollPosition('screenshots', galleryRef.current?.scrollTop ?? 0);
                  onSelect(screenshot.filePath);
                }}
              />
              <div className="card-body gap-1 rounded-b-[inherit] border border-t-0 border-[#49515b] pt-2">
                <div className="flex items-center justify-between gap-1">
                  <h2 className="card-title min-w-0 truncate !block" title={screenshot.fileName}>
                    {screenshot.title}
                  </h2>
                  <div className="relative z-20 shrink-0">
                    <ScreenshotActions screenshot={screenshot} />
                  </div>
                </div>
                <div className="text-sm text-gray-200">
                  {screenshot.fileSize && <>{screenshot.fileSize} &bull; </>}
                  <time dateTime={screenshot.createdAt}>
                    {new Date(screenshot.createdAt).toLocaleDateString()}
                  </time>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
