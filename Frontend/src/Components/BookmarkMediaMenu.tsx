import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { consumeEscape } from '../Utils/KeyboardUtils';
import { ArrowUpRight } from 'lucide-react';
import Button from './Button';

interface BookmarkMediaMenuProps {
  trigger: HTMLElement;
  openLabel: string;
  canOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

export default function BookmarkMediaMenu({
  trigger,
  openLabel,
  canOpen,
  onOpen,
  onClose,
}: BookmarkMediaMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) onClose();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (!consumeEscape(event)) return;
      event.stopPropagation();
      onClose();
      trigger.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose, trigger]);

  const rect = trigger.getBoundingClientRect();
  const width = 200;
  return createPortal(
    <div
      ref={menuRef}
      role="group"
      aria-label="Bookmark actions"
      data-bookmark-control
      data-bookmark-popup
      className="fixed z-[80] rounded-lg border border-base-400 bg-base-300 p-1 text-sm shadow-xl"
      style={{
        width,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
        ...(rect.top >= 104
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      }}
    >
      <Button
        variant="menu"
        size="sm"
        onClick={onOpen}
        disabled={!canOpen}
        title={canOpen ? undefined : 'Saved file unavailable'}
        autoFocus={canOpen}
      >
        <ArrowUpRight size={16} />
        {openLabel}
      </Button>
    </div>,
    document.body,
  );
}
