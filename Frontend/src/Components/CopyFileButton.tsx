import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide';
import { MorphIcon } from 'morphicons/react';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';

interface CopyFileButtonProps {
  filePath: string;
  className?: string;
  copied?: boolean;
}

export default function CopyFileButton({
  filePath,
  className = '',
  copied = false,
}: CopyFileButtonProps) {
  const [fileCopied, setFileCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimer.current), []);

  const copy = () => {
    sendMessageToBackend('CopyFileToClipboard', { FilePath: filePath });
    setFileCopied(true);
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setFileCopied(false), 1500);
  };

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      className={`h-10 hover:text-accent ${className}`}
      onClick={copy}
    >
      <MorphIcon icon={fileCopied || copied ? Check : Copy} size={20} spring="snappy" />
      <span>Copy</span>
    </Button>
  );
}
