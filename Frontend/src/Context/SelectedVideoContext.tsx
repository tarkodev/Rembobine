import {
  createContext,
  useContext,
  useState,
  ReactNode,
  useCallback,
  useRef,
  type RefObject,
} from 'react';
import type { Content, Screenshot } from '../Models/types';

export type LinkedMedia =
  | {
      type: 'video';
      video: Content;
      previewUrl?: string;
      startPaused?: boolean;
      playlist?: string[];
    }
  | { type: 'screenshot'; screenshot: Screenshot };

export interface PlaybackPosition {
  time: number;
  paused: boolean;
}

interface VideoSelection {
  video: Content | null;
  playlist: string[];
  screenshot?: Screenshot;
  resume?: PlaybackPosition & { previewUrl?: string };
  previous?: VideoSelection;
}

interface SelectedVideoContextProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  selectedVideo: Content | null;
  linkedScreenshot: Screenshot | null;
  // Ids of the list the video was opened from, for previous/next navigation
  playlist: string[];
  resumePlayback?: VideoSelection['resume'];
  setSelectedVideo: (video: Content | null, playlist?: string[]) => void;
  previousVideoId?: string;
  openLinkedMedia: (media: LinkedMedia, playback?: PlaybackPosition, startTime?: number) => void;
  goBack: () => void;
}

const SelectedVideoContext = createContext<SelectedVideoContextProps | undefined>(undefined);

export const SelectedVideoProvider = ({ children }: { children: ReactNode }) => {
  const [selection, setSelection] = useState<VideoSelection>({ video: null, playlist: [] });
  const videoRef = useRef<HTMLVideoElement>(null);

  const setSelectedVideo = useCallback((video: Content | null, list?: string[]) => {
    const paused = videoRef.current?.paused;
    setSelection((previous) => ({
      video,
      playlist: video ? (list ?? previous.playlist) : [],
      resume: (paused ?? previous.resume?.paused) ? { time: 0, paused: true } : undefined,
    }));
  }, []);

  const openLinkedMedia = useCallback(
    (media: LinkedMedia, playback?: PlaybackPosition, startTime?: number) => {
      setSelection((current) => ({
        video: media.type === 'video' ? media.video : null,
        screenshot: media.type === 'screenshot' ? media.screenshot : undefined,
        playlist: media.type === 'video' ? (media.playlist ?? []) : [],
        resume:
          media.type === 'video'
            ? {
                time: startTime ?? 0,
                paused: media.startPaused ?? playback?.paused ?? startTime !== undefined,
                previewUrl: media.previewUrl,
              }
            : playback,
        previous: playback ? { ...current, resume: playback } : current,
      }));
    },
    [],
  );

  const goBack = useCallback(() => {
    const paused = videoRef.current?.paused;
    setSelection((current) => {
      const previous: VideoSelection = current.previous ?? { video: null, playlist: [] };
      if (!(paused ?? current.resume?.paused)) return previous;
      return {
        ...previous,
        resume: { time: 0, ...previous.resume, paused: true },
      };
    });
  }, []);

  return (
    <SelectedVideoContext.Provider
      value={{
        videoRef,
        selectedVideo: selection.video,
        linkedScreenshot: selection.screenshot ?? null,
        playlist: selection.playlist,
        resumePlayback: selection.resume,
        previousVideoId: selection.previous?.video?.id,
        setSelectedVideo,
        openLinkedMedia,
        goBack,
      }}
    >
      {children}
    </SelectedVideoContext.Provider>
  );
};

export const useSelectedVideo = () => {
  const context = useContext(SelectedVideoContext);
  if (!context) {
    throw new Error('useSelectedVideo must be used within a SelectedVideoProvider');
  }
  return context;
};
