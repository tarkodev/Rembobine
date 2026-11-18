import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Ellipsis, FolderOpen, PenLine, Trash2 } from 'lucide-react';
import { useModal } from '../Context/ModalContext';
import { useDeleteConfirmation } from '../Hooks/useDeleteConfirmation';
import type { Screenshot } from '../Models/types';
import { openFileLocation } from '../Utils/FileUtils';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';
import CopyFileButton from './CopyFileButton';
import DeleteMediaButton from './DeleteMediaButton';
import RenameScreenshotModal from './RenameScreenshotModal';

interface ScreenshotActionsProps {
  screenshot: Screenshot;
  inViewer?: boolean;
}

export default function ScreenshotActions({
  screenshot,
  inViewer = false,
}: ScreenshotActionsProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const { openModal, closeModal } = useModal();
  const confirmDelete = useDeleteConfirmation();

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!open || !menu || !trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const margin = 8;
    const maxLeft = window.innerWidth - menu.offsetWidth - margin;
    const maxTop = window.innerHeight - menu.offsetHeight - margin;
    const top =
      rect.bottom + gap <= maxTop ? rect.bottom + gap : rect.top - menu.offsetHeight - gap;
    menu.style.left = `${Math.max(margin, Math.min(maxLeft, rect.right - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(margin, Math.min(maxTop, top))}px`;
    menu.querySelector('button')?.focus({ preventScroll: true });

    const dismiss = () => setOpen(false);
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        !menu.contains(event.target) &&
        !trigger.contains(event.target)
      )
        dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
      trigger.focus({ preventScroll: true });
    };

    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape, true);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape, true);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open]);

  const runAction = (action: () => void) => {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    action();
  };

  const renameScreenshot = () =>
    openModal(<RenameScreenshotModal screenshot={screenshot} onClose={closeModal} />, {
      size: 'sm',
    });
  const showLocation = () => openFileLocation(screenshot.filePath);
  const deleteScreenshot = () =>
    confirmDelete({
      title: 'Delete screenshot?',
      description: screenshot.fileName,
      onConfirm: () => {
        sendMessageToBackend('DeleteScreenshot', { FilePath: screenshot.filePath });
      },
    });

  if (inViewer) {
    return (
      <>
        <CopyFileButton filePath={screenshot.filePath} />
        <Button size="sm" className="h-10 hover:text-accent" onClick={renameScreenshot}>
          <PenLine size={20} />
          Rename
        </Button>
        <Button size="sm" className="h-10 hover:text-accent" onClick={showLocation}>
          <FolderOpen size={20} />
          Open File Location
        </Button>
        <DeleteMediaButton media={screenshot} />
      </>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm btn-circle hover:bg-white/10 active:bg-white/10"
        aria-label="Screenshot actions"
        title="Screenshot actions"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Ellipsis size={24} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={menuRef}
            id={menuId}
            aria-label="Screenshot actions"
            className="menu fixed top-0 left-0 z-1000 w-52 rounded-box border border-base-400 bg-base-300 p-2 shadow-xl"
            onKeyDown={(event) => event.stopPropagation()}
          >
            <li>
              <Button
                variant="menu"
                onClick={() =>
                  runAction(() =>
                    sendMessageToBackend('CopyFileToClipboard', { FilePath: screenshot.filePath }),
                  )
                }
              >
                <Copy size={20} />
                Copy
              </Button>
            </li>
            <li>
              <Button variant="menu" onClick={() => runAction(renameScreenshot)}>
                <PenLine size={20} />
                Rename
              </Button>
            </li>
            <li>
              <Button variant="menu" onClick={() => runAction(showLocation)}>
                <FolderOpen size={20} />
                Open File Location
              </Button>
            </li>
            <li>
              <Button variant="menuDanger" onClick={() => runAction(deleteScreenshot)}>
                <Trash2 size={20} />
                Delete
              </Button>
            </li>
          </ul>,
          document.body,
        )}
    </>
  );
}
