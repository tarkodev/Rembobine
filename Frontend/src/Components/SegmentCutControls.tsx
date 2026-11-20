import { Play, SquarePlus, X } from 'lucide-react';
import { formatTimecode } from '../Utils/NumberUtils';
import Button from './Button';

export type CutEdge = 'start' | 'end';

interface Props {
  start?: number;
  end?: number;
  cursor: number;
  duration: number;
  ready: boolean;
  pending: boolean;
  hint: boolean;
  onMark: (edge: CutEdge) => void;
  onPreview: () => void;
  onNew: () => void;
  onCancel: () => void;
}

export default function SegmentCutControls({
  start,
  end,
  cursor,
  duration,
  ready,
  pending,
  hint,
  onMark,
  onPreview,
  onNew,
  onCancel,
}: Props) {
  const complete = start !== undefined && end !== undefined;
  const renderBound = (edge: CutEdge, label: string, value?: number) => {
    const valid = edge === 'start' ? cursor < (end ?? duration) : cursor > (start ?? 0);
    return (
      <Button
        size="sm"
        data-player-button
        disabled={!ready || !valid}
        title={
          valid
            ? label
            : edge === 'start'
              ? 'Choose a time before the end'
              : 'Choose a time after the start'
        }
        onClick={() => onMark(edge)}
        className="gap-2"
      >
        {label}
        <span className="font-mono text-xs text-accent tabular-nums">
          {value === undefined ? '—' : formatTimecode(value)}
        </span>
      </Button>
    );
  };

  return (
    <div
      role="group"
      aria-label="Segment boundaries"
      className={`flex flex-wrap items-center gap-1.5 mt-auto py-1 shrink-0 ${hint ? 'segment-hint-flash' : ''}`}
    >
      {renderBound('start', 'Set start here', start)}
      {renderBound('end', 'Set end here', end)}
      {complete && (
        <>
          <Button size="sm" data-player-button disabled={!ready} onClick={onPreview}>
            <Play size={14} /> Play segment
            <span className="font-mono text-xs tabular-nums">{formatTimecode(end - start)}</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-player-button
            disabled={!ready || cursor >= duration}
            onClick={onNew}
            title="Start another segment at the playhead"
          >
            <SquarePlus size={14} /> New segment
          </Button>
        </>
      )}
      {pending && (
        <Button
          size="sm"
          variant="ghost"
          data-player-button
          onClick={onCancel}
          title="Discard the unfinished segment"
        >
          <X size={14} /> Cancel
        </Button>
      )}
    </div>
  );
}
