import { FileUp, FolderOpen } from 'lucide-react';
import { sendMessageToBackend } from '../Utils/MessageUtils';
import Button from './Button';
import { IMPORTED, type GameOption } from './ContentFilters';

interface LibraryFolderActionsProps {
  sectionId: string;
  filter?: GameOption;
  showImport?: boolean;
}

export default function LibraryFolderActions({
  sectionId,
  filter,
  showImport = true,
}: LibraryFolderActionsProps) {
  const imported = filter?.key === IMPORTED;
  return (
    <>
      <Button
        variant="primary"
        size="sm"
        className="no-animation h-8 gap-1"
        onClick={() =>
          sendMessageToBackend('OpenLibraryFolder', {
            sectionId,
            game: imported ? undefined : filter?.name,
            imported,
          })
        }
      >
        <FolderOpen size={16} />
        Open folder
      </Button>
      {showImport && (
        <Button
          variant="primary"
          size="sm"
          className="no-animation h-8 gap-1"
          onClick={() => sendMessageToBackend('ImportFile', { sectionId })}
        >
          <FileUp size={16} />
          Import
        </Button>
      )}
    </>
  );
}
