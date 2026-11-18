import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent, SyntheticEvent } from 'react';

interface Size {
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

interface View extends Point {
  scale: number;
}

const FITTED_VIEW: View = { scale: 1, x: 0, y: 0 };
export const MAX_SCREENSHOT_ZOOM = 4;

export function useScreenshotViewport(filePath: string) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<(Point & { id: number }) | null>(null);
  const [stageSize, setStageSize] = useState<Size>({ width: 0, height: 0 });
  const [imageRatio, setImageRatio] = useState<number | null>(null);
  const [view, setView] = useState(FITTED_VIEW);
  const [isPanning, setIsPanning] = useState(false);
  const fittedWidth =
    imageRatio === null ? 0 : Math.min(stageSize.width, stageSize.height * imageRatio);
  const viewportSize =
    imageRatio === null
      ? { width: '100%', height: '100%' }
      : { width: fittedWidth, height: fittedWidth / imageRatio };

  const updateView = useCallback((update: (previous: View) => View) => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image?.naturalWidth || !image.naturalHeight) return;

    const { width, height } = viewport.getBoundingClientRect();
    const { naturalWidth, naturalHeight } = image;
    const fit = Math.min(width / naturalWidth, height / naturalHeight);

    setView((previous) => {
      const { scale, x, y } = update(previous);
      if (scale === 1) return FITTED_VIEW;

      // Clamp to the displayed image so panning cannot reveal space beyond its edges.
      const maxX = Math.max(0, (naturalWidth * fit * scale - width) / 2);
      const maxY = Math.max(0, (naturalHeight * fit * scale - height) / 2);
      const nextX = Math.max(-maxX, Math.min(maxX, x));
      const nextY = Math.max(-maxY, Math.min(maxY, y));
      return scale === previous.scale && nextX === previous.x && nextY === previous.y
        ? previous
        : { scale, x: nextX, y: nextY };
    });
  }, []);

  const changeZoom = useCallback(
    (getScale: (scale: number) => number, focusX = 0, focusY = 0) => {
      updateView((previous) => {
        const scale = Math.min(MAX_SCREENSHOT_ZOOM, Math.max(1, getScale(previous.scale)));
        const ratio = scale / previous.scale;
        return {
          scale,
          x: focusX + (previous.x - focusX) * ratio,
          y: focusY + (previous.y - focusY) * ratio,
        };
      });
    },
    [updateView],
  );

  useLayoutEffect(() => {
    const id = drag.current?.id;
    const viewport = viewportRef.current;
    if (id !== undefined && viewport?.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    drag.current = null;
    setImageRatio(null);
    setIsPanning(false);
    setView(FITTED_VIEW);
  }, [filePath]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const viewport = viewportRef.current;
    if (!stage || !viewport) return;

    const measureStage = () => {
      const { width, height } = stage.getBoundingClientRect();
      setStageSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    };
    measureStage();

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      // Match the video player's exponential wheel zoom, centered on the pointer.
      const factor = Math.exp(-event.deltaY * unit * 0.0015);
      changeZoom(
        (scale) => scale * factor,
        event.clientX - rect.left - rect.width / 2,
        event.clientY - rect.top - rect.height / 2,
      );
    };

    viewport.addEventListener('wheel', handleWheel, { passive: false });
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.some((entry) => entry.target === stage)) measureStage();
      if (entries.some((entry) => entry.target === viewport)) updateView((previous) => previous);
    });
    resizeObserver.observe(stage);
    resizeObserver.observe(viewport);
    return () => {
      viewport.removeEventListener('wheel', handleWheel);
      resizeObserver.disconnect();
    };
  }, [changeZoom, updateView]);

  const onImageLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setImageRatio(naturalWidth / naturalHeight);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (view.scale <= 1 || event.button !== 0 || drag.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setIsPanning(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = drag.current;
    if (previous?.id !== event.pointerId) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    drag.current = { ...previous, x: event.clientX, y: event.clientY };
    updateView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };

  const endPan = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setIsPanning(false);
  };

  return {
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
  };
}
