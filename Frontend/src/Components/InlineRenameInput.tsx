import { useLayoutEffect, useRef } from 'react';

interface InlineRenameInputProps {
  initialValue: string;
  placeholder: string;
  label: string;
  className?: string;
  onSave: (title: string) => void;
  onClose: () => void;
}

export default function InlineRenameInput({
  initialValue,
  placeholder,
  label,
  className = 'card-title !block truncate bg-transparent outline-none w-full min-w-0',
  onSave,
  onClose,
}: InlineRenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const title = inputRef.current!.value.trim();
    if (save && title !== initialValue) onSave(title);
    onClose();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      aria-label={label}
      className={className}
      defaultValue={initialValue}
      placeholder={placeholder}
      onBlur={() => finish(true)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.preventDefault();
          finish(event.key === 'Enter');
        }
      }}
    />
  );
}
