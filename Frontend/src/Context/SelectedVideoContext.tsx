import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import type { Content, Screenshot } from '../Models/types';

export type LinkedMedia =
  { type: 'video'; video: Content } | { type: 'screenshot'; screenshot: Screenshot };

export interface PlaybackPosition {
  time: number;
  paused: boolean;
}

interface VideoSelection {
  video: Content | null;
  playlist: string[];
  screenshot?: Screenshot;
  resume?: PlaybackPosition;
  previous?: VideoSelection;
}

interface SelectedVideoContextProps {
  selectedVideo: Content | null;
  linkedScreenshot: Screenshot | null;
  // Ids of the list the video was opened from, for previous/next navigation
  playlist: string[];
  resumePlayback?: PlaybackPosition;
  setSelectedVideo: (video: Content | null, playlist?: string[]) => void;
  previousVideoId?: string;
  openLinkedMedia: (media: LinkedMedia, playback?: PlaybackPosition, startTime?: number) => void;
  goBack: () => void;
}

const SelectedVideoContext = createContext<SelectedVideoContextProps | undefined>(undefined);

export const SelectedVideoProvider = ({ children }: { children: ReactNode }) => {
  const [selection, setSelection] = useState<VideoSelection>({ video: null, playlist: [] });

  const setSelectedVideo = useCallback((video: Content | null, list?: string[]) => {
    setSelection((previous) => ({
      video,
      playlist: video ? (list ?? previous.playlist) : [],
    }));
  }, []);

  const openLinkedMedia = useCallback(
    (media: LinkedMedia, playback?: PlaybackPosition, startTime?: number) => {
      setSelection((current) => ({
        video: media.type === 'video' ? media.video : null,
        screenshot: media.type === 'screenshot' ? media.screenshot : undefined,
        playlist: [],
        resume:
          startTime === undefined
            ? undefined
            : { time: startTime, paused: playback?.paused ?? true },
        previous: playback ? { ...current, resume: playback } : current,
      }));
    },
    [],
  );

  const goBack = useCallback(() => {
    setSelection((current) => current.previous ?? { video: null, playlist: [] });
  }, []);

  return (
    <SelectedVideoContext.Provider
      value={{
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
