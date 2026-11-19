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
  const [errored, setErrored] = useState(false);
  const { airplaneMode } = useSettings();
  // Prefer the catalog CDN icon; fall back to the exe-extracted base64 icon for custom games.
  const src =
    iconId && !airplaneMode
      ? `https://segra.tv/api/games/icon/${iconId}`
      : customIcon
        ? `data:image/png;base64,${customIcon}`
        : null;
  const showImage = !!src && !errored;
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
          onError={() => setErrored(true)}
        />
      ) : (
        <Gamepad2 size={Math.round(size * 0.5)} className="text-base-content opacity-50" />
      )}
    </div>
  );
}
