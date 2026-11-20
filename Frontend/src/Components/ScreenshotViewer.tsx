import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, SkipBack, SkipForward, ZoomIn, ZoomOut } from 'lucide-react';
import { useAppState } from '../Context/AppStateContext';
import { useSettings } from '../Context/SettingsContext';
import { getContentGameIcon } from '../Utils/GameIconUtils';
import { useModal } from '../Context/ModalContext';
import { MAX_SCREENSHOT_ZOOM, useScreenshotViewport } from '../Hooks/useScreenshotViewport';
import { BookmarkType, type Screenshot } from '../Models/types';
import { getContentFileUrl } from '../Utils/FileUtils';
import { getScreenshotMediaId } from '../Utils/ScreenshotUtils';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import OpenFullSessionButton from './OpenFullSessionButton';
import MediaInfoBar from './MediaInfoBar';
import { ScreenshotViewerActions } from './ScreenshotActions';

interface ScreenshotViewerProps {
  screenshot: Screenshot;
  navigation?: {
    previous?: Screenshot;
    next?: Screenshot;
    onSelect: (screenshot: Screenshot) => void;
  };
  onBack: () => void;
}

const playerButtonClass =
  'flex items-center justify-center p-1.5 rounded-full text-white/90 cursor-pointer transition-colors hover:text-white hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent';
const navigationButtonClass =
  'h-10 text-gray-300 btn btn-sm btn-secondary hover:text-accent join-item active:translate-none! disabled:text-gray-300/50';

export default function ScreenshotViewer({
  screenshot,
  navigation,
  onBack,
}: ScreenshotViewerProps) {
  const { isModalOpen } = useModal();
  const { gameList } = useAppState();
  const { games, loadGameArtwork } = useSettings();
  const gameIcon = useMemo(
    () => getContentGameIcon(screenshot, gameList, games, loadGameArtwork),
    [screenshot, gameList, games, loadGameArtwork],
  );
  const { previous, next, onSelect } = navigation ?? {};
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageKey = screenshot.selectionId ?? screenshot.filePath;
  const {
    stageRef,
    viewportRef,
    viewportSize,
    imageRef,
    onImageLoad,
    view,
    isPanning,
    changeZoom,
    onPointerDown,
    onPointerMove,
    endPan,
  } = useScreenshotViewport(imageKey);

  useLayoutEffect(() => {
    setImageFailed(false);
  }, [screenshot.filePath]);

  const toggleFullscreen = useCallback(() => {
    const enabled = !fullscreenRef.current;
    fullscreenRef.current = enabled;
    setIsFullscreen(enabled);
    sendMessageToBackend('ToggleFullscreen', { enabled });
  }, []);

  useEffect(
    () => () => {
      if (fullscreenRef.current) sendMessageToBackend('ToggleFullscreen', { enabled: false });
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isModalOpen || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey)
        return;

      switch (event.key) {
        case 'ArrowLeft':
          if (!previous || !onSelect) return;
          onSelect(previous);
          break;
        case 'ArrowRight':
          if (!next || !onSelect) return;
          onSelect(next);
          break;
        case 'f':
        case 'F':
          if (event.repeat) return;
          toggleFullscreen();
          break;
        case 'Escape':
          if (isFullscreen) toggleFullscreen();
          else onBack();
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isFullscreen, next, onBack, onSelect, previous, toggleFullscreen]);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-base-200 p-4">
      <h1 className="sr-only">{screenshot.title}</h1>
      {!isFullscreen && (
        <header className="mb-2 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <MediaInfoBar
            className="min-w-0 flex-1 basis-80"
            createdAt={screenshot.createdAt}
            fileSize={screenshot.fileSize ?? '—'}
            filePath={screenshot.filePath}
            game={screenshot.game ?? undefined}
            gameIcon={gameIcon}
            onBack={onBack}
          />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <ScreenshotViewerActions key={imageKey} screenshot={screenshot} />
          </div>
        </header>
      )}
      <div
        ref={stageRef}
        className={`flex items-center justify-center overflow-hidden ${
          isFullscreen ? 'fixed inset-0 z-50 bg-base-200' : 'min-h-0 flex-1'
        }`}
      >
        <div
          className={`group/preview relative shrink-0 overflow-hidden ${isFullscreen ? '' : 'rounded-lg'}`}
          style={viewportSize}
        >
          <div
            ref={viewportRef}
            className={`absolute inset-0 overflow-hidden ${view.scale > 1 ? `touch-none ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}` : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onLostPointerCapture={endPan}
          >
            {imageFailed ? (
              <div
                className="grid h-full place-items-center p-4 text-center text-white/70"
                role="status"
              >
                Could not open this screenshot.
              </div>
            ) : (
              <img
                key={imageKey}
                ref={imageRef}
                className="block h-full w-full select-none object-contain"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                draggable={false}
                src={getContentFileUrl(screenshot.filePath)}
                alt={screenshot.title}
                onLoad={onImageLoad}
                onError={() => setImageFailed(true)}
              />
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 isolate flex justify-end px-3 pb-2 opacity-0 select-none transition-opacity duration-200 group-hover/preview:opacity-100 has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100">
            <div className="absolute inset-x-0 bottom-0 -z-10 h-24 bg-linear-to-t from-black/80 via-black/35 to-transparent" />
            <div className="flex items-center gap-1 group-hover/preview:pointer-events-auto has-[:focus-visible]:pointer-events-auto [@media(hover:none)]:pointer-events-auto">
              <button
                type="button"
                className={playerButtonClass}
                disabled={imageFailed || view.scale <= 1}
                onClick={() => changeZoom((scale) => scale - 0.5)}
                aria-label="Zoom out"
                title="Zoom out"
              >
                <ZoomOut className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={playerButtonClass}
                disabled={imageFailed || view.scale >= MAX_SCREENSHOT_ZOOM}
                onClick={() => changeZoom((scale) => scale + 0.5)}
                aria-label="Zoom in"
                title="Zoom in"
              >
                <ZoomIn className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={playerButtonClass}
                aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
      {!isFullscreen && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 pt-2">
          {navigation && (
            <div className="join flex items-center rounded-lg border border-base-400 bg-base-300">
              <button
                type="button"
                className={navigationButtonClass}
                disabled={!previous}
                onClick={() => previous && navigation.onSelect(previous)}
                aria-label="Previous screenshot"
                title="Previous screenshot (←)"
              >
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                className={navigationButtonClass}
                disabled={!next}
                onClick={() => next && navigation.onSelect(next)}
                aria-label="Next screenshot"
                title="Next screenshot (→)"
              >
                <SkipForward className="h-5 w-5" />
              </button>
            </div>
          )}
          <OpenFullSessionButton
            key={imageKey}
            bookmarkType={BookmarkType.ScreenshotSaved}
            mediaId={getScreenshotMediaId(screenshot)}
            previewUrl={getContentFileUrl(screenshot.filePath)}
          />
        </div>
      )}
    </section>
  );
}
