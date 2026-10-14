import { describe, expect, it } from 'vitest';
import {
  COUNT_KEYS,
  browserOf,
  dayOf,
  destinationOf,
  durationBucket,
  endOf,
  event,
  isValidEvent,
  isoWeek,
  noonOf,
  pingProperties,
  providerErrorClass,
  tokensBucket,
  turnsBucket,
} from '../analytics-payload';

const env = { version: '0.3.0', browser: 'chrome' as const, ui_language: 'en' as const };
const at = (iso: string) => new Date(iso);

describe('dates', () => {
  it('gives ISO weeks across year ends and week 53', () => {
    expect(isoWeek(at('2026-10-13T10:00:00Z'))).toBe('2026-W42');
    // 2027-01-01 is a Friday: it belongs to the last week of 2026, which is week 53.
    expect(isoWeek(at('2027-01-01T00:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(at('2027-01-04T00:00:00Z'))).toBe('2027-W01');
    // 2024-12-30 is a Monday in week 1 of 2025.
    expect(isoWeek(at('2024-12-30T00:00:00Z'))).toBe('2025-W01');
    expect(isoWeek(at('2020-12-31T23:59:59Z'))).toBe('2020-W53');
  });

  it('uses UTC days', () => {
    expect(dayOf(at('2026-10-13T23:59:59Z'))).toBe('2026-10-13');
    expect(noonOf('2026-10-12')).toBe('2026-10-12T12:00:00.000Z');
  });
});

describe('ping flags', () => {
  it('marks the first ping of a week and of a month', () => {
    const now = at('2026-10-13T09:00:00Z');
    expect(pingProperties({ installWeek: 'unknown' }, now, env, false)).toMatchObject({
      first_this_week: true,
      first_this_month: true,
      new_install: false,
      ran_task: false,
    });
    // The day before was Monday of the same week and month.
    expect(pingProperties({ installWeek: 'unknown', lastPing: '2026-10-12' }, now, env, true)).toMatchObject({
      first_this_week: false,
      first_this_month: false,
      has_model: true,
    });
    // Last ping on Sunday 2026-10-11: a new week, the same month.
    expect(pingProperties({ installWeek: 'unknown', lastPing: '2026-10-11' }, now, env, true)).toMatchObject({
      first_this_week: true,
      first_this_month: false,
    });
    // Across a year end in one ISO week: 2026-12-31 and 2027-01-01 are both in 2026-W53.
    expect(
      pingProperties({ installWeek: 'unknown', lastPing: '2026-12-31' }, at('2027-01-01T08:00:00Z'), env, true),
    ).toMatchObject({ first_this_week: false, first_this_month: true });
  });

  it('says a task ran today and a new install', () => {
    const now = at('2026-10-13T09:00:00Z');
    const p = pingProperties({ installWeek: '2026-W42', newInstall: true, ranTaskOn: '2026-10-13' }, now, env, true);
    expect(p).toMatchObject({ install_week: '2026-W42', new_install: true, ran_task: true });
  });
});

describe('buckets and classes', () => {
  it('puts values at the edges in the right bucket', () => {
    expect([0, 5, 6, 15, 16, 40, 41, 100, 101].map(turnsBucket)).toEqual([
      '1-5',
      '1-5',
      '6-15',
      '6-15',
      '16-40',
      '16-40',
      '41-100',
      '41-100',
      '100+',
    ]);
    expect([29_999, 30_000, 119_999, 120_000, 299_999, 300_000, 899_999, 900_000].map(durationBucket)).toEqual([
      '<30s',
      '30s-2m',
      '30s-2m',
      '2-5m',
      '2-5m',
      '5-15m',
      '5-15m',
      '15m+',
    ]);
    expect([49_999, 50_000, 199_999, 200_000, 999_999, 1_000_000].map(tokensBucket)).toEqual([
      '<50k',
      '50k-200k',
      '50k-200k',
      '200k-1m',
      '200k-1m',
      '1m+',
    ]);
  });

  it('classes provider errors by status, never by message', () => {
    expect(providerErrorClass({ status: 401 })).toBe('auth');
    expect(providerErrorClass({ status: 403 })).toBe('auth');
    expect(providerErrorClass({ status: 429 })).toBe('rate_limit');
    expect(providerErrorClass({ status: 503 })).toBe('server');
    expect(providerErrorClass({ status: 400 })).toBe('bad_request');
    expect(providerErrorClass({ status: 400, overflow: true })).toBe('overflow');
    expect(providerErrorClass({ network: true })).toBe('network');
    expect(providerErrorClass({})).toBe('other');
  });

  it('names how a run ended', () => {
    expect(endOf('done', 'success')).toBe('success');
    expect(endOf('done', 'partial')).toBe('partial');
    expect(endOf('failed', 'failed')).toBe('failed');
    expect(endOf('stopped')).toBe('stopped');
    expect(endOf('capped', 'partial')).toBe('capped');
  });

  it('finds the browser by name, never by position', () => {
    expect(browserOf([{ brand: 'Not_A Brand' }, { brand: 'Chromium' }, { brand: 'Microsoft Edge' }])).toBe('edge');
    expect(browserOf([{ brand: 'Google Chrome' }])).toBe('chrome');
    expect(browserOf(undefined)).toBe('other');
  });
});

describe('schemas', () => {
  const ping = (extra: Record<string, unknown> = {}) =>
    event(
      'active_day',
      { ...pingProperties({ installWeek: '2026-W42' }, at('2026-10-13T09:00:00Z'), env, true), ...extra },
      '2026-10-13T09:00:00.000Z',
      'id',
    );

  it('sends every event personless and without a location', () => {
    expect(ping().properties).toMatchObject({ $process_person_profile: false, $geoip_disable: true });
    expect(isValidEvent(ping())).toBe(true);
  });

  it('refuses a URL in a string field, an unknown field and an unknown event', () => {
    expect(isValidEvent(ping({ install_week: 'https://example.com' }))).toBe(false);
    expect(isValidEvent(ping({ version: 'https://example.com/x' }))).toBe(false);
    expect(isValidEvent(ping({ url: 'example.com' }))).toBe(false);
    expect(isValidEvent({ ...ping(), event: 'domain_visited' })).toBe(false);
    const noLocation = ping();
    delete (noLocation.properties as Record<string, unknown>).$geoip_disable;
    expect(isValidEvent(noLocation)).toBe(false);
  });

  it('allows only known counts in a day of usage', () => {
    const day = (counts: Record<string, unknown>) =>
      event('usage_day', { ...env, day: '2026-10-12', ...counts }, noonOf('2026-10-12'), 'id');
    expect(isValidEvent(day({ 'runs.started': 3, 'tool.click': 9, 'model.gpt-5.success': 1 }))).toBe(
      COUNT_KEYS.has('model.gpt-5.success'),
    );
    expect(isValidEvent(day({ 'runs.started': 3, 'layer_error.REF_UNKNOWN': 1 }))).toBe(true);
    // A model the catalogue does not know is never named.
    expect(isValidEvent(day({ 'model.my-private-model.success': 1 }))).toBe(false);
    expect(isValidEvent(day({ 'model.unknown.success': 1 }))).toBe(true);
    expect(isValidEvent(day({ 'runs.started': 'three' }))).toBe(false);
    expect(isValidEvent(day({ 'site.example.com': 1 }))).toBe(false);
  });

  it('gives exactly the expected JSON for a recorded day of counts', () => {
    const body = event(
      'usage_day',
      { ...env, day: '2026-10-12', 'runs.started': 2, 'runs.ended.success': 1, 'tool.click': 4 },
      noonOf('2026-10-12'),
      '00000000-0000-4000-8000-000000000000',
    );
    expect(body).toEqual({
      event: 'usage_day',
      distinct_id: '00000000-0000-4000-8000-000000000000',
      timestamp: '2026-10-12T12:00:00.000Z',
      properties: {
        version: '0.3.0',
        browser: 'chrome',
        ui_language: 'en',
        day: '2026-10-12',
        'runs.started': 2,
        'runs.ended.success': 1,
        'tool.click': 4,
        $process_person_profile: false,
        $geoip_disable: true,
      },
    });
    expect(isValidEvent(body)).toBe(true);
  });
});

describe('destination', () => {
  it('sends an autorun build to the fixture server, even with a key', () => {
    expect(
      destinationOf({
        WXT_AUTORUN_URL: 'http://localhost:8787',
        PROD: true,
        VITE_POSTHOG_API_KEY: 'phc_x',
        VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
      }),
    ).toEqual({ url: 'http://localhost:8787/__posthog/i/v0/e/', key: 'autorun' });
  });

  it('sends a production build with a key to PostHog, and any other build nowhere', () => {
    expect(
      destinationOf({ PROD: true, VITE_POSTHOG_API_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://us.i.posthog.com/' }),
    ).toEqual({
      url: 'https://us.i.posthog.com/i/v0/e/',
      key: 'phc_x',
    });
    expect(destinationOf({ PROD: true })).toBeNull();
    expect(
      destinationOf({ PROD: false, VITE_POSTHOG_API_KEY: 'phc_x', VITE_POSTHOG_HOST: 'https://us.i.posthog.com' }),
    ).toBeNull();
  });
});
