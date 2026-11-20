import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Screenshot } from '../Models/types';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';

interface RenameScreenshotModalProps {
  screenshot: Screenshot;
  onClose: () => void;
}

export default function RenameScreenshotModal({ screenshot, onClose }: RenameScreenshotModalProps) {
  const fileStem = screenshot.fileName.replace(/\.[^.]+$/, '');
  const [title, setTitle] = useState(fileStem);
  const inputRef = useRef<HTMLInputElement>(null);
  const newTitle = title.trim();

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newTitle) return;
    if (newTitle !== fileStem) {
      sendMessageToBackend('RenameScreenshot', { FilePath: screenshot.filePath, Title: newTitle });
    }
    onClose();
  };

  return (
    <form className="space-y-4" onSubmit={submit}>
      <h2 className="text-lg font-semibold">Rename screenshot</h2>
      <label className="block space-y-1.5">
        <span className="text-sm">File name</span>
        <input
          ref={inputRef}
          className="input w-full bg-base-200"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!newTitle}>
          Rename
        </Button>
      </div>
    </form>
  );
}
