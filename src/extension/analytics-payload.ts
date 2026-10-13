// What analytics sends, as pure functions: the dates and flags, the buckets, the provider error class, the fixed list
// of count keys and the schemas every event passes before it is sent. Nothing here reads storage or the browser.
import { z } from 'zod';
import { ERROR_CODES } from '@src/browser-control';
import { allTools } from '@src/agent/tools';
import { REASONING_EFFORTS, rows } from '@src/llm/catalogue';
import type { ProviderKind } from '@src/llm/providers';
import type { AnalyticsState, SentEvent } from '@src/store/analytics';

export const PROVIDER_KINDS: readonly ProviderKind[] = [
  'anthropic',
  'openai',
  'gemini',
  'openai-compatible',
  'ollama',
  'lmstudio',
  'openrouter',
];
export const BROWSERS = ['chrome', 'edge', 'other'] as const;
export const LANGUAGES = ['en', 'zh_CN', 'zh_TW'] as const;
export const TOOL_NAMES: readonly string[] = allTools().map(t => t.name);
export const ROW_IDS: readonly string[] = [...rows.map(r => r.id), 'unknown'];

/** How a run ended: the run's status, with a finished run's outcome. */
export const ENDS = ['success', 'partial', 'failed', 'stopped', 'capped', 'interrupted'] as const;
export type End = (typeof ENDS)[number];
/** Why a run ended badly, when the loop knows. */
export const CAUSES = ['guard_errors', 'guard_no_effect', 'context', 'provider', 'cut'] as const;
export type Cause = (typeof CAUSES)[number];
export const PROVIDER_ERRORS = ['auth', 'rate_limit', 'server', 'network', 'overflow', 'bad_request', 'other'] as const;
export type ProviderErrorClass = (typeof PROVIDER_ERRORS)[number];
export const TURN_BUCKETS = ['1-5', '6-15', '16-40', '41-100', '100+'] as const;
export const DURATION_BUCKETS = ['<30s', '30s-2m', '2-5m', '5-15m', '15m+'] as const;
export const TOKEN_BUCKETS = ['<50k', '50k-200k', '200k-1m', '1m+'] as const;
export const HANDOVERS = ['pay', 'grant', 'secret', 'prompt'] as const;
export const FEATURES = [
  'image',
  'text_file',
  'upload',
  'file_saved',
  'shortcut',
  'voice',
  'context_menu',
  'export',
  'retry',
  'edit',
  'stop',
  'concurrent',
] as const;
export type Feature = (typeof FEATURES)[number];

/**
 * Where events go, fixed by the build: the autorun build sends to the fixture server, even with a key set; a production
 * build with a key and a host to PostHog; any other build nowhere.
 */
export function destinationOf(env: {
  WXT_AUTORUN_URL?: string;
  PROD?: boolean;
  VITE_POSTHOG_API_KEY?: string;
  VITE_POSTHOG_HOST?: string;
}): { url: string; key: string } | null {
  if (env.WXT_AUTORUN_URL) return { url: `${env.WXT_AUTORUN_URL}/__posthog/i/v0/e/`, key: 'autorun' };
  if (env.PROD && env.VITE_POSTHOG_API_KEY && env.VITE_POSTHOG_HOST)
    return { url: `${env.VITE_POSTHOG_HOST.replace(/\/+$/, '')}/i/v0/e/`, key: env.VITE_POSTHOG_API_KEY };
  return null;
}

// --- Dates, in UTC -------------------------------------------------------------------------------------------------

export function dayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The ISO week, as `2026-W41`: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const dateOfDay = (day: string) => new Date(`${day}T00:00:00Z`);

// --- Buckets and classes -------------------------------------------------------------------------------------------

export function turnsBucket(turns: number): (typeof TURN_BUCKETS)[number] {
  if (turns <= 5) return '1-5';
  if (turns <= 15) return '6-15';
  if (turns <= 40) return '16-40';
  if (turns <= 100) return '41-100';
  return '100+';
}

export function durationBucket(ms: number): (typeof DURATION_BUCKETS)[number] {
  const s = ms / 1000;
  if (s < 30) return '<30s';
  if (s < 120) return '30s-2m';
  if (s < 300) return '2-5m';
  if (s < 900) return '5-15m';
  return '15m+';
}

export function tokensBucket(tokens: number): (typeof TOKEN_BUCKETS)[number] {
  if (tokens < 50_000) return '<50k';
  if (tokens < 200_000) return '50k-200k';
  if (tokens < 1_000_000) return '200k-1m';
  return '1m+';
}

/** A provider's failure, from its status code and the overflow detection, never from its message. */
export function providerErrorClass(error: {
  status?: number;
  overflow?: boolean;
  network?: boolean;
}): ProviderErrorClass {
  if (error.overflow) return 'overflow';
  const status = error.status;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status !== undefined && status >= 500) return 'server';
  if (status !== undefined && status >= 400) return 'bad_request';
  if (status === undefined && error.network) return 'network';
  return 'other';
}

/** How a run ended, as one of `ENDS`. */
export function endOf(status: string, outcome?: string): End {
  if (status === 'done') return outcome === 'partial' || outcome === 'failed' ? outcome : 'success';
  if (status === 'stopped' || status === 'capped' || status === 'interrupted') return status;
  return 'failed';
}

