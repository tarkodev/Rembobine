import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Maximize,
  Minimize,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useModal } from '../Context/ModalContext';
import type { Screenshot } from '../Models/types';
import { getContentFileUrl, openFileLocation } from '../Utils/FileUtils';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';
import MediaInfoBar from './MediaInfoBar';

interface ScreenshotViewerProps {
  screenshot: Screenshot;
  previous: Screenshot | undefined;
  next: Screenshot | undefined;
  position: number;
  total: number;
  onBack: () => void;
  onSelect: (filePath: string) => void;
  onDelete: (screenshot: Screenshot) => void;
}

const toolClass = 'text-white/90 hover:text-white hover:bg-white/15 disabled:opacity-40';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export default function ScreenshotViewer({
  screenshot,
  previous,
  next,
  position,
  total,
  onBack,
  onSelect,
  onDelete,
}: ScreenshotViewerProps) {
  const { isModalOpen } = useModal();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const [zoom, setZoom] = useState(1);
  const [imageFailed, setImageFailed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setZoom(1);
    setImageFailed(false);
  }, [screenshot.filePath]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTo(
      (viewport.scrollWidth - viewport.clientWidth) / 2,
      (viewport.scrollHeight - viewport.clientHeight) / 2,
    );
  }, [zoom, isFullscreen]);

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
          if (!previous) return;
          onSelect(previous.filePath);
          break;
        case 'ArrowRight':
          if (!next) return;
          onSelect(next.filePath);
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
      <MediaInfoBar
        createdAt={screenshot.createdAt}
        fileSize={formatSize(screenshot.fileSizeBytes)}
        filePath={screenshot.filePath}
        onBack={onBack}
      />
      <div
        className={`flex min-h-0 flex-col overflow-hidden bg-black ${
          isFullscreen ? 'fixed inset-0 z-50' : 'flex-1 rounded-lg'
        }`}
      >
        <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto">
          {imageFailed ? (
            <div
              className="grid h-full place-items-center p-4 text-center text-white/70"
              role="status"
            >
              Could not open this screenshot.
            </div>
          ) : (
            <div style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
              <img
                key={screenshot.filePath}
                className="block h-full w-full select-none object-contain"
                draggable={false}
                src={getContentFileUrl(screenshot.filePath)}
                alt={screenshot.title}
                onError={() => setImageFailed(true)}
              />
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-white/10 px-3 py-2 text-white">
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              disabled={!previous}
              onClick={() => previous && onSelect(previous.filePath)}
              aria-label="Previous screenshot"
              title="Previous screenshot (←)"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <span className="px-1 text-xs tabular-nums text-white/70">
              {position} / {total}
            </span>
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              disabled={!next}
              onClick={() => next && onSelect(next.filePath)}
              aria-label="Next screenshot"
              title="Next screenshot (→)"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <h1
            className="min-w-0 flex-1 truncate text-center text-sm font-medium"
            title={screenshot.title}
          >
            {screenshot.title}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              disabled={imageFailed || zoom <= 1}
              onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
              aria-label="Zoom out"
              title="Zoom out"
            >
              <ZoomOut className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`${toolClass} px-1 tabular-nums`}
              disabled={imageFailed || zoom === 1}
              onClick={() => setZoom(1)}
              aria-label="Fit image to window"
              title="Fit image to window"
            >
              {Math.round(zoom * 100)}%
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              disabled={imageFailed || zoom >= 4}
              onClick={() => setZoom((value) => Math.min(4, value + 0.5))}
              aria-label="Zoom in"
              title="Zoom in"
            >
              <ZoomIn className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              aria-label="Open file location"
              title="Open file location"
              onClick={() => openFileLocation(screenshot.filePath)}
            >
              <FolderOpen className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              aria-label="Delete screenshot"
              title="Delete screenshot"
              onClick={() => onDelete(screenshot)}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              className={toolClass}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
              onClick={toggleFullscreen}
            >
              {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
