import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { useSettings } from '../Context/SettingsContext';

// Square game icon from the CDN, with a graceful fallback when there's no icon (custom games)
// or the image fails to load.
export default function GameIcon({
  iconId,
  customIcon,
  name,
  size = 40,
}: {
  iconId?: string | null;
  customIcon?: string | null;
  name: string;
  size?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const { loadGameArtwork } = useSettings();
  // Prefer the catalog CDN icon; fall back to the exe-extracted base64 icon for custom games.
  const src =
    iconId && loadGameArtwork
      ? `https://segra.tv/api/games/icon/${iconId}`
      : customIcon
        ? `data:image/png;base64,${customIcon}`
        : null;
  const showImage = !!src && src !== failedSrc;
  return (
    <div
      className="rounded-md bg-base-200 flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {showImage ? (
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : (
        <Gamepad2 size={Math.round(size * 0.5)} className="text-base-content opacity-50" />
      )}
    </div>
  );
}
