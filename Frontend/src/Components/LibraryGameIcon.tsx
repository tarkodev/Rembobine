import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';

export default function LibraryGameIcon({ src, name }: { src?: string | null; name?: string }) {
  const [failedSrc, setFailedSrc] = useState<string>();
  return (
    <span
      title={name}
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={!name}
      className="inline-flex size-5 shrink-0 items-center justify-center"
    >
      {src && src !== failedSrc ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full rounded object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <Gamepad2 size={18} className="text-base-content/60" />
      )}
    </span>
  );
}
