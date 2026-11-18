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
