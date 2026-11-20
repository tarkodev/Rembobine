import { createContext, useContext, useState, ReactNode } from 'react';
import { Segment } from '../Models/types';

interface SegmentsContextType {
  segments: Segment[];
  activeSegmentId: number | null;
  setActiveSegmentId: (id: number | null) => void;
  addSegment: (seg: Segment) => void;
  updateSegment: (seg: Segment) => void;
  setSegmentThumbnail: (id: number, thumbnailDataUrl?: string) => void;
  updateSegmentsArray: (seg: Segment[]) => void;
  removeSegment: (id: number) => void;
  clearSegmentsForVideo: (fileName: string) => void;
  clearAllSegments: () => void;
}

const SegmentsContext = createContext<SegmentsContextType | undefined>(undefined);

export const SegmentsProvider = ({ children }: { children: ReactNode }) => {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);

  const addSegment = (seg: Segment) => {
    setSegments((prev) => [...prev, seg]);
    setActiveSegmentId(seg.id);
  };

  const updateSegment = (updatedSeg: Segment) => {
    setSegments((prev) => prev.map((seg) => (seg.id === updatedSeg.id ? updatedSeg : seg)));
  };

  const setSegmentThumbnail = (id: number, thumbnailDataUrl?: string) => {
    setSegments((prev) =>
      prev.map((seg) =>
        seg.id === id
          ? { ...seg, thumbnailDataUrl: thumbnailDataUrl ?? seg.thumbnailDataUrl, isLoading: false }
          : seg,
      ),
    );
  };

  const updateSegmentsArray = (newSegments: Segment[]) => {
    setSegments(newSegments);
  };

  const removeSegment = (id: number) => {
    setSegments((prev) => prev.filter((seg) => seg.id !== id));
    setActiveSegmentId((active) => (active === id ? null : active));
  };

  const clearSegmentsForVideo = (fileName: string) => {
    setSegments((prev) => prev.filter((seg) => seg.fileName !== fileName));
  };

  const clearAllSegments = () => {
    setSegments(() => []);
    setActiveSegmentId(null);
  };

  return (
    <SegmentsContext.Provider
      value={{
        segments,
        activeSegmentId,
        setActiveSegmentId,
        addSegment,
        updateSegment,
        setSegmentThumbnail,
        removeSegment,
        clearSegmentsForVideo,
        updateSegmentsArray,
        clearAllSegments,
      }}
    >
      {children}
    </SegmentsContext.Provider>
  );
};

export const useSegments = (): SegmentsContextType => {
  const context = useContext(SegmentsContext);
  if (!context) {
    throw new Error('useSegments must be used within a SegmentsProvider');
  }
  return context;
};
