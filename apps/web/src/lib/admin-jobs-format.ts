import type { BadgeTone } from '@hanaply/ui';

/**
 * Operators read these surfaces quickly and act on what they see, so a missing
 * value is always rendered as a dash or an empty state. A guessed number would
 * be indistinguishable from a measured one.
 */
export const EMPTY_VALUE = '—';

export function text(value: string | null | undefined): string {
  if (typeof value !== 'string') return EMPTY_VALUE;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : EMPTY_VALUE;
}

export function count(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-PH')
    : EMPTY_VALUE;
}

export function timestamp(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return EMPTY_VALUE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return parsed.toLocaleString('en-PH', { timeZone: 'Asia/Manila' });
}

export function dateOnly(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length === 0) return EMPTY_VALUE;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE;
  return parsed.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila' });
}

export function duration(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return EMPTY_VALUE;
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  const minutes = Math.floor(value / 60_000);
  const seconds = Math.round((value % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

export function interval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return EMPTY_VALUE;
  if (minutes < 60) return `${minutes} min`;
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

export function label(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' ');
}

export function sourceStatusTone(status: 'active' | 'paused' | 'disabled'): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'paused') return 'warning';
  return 'danger';
}

export function runStatusTone(status: 'running' | 'succeeded' | 'partial' | 'failed'): BadgeTone {
  if (status === 'succeeded') return 'success';
  if (status === 'partial') return 'warning';
  if (status === 'failed') return 'danger';
  return 'brand';
}

export function jobStatusTone(
  status: 'active' | 'stale' | 'expired' | 'closed' | 'duplicate' | 'rejected',
): BadgeTone {
  if (status === 'active') return 'success';
  if (status === 'stale' || status === 'closed') return 'warning';
  if (status === 'expired' || status === 'duplicate' || status === 'rejected') return 'danger';
  return 'neutral';
}

/**
 * Deduplication signals are an open JSON object written by the matching
 * pipeline. Only primitive leaves can be rendered honestly; anything nested is
 * shown as compact JSON so the operator still sees the real value.
 */
export function signalEntries(signals: Record<string, unknown>): readonly {
  key: string;
  value: string;
}[] {
  return Object.entries(signals)
    .map(([key, value]) => ({ key, value: signalValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function signalValue(value: unknown): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  if (typeof value === 'string') return text(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? EMPTY_VALUE;
  } catch {
    return EMPTY_VALUE;
  }
}

export function score(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : EMPTY_VALUE;
}

export function country(value: string | null): string {
  return value ? value.toUpperCase() : EMPTY_VALUE;
}