// --- Count keys ----------------------------------------------------------------------------------------------------

const each = (prefix: string, values: readonly string[]) => values.map(v => `${prefix}.${v}`);

/** Every key a day's counts may hold. Anything else is refused by the schema. */
export const COUNT_KEYS: ReadonlySet<string> = new Set([
  'runs.started',
  'runs.resumed',
  'runs.continued',
  ...each('runs.ended', ENDS),
  ...each('turns', TURN_BUCKETS),
  ...each('duration', DURATION_BUCKETS),
  ...each('tokens', TOKEN_BUCKETS),
  ...each('stop', CAUSES),
  ...each('tool', TOOL_NAMES),
  ...each('tool_error', TOOL_NAMES),
  ...each('layer_error', ERROR_CODES),
  ...PROVIDER_KINDS.flatMap(kind => each(`provider_error.${kind}`, PROVIDER_ERRORS)),
  ...ROW_IDS.flatMap(row => each(`model.${row}`, ENDS)),
  ...each('provider', PROVIDER_KINDS),
  ...each('effort', REASONING_EFFORTS),
  'vision',
  'mode.ask',
  'mode.auto',
  'write_card.shown',
  'write_card.approved',
  'write_card.declined',
  ...each('handover', HANDOVERS),
  ...each('site_rules', ['allow', 'ask', 'block']),
  // Every compaction, and those the user asked for with /compact; the automatic ones are the difference.
  'compaction.all',
  'compaction.manual',
  'compaction.failed',
  ...each('feature', FEATURES),
  ...each('setup.providers', PROVIDER_KINDS),
  'setup.default_model.local',
  'setup.default_model.cloud',
  'setup.voice_model',
  'setup.custom_instructions',
]);

// --- Payloads ------------------------------------------------------------------------------------------------------

export interface Environment {
  version: string;
  browser: (typeof BROWSERS)[number];
  ui_language: (typeof LANGUAGES)[number];
}

/** The browser, from `navigator.userAgentData`'s brands, found by name. */
export function browserOf(brands: ReadonlyArray<{ brand: string }> | undefined): Environment['browser'] {
  if (brands?.some(b => b.brand === 'Microsoft Edge')) return 'edge';
  if (brands?.some(b => b.brand === 'Google Chrome')) return 'chrome';
  return 'other';
}

/** The ping's properties for a ping sent on `now`. */
export function pingProperties(
  state: AnalyticsState,
  now: Date,
  env: Environment,
  hasModel: boolean,
): Record<string, unknown> {
  const last = state.lastPing ? dateOfDay(state.lastPing) : undefined;
  return {
    ...env,
    install_week: state.installWeek,
    new_install: !!state.newInstall,
    first_this_week: !last || isoWeek(last) !== isoWeek(now),
    first_this_month: !last || monthOf(last) !== monthOf(now),
    ran_task: state.ranTaskOn === dayOf(now),
    has_model: hasModel,
  };
}

/** The noon of a UTC day, as the timestamp of that day's counts. */
export function noonOf(day: string): string {
  return `${day}T12:00:00.000Z`;
}

/** An event as it goes to the capture endpoint: personless, and with no location. */
export function event(name: string, properties: Record<string, unknown>, timestamp: string, id: string): SentEvent {
  return {
    event: name,
    distinct_id: id,
    timestamp,
    properties: { ...properties, $process_person_profile: false, $geoip_disable: true },
  };
}

// --- Schemas -------------------------------------------------------------------------------------------------------

const version = z.string().regex(/^\d+(\.\d+){0,3}$/);
const environment = {
  version,
  browser: z.enum(BROWSERS),
  ui_language: z.enum(LANGUAGES),
};
const envelope = {
  $process_person_profile: z.literal(false),
  $geoip_disable: z.literal(true),
};

const activeDay = z
  .object({
    ...environment,
    ...envelope,
    install_week: z.string().regex(/^(\d{4}-W\d{2}|v0\.2|unknown)$/),
    new_install: z.boolean(),
    first_this_week: z.boolean(),
    first_this_month: z.boolean(),
    ran_task: z.boolean(),
    has_model: z.boolean(),
  })
  .strict();

const usageDay = z
  .object({ ...environment, ...envelope, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
  .catchall(z.number().int().nonnegative())
  .superRefine((value, ctx) => {
    for (const key of Object.keys(value)) {
      if (key in environment || key in envelope || key === 'day') continue;
      if (!COUNT_KEYS.has(key)) ctx.addIssue({ code: 'custom', message: `unknown count ${key}` });
    }
  });

const SCHEMAS: Record<string, z.ZodType> = {
  active_day: activeDay,
  usage_day: usageDay,
};

/** Whether an event may be sent: a known event whose properties pass its schema. */
export function isValidEvent(body: SentEvent): boolean {
  const schema = SCHEMAS[body.event];
  return (
    !!schema &&
    typeof body.distinct_id === 'string' &&
    !Number.isNaN(Date.parse(body.timestamp)) &&
    schema.safeParse(body.properties).success
  );
}
