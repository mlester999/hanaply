import { describe, expect, it } from 'vitest';

import {
  count,
  country,
  dateOnly,
  duration,
  EMPTY_VALUE,
  interval,
  jobStatusTone,
  label,
  runStatusTone,
  score,
  signalEntries,
  sourceStatusTone,
  text,
  timestamp,
} from '../../apps/web/src/lib/admin-jobs-format.js';

/**
 * An operator surface must never invent a number or a date. Everything absent
 * renders as a dash, and every invalid input renders as the same dash rather
 * than as "Invalid Date" or NaN.
 */
describe('admin job formatting', () => {
  it('renders absent text and counts as a dash', () => {
    expect(text(null)).toBe(EMPTY_VALUE);
    expect(text(undefined)).toBe(EMPTY_VALUE);
    expect(text('   ')).toBe(EMPTY_VALUE);
    expect(text('Remotive')).toBe('Remotive');
    expect(count(null)).toBe(EMPTY_VALUE);
    expect(count(Number.NaN)).toBe(EMPTY_VALUE);
    expect(count(1234)).toBe('1,234');
    expect(count(0)).toBe('0');
  });

  it('renders an unparseable timestamp as a dash rather than Invalid Date', () => {
    expect(timestamp(null)).toBe(EMPTY_VALUE);
    expect(timestamp('not-a-date')).toBe(EMPTY_VALUE);
    expect(dateOnly(null)).toBe(EMPTY_VALUE);
    expect(dateOnly('not-a-date')).toBe(EMPTY_VALUE);
    expect(timestamp('2026-09-20T00:00:00.000Z')).not.toBe(EMPTY_VALUE);
  });

  it('renders durations in a readable unit', () => {
    expect(duration(null)).toBe(EMPTY_VALUE);
    expect(duration(-1)).toBe(EMPTY_VALUE);
    expect(duration(450)).toBe('450 ms');
    expect(duration(1500)).toBe('1.5 s');
    expect(duration(90_000)).toBe('1 m 30 s');
  });

  it('renders a scan interval in minutes, hours, or days', () => {
    expect(interval(0)).toBe(EMPTY_VALUE);
    expect(interval(45)).toBe('45 min');
    expect(interval(120)).toBe('2 h');
    expect(interval(1440)).toBe('1 d');
    expect(interval(90)).toBe('90 min');
  });

  it('maps statuses onto badge tones', () => {
    expect(sourceStatusTone('active')).toBe('success');
    expect(sourceStatusTone('paused')).toBe('warning');
    expect(sourceStatusTone('disabled')).toBe('danger');
    expect(runStatusTone('succeeded')).toBe('success');
    expect(runStatusTone('partial')).toBe('warning');
    expect(runStatusTone('failed')).toBe('danger');
    expect(runStatusTone('running')).toBe('brand');
    expect(jobStatusTone('active')).toBe('success');
    expect(jobStatusTone('rejected')).toBe('danger');
    expect(jobStatusTone('expired')).toBe('danger');
    expect(jobStatusTone('stale')).toBe('warning');
  });

  it('turns deduplication signals into a sorted key and value list', () => {
    const entries = signalEntries({
      titleMatch: true,
      similarity: 0.93,
      note: null,
      nested: { a: 1 },
    });
    expect(entries.map((entry) => entry.key)).toEqual([
      'nested',
      'note',
      'similarity',
      'titleMatch',
    ]);
    expect(entries.find((entry) => entry.key === 'titleMatch')?.value).toBe('true');
    expect(entries.find((entry) => entry.key === 'similarity')?.value).toBe('0.93');
    expect(entries.find((entry) => entry.key === 'note')?.value).toBe(EMPTY_VALUE);
    expect(entries.find((entry) => entry.key === 'nested')?.value).toBe('{"a":1}');
    expect(signalEntries({})).toEqual([]);
  });

  it('renders a similarity score with fixed precision', () => {
    expect(score(0.93456)).toBe('0.935');
    expect(score(Number.NaN)).toBe(EMPTY_VALUE);
  });

  it('renders a country code in upper case or as a dash', () => {
    expect(country('ph')).toBe('PH');
    expect(country(null)).toBe(EMPTY_VALUE);
  });

  it('turns an enum value into readable words', () => {
    expect(label('kept_separate')).toBe('kept separate');
    expect(label('job_source.state_changed')).toBe('job source state changed');
  });
});
