import { ArrowLeft } from 'lucide-react';
import { openFileLocation } from '../Utils/FileUtils';
import Button from './Button';
import LibraryGameIcon from './LibraryGameIcon';

interface MediaInfoBarProps {
  createdAt: string;
  fileSize: string;
  filePath: string;
  game?: string;
  gameIcon?: string | null;
  onBack: () => void;
}

export default function MediaInfoBar({
  createdAt,
  fileSize,
  filePath,
  game,
  gameIcon,
  onBack,
}: MediaInfoBarProps) {
  const created = new Date(createdAt);
  const isValidDate = !isNaN(created.getTime());
  const locale = Intl.DateTimeFormat().resolvedOptions().locale?.toLowerCase() || '';
  const isUS = locale.includes('-us');
  const createdDateStr = !isValidDate
    ? createdAt
    : isUS
      ? created.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })
      : `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(created.getDate()).padStart(2, '0')}`;

  const createdTimeStr = !isValidDate
    ? ''
    : created.toLocaleTimeString(isUS ? 'en-US' : undefined, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: isUS,
      });

  return (
    <div className="flex items-center gap-2 px-2 py-1 mb-2 text-xs leading-tight text-gray-300 border rounded-lg shrink-0 bg-base-300 border-base-400">
      <Button
        variant="ghost"
        size="xs"
        className="h-6 min-h-0 px-1"
        onClick={onBack}
        aria-label="Back"
      >
        <ArrowLeft className="w-4 h-4" />
      </Button>
      <div className="flex items-center gap-2 overflow-hidden">
        <span className="whitespace-nowrap">
          Created: {createdDateStr}
          {createdTimeStr ? ` ${createdTimeStr}` : ''}
        </span>
        <span>•</span>
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          Size:
          {game && game !== 'Unknown' && <LibraryGameIcon src={gameIcon} name={game} />}
          {fileSize}
        </span>
        <span>•</span>
        <span className="flex items-center gap-1 min-w-0">
          <span className="whitespace-nowrap">Location:</span>
          <button
            type="button"
            className="text-gray-300 cursor-pointer hover:underline hover:text-gray-200 truncate"
            onClick={() => openFileLocation(filePath)}
          >
            {filePath}
          </button>
        </span>
      </div>
    </div>
  );
}
