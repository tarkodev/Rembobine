import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useCompression } from '../Context/CompressionContext';
import { useContentMigration } from '../Context/ContentMigrationContext';
import { useWebSocketContext } from '../Context/WebSocketContext';
import type { Content, Screenshot } from '../Models/types';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';

export default function DeleteMediaButton({ media }: { media: Content | Screenshot }) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const { isConnected } = useWebSocketContext();
  const { isCompressing } = useCompression();
  const { getContentMigrationStatus } = useContentMigration();
  const videoId = 'id' in media ? media.id : undefined;
  const { filePath } = media;
  const available =
    isConnected &&
    (videoId === undefined ||
      (!isCompressing(filePath) && getContentMigrationStatus(videoId) === null));

  useEffect(() => {
    if (!available) setStage('idle');
  }, [available]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const { method, content } = (event as CustomEvent).detail;
      if (
        (method === 'DeleteContentFailed' && videoId !== undefined && content.id === videoId) ||
        (method === 'DeleteScreenshotFailed' &&
          videoId === undefined &&
          content.filePath === filePath)
      )
        setStage('idle');
    };
    window.addEventListener('websocket-message', onMessage);
    return () => window.removeEventListener('websocket-message', onMessage);
  }, [videoId, filePath]);

  return (
    <Button
      type="button"
      data-player-button
      size="sm"
      variant={stage === 'confirm' ? 'danger' : 'primary'}
      className="h-10 min-w-24 hover:text-error"
      disabled={!available || stage === 'deleting'}
      aria-busy={stage === 'deleting'}
      onBlur={() => setStage((current) => (current === 'confirm' ? 'idle' : current))}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && stage === 'confirm') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.blur();
        }
        if (event.repeat && event.key === 'Enter') event.preventDefault();
      }}
      onClick={() => {
        if (stage === 'idle') setStage('confirm');
        if (stage === 'confirm') {
          setStage('deleting');
          if (videoId !== undefined) sendMessageToBackend('DeleteContent', { Id: videoId });
          else sendMessageToBackend('DeleteScreenshot', { FilePath: filePath });
        }
      }}
    >
      <Trash2 className="h-5 w-5" />
      {stage === 'idle' ? 'Delete' : stage === 'confirm' ? 'Confirm' : 'Deleting…'}
    </Button>
  );
}
