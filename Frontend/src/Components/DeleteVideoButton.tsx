import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useCompression } from '../Context/CompressionContext';
import { useContentMigration } from '../Context/ContentMigrationContext';
import { useWebSocketContext } from '../Context/WebSocketContext';
import type { Content } from '../Models/types';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';

export default function DeleteVideoButton({ video }: { video: Content }) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'deleting'>('idle');
  const { isConnected } = useWebSocketContext();
  const { isCompressing } = useCompression();
  const { getContentMigrationStatus } = useContentMigration();
  const available =
    isConnected && !isCompressing(video.filePath) && getContentMigrationStatus(video.id) === null;

  useEffect(() => {
    if (!available) setStage('idle');
  }, [available]);

  useEffect(() => {
    const onMessage = (event: Event) => {
      const { method, content } = (event as CustomEvent).detail;
      if (method === 'DeleteContentFailed' && content.id === video.id) setStage('idle');
    };
    window.addEventListener('websocket-message', onMessage);
    return () => window.removeEventListener('websocket-message', onMessage);
  }, [video.id]);

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
        if (event.key === 'Escape') event.currentTarget.blur();
        if (event.repeat && event.key === 'Enter') event.preventDefault();
      }}
      onClick={() => {
        if (stage === 'idle') setStage('confirm');
        if (stage === 'confirm') {
          setStage('deleting');
          sendMessageToBackend('DeleteContent', { Id: video.id });
        }
      }}
    >
      <Trash2 className="h-5 w-5" />
      {stage === 'idle' ? 'Delete' : stage === 'confirm' ? 'Confirm' : 'Deleting…'}
    </Button>
  );
}
