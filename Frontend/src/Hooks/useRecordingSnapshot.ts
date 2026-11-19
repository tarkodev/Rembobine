import { useEffect, useRef, useState } from 'react';
import type { Content } from '../Models/types';
import { sendMessageToBackend } from '../Utils/MessageUtils';

let nextRequestId = 0;

// Only the viewer that requested the snapshot should navigate when it is ready.
export function useRecordingSnapshot() {
  const pending = useRef<{ id: number; onReady: (session: Content) => void } | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const handleMessage = (event: CustomEvent) => {
      const { method, content } = event.detail;
      if (method !== 'RecordingSnapshotReady' && method !== 'RecordingSnapshotFailed') return;
      const request = pending.current;
      if (!request || request.id !== content.requestId) return;
      pending.current = null;
      setOpening(false);
      if (method === 'RecordingSnapshotReady') request.onReady(content.session);
    };
    window.addEventListener('websocket-message', handleMessage as EventListener);
    return () => {
      window.removeEventListener('websocket-message', handleMessage as EventListener);
      pending.current = null;
    };
  }, []);

  function openSnapshot(
    filePath: string,
    onReady: (session: Content) => void,
    bookmarkTime?: number,
  ) {
    if (pending.current) return;
    const requestId = ++nextRequestId;
    pending.current = { id: requestId, onReady };
    setOpening(true);
    sendMessageToBackend('OpenRecordingSnapshot', { filePath, requestId, bookmarkTime });
  }

  return { opening, openSnapshot };
}
