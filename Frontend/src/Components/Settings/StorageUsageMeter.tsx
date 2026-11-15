import { AlertTriangle } from 'lucide-react';
import { ContentFolderUsage, Settings, State } from '../../Models/types';

const BYTES_PER_GB = 1024 ** 3;

const SEGMENTS = [
  { key: 'sessionsBytes', label: 'Sessions', color: '#3987e5' },
  { key: 'replayBuffersBytes', label: 'Buffers', color: '#d95926' },
  { key: 'clipsBytes', label: 'Clips', color: '#199e70' },
  { key: 'highlightsBytes', label: 'Highlights', color: '#c98500' },
  { key: 'otherBytes', label: 'Other', color: '#49515b' },
] as const;

export type StorageExclusions = Pick<
  Settings,
  'excludeReplayBufferFromStorageLimit' | 'excludeClipsFromStorageLimit'
>;

const isExcluded = (key: keyof ContentFolderUsage, exclusions: StorageExclusions) =>
  (exclusions.excludeReplayBufferFromStorageLimit && key === 'replayBuffersBytes') ||
  (exclusions.excludeClipsFromStorageLimit && (key === 'clipsBytes' || key === 'highlightsBytes'));

export const getCountedStorageGb = (usage: ContentFolderUsage, exclusions?: StorageExclusions) =>
  SEGMENTS.reduce(
    (total, { key }) => total + (exclusions && isExcluded(key, exclusions) ? 0 : usage[key]),
    0,
  ) / BYTES_PER_GB;

const formatGb = (value: number) => {
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

// "E:/Segra" -> "Drive E:". Linux paths have no letter, so they fall back to "Disk".
const driveLabel = (contentFolder: string) => {
  const match = /^([a-zA-Z]):/.exec(contentFolder.trim());
  return match ? `Drive ${match[1].toUpperCase()}:` : 'Disk';
};

interface StorageUsageMeterProps {
  usage: ContentFolderUsage;
  contentFolder: string;
  storageLimitGb: number;
  unlimited: boolean;
  exclusions: StorageExclusions;
  driveUsedGb: State['recordingDriveUsedGb'];
  driveFreeGb: State['recordingDriveFreeGb'];
}

export default function StorageUsageMeter({
  usage,
  contentFolder,
  storageLimitGb,
  unlimited,
  exclusions,
  driveUsedGb,
  driveFreeGb,
}: StorageUsageMeterProps) {
  const segments = SEGMENTS.map((segment) => ({
    ...segment,
    gb: usage[segment.key] / BYTES_PER_GB,
    excluded: !unlimited && isExcluded(segment.key, exclusions),
  })).filter((s) => s.gb >= 0.01);
  const usedGb = getCountedStorageGb(usage);
  const countedGb = unlimited ? usedGb : getCountedStorageGb(usage, exclusions);
  const barSegments = segments.filter((s) => !s.excluded);

  const isOverLimit = !unlimited && storageLimitGb > 0 && countedGb > storageLimitGb;
  const usedPercent = storageLimitGb > 0 ? (countedGb / storageLimitGb) * 100 : 0;

  // Without a limit, recordings can grow into whatever is free on the drive
  const freeGb = unlimited ? driveFreeGb : Math.max(0, storageLimitGb - countedGb);

  // Over the limit the bar is full, so segments are scaled against usage instead.
  const scaleGb = unlimited
    ? usedGb + (driveFreeGb ?? 0)
    : isOverLimit
      ? countedGb
      : storageLimitGb;

  // Without a limit there is nothing to measure against until the drive's free space is known
  const showBar = !unlimited || driveFreeGb !== null;

  const hasDriveSpace = driveUsedGb !== null && driveFreeGb !== null;
  const driveTotalGb = hasDriveSpace ? driveUsedGb + driveFreeGb : null;

  return (
    <div className="rounded-lg border border-base-400 bg-base-200 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium text-base-content">Storage Usage</span>
        <span className="flex items-center gap-2 text-sm tabular-nums text-base-content/60">
          <span>
            {unlimited
              ? `${formatGb(usedGb)} GB used`
              : `${formatGb(countedGb)} GB of ${formatGb(storageLimitGb)} GB limit`}
          </span>
          <span aria-hidden="true">·</span>
          <span className={`font-semibold ${isOverLimit ? 'text-error' : 'text-base-content/80'}`}>
            {isOverLimit && <AlertTriangle size={13} className="mr-1 inline-block align-[-2px]" />}
            {unlimited
              ? 'No limit'
              : `${Math.round(usedPercent)}%${isOverLimit ? ' over limit' : ''}`}
          </span>
        </span>
      </div>

      {showBar && (
        <div
          className="mt-3 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-base-400/35"
          role="img"
          aria-label={
            unlimited
              ? `${formatGb(usedGb)} GB used, no storage limit`
              : `${formatGb(countedGb)} GB used of a ${formatGb(storageLimitGb)} GB limit`
          }
        >
          {barSegments.map((s) => (
            <div
              key={s.key}
              className="h-full"
              style={{
                width: `${scaleGb > 0 ? (s.gb / scaleGb) * 100 : 0}%`,
                backgroundColor: s.color,
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {segments.map((s) => (
            <span key={s.key} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: s.color }}
              />
              <span className="text-base-content/80">{s.label}</span>
              <span className="tabular-nums text-base-content/50">
                {formatGb(s.gb)} GB{s.excluded ? ' (not counted)' : ''}
              </span>
            </span>
          ))}
        </div>
        {!isOverLimit && freeGb !== null && (
          <span className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-[2px] border border-base-400 bg-base-400/35" />
            <span className="text-base-content/80">
              {unlimited ? 'Free on drive' : 'Free in limit'}
            </span>
            <span className="tabular-nums text-base-content/50">{formatGb(freeGb)} GB</span>
          </span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-base-400/50 pt-3 text-xs tabular-nums text-base-content/50">
        <span>
          {hasDriveSpace && driveTotalGb !== null
            ? `${driveLabel(contentFolder)} ${formatGb(driveUsedGb)} GB used of ${formatGb(driveTotalGb)} GB`
            : 'Checking drive space...'}
        </span>
        {/* The legend already shows the free space without a limit */}
        {hasDriveSpace && !unlimited && <span>{formatGb(driveFreeGb)} GB free</span>}
      </div>
    </div>
  );
}
