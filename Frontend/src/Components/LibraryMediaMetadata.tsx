import LibraryGameIcon from './LibraryGameIcon';

interface LibraryMediaMetadataProps {
  game: string | null;
  gameIcon?: string | null;
  fileSize?: string;
  createdAt: string;
  showSeconds?: boolean;
}

export default function LibraryMediaMetadata({
  game,
  gameIcon,
  fileSize,
  createdAt,
  showSeconds,
}: LibraryMediaMetadataProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {game && game !== 'Unknown' && (
        <>
          <LibraryGameIcon src={gameIcon} name={game} />
          <span aria-hidden="true">•</span>
        </>
      )}
      {fileSize && (
        <>
          <span>{fileSize}</span>
          <span aria-hidden="true">•</span>
        </>
      )}
      <time dateTime={createdAt}>
        {new Date(createdAt).toLocaleString(undefined, {
          dateStyle: 'short',
          timeStyle: showSeconds ? 'medium' : 'short',
        })}
      </time>
    </span>
  );
}
