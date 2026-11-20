// Parses a numeric input value into an integer within [min, max].
// Empty or non-numeric input yields the fallback; a typed 0 is kept.
export function clampInt(value: string, min: number, max: number, fallback: number): number {
  const parsed = value.trim() === '' ? NaN : Number(value);
  const n = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.min(max, Math.max(min, n));
}

// .NET TimeSpan uses [days.]HH:MM:SS[.fraction] for durations and bookmark positions.
export function timeStringToSeconds(timeStr: string): number {
  const [dayHours, minutes, seconds] = timeStr.split(':');
  const [days, hours] = dayHours.includes('.')
    ? dayHours.split('.').map(Number)
    : [0, Number(dayHours)];
  return ((days * 24 + hours) * 60 + Number(minutes)) * 60 + Number(seconds);
}

export function formatTime(time: number): string {
  const totalSeconds = Math.max(0, Math.floor(time));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutes}:${seconds}` : `${minutes}:${seconds}`;
}

export function formatTimecode(seconds: number): string {
  const totalMs = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 1000)) : 0;
  const hours = Math.floor(totalMs / 3600000);
  const minutes = String(Math.floor(totalMs / 60000) % 60).padStart(2, '0');
  const secs = String(Math.floor(totalMs / 1000) % 60).padStart(2, '0');
  const ms = String(totalMs % 1000).padStart(3, '0');
  return `${hours > 0 ? `${String(hours).padStart(2, '0')}:` : ''}${minutes}:${secs}.${ms}`;
}
