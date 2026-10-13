// Analytics in the worker: the start-up step that applies the old version's choice, the daily counts and the triggers
// that send. It is the only code that writes the analytics keys. Nothing is sent before the
// start-up step has finished, and nothing at all from a build with no destination.
import { findRow, isCloudEndpoint } from '@src/llm/catalogue';
import type { ReasoningEffort } from '@src/llm/catalogue';
import {
  ANALYTICS_COUNTS_KEY,
  ANALYTICS_KEY,
  ANALYTICS_KEYS,
  ANALYTICS_QUEUE_KEY,
  DEFAULT_SETTINGS,
  UPGRADE_KEY,
  findModel,
  providersStorage,
  settingsStorage,
  siteRulesStorage,
} from '@src/store';
import type {
  AnalyticsState,
  ModelRef,
  PermissionMode,
  QueuedEvent,
  RunModel,
  RunRecord,
  SentEvent,
  Settings,
  UpgradeRecord,
} from '@src/store';
import { resolveLanguage } from '@src/ui/i18n';
import type { PanelCommand, PanelEventBody } from '@src/ui/protocol';
import {
  COUNT_KEYS,
  PROVIDER_KINDS,
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
} from './analytics-payload';
import type { Environment, Feature } from './analytics-payload';
import type { LoopEnd } from '@src/agent/loop';
import { NO_SUMMARY } from '@src/agent/compaction';
import { upgradeFromOldVersion } from './upgrade';

const MAX_TRIES = 3;
const KEEP_DAYS = 7;

const DESTINATION = destinationOf(import.meta.env);

const local = chrome.storage.local;

/** One read-modify-write at a time, so counts and the queue never lose a write. */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function settings(): Promise<Settings> {
  return (await settingsStorage.get()) ?? DEFAULT_SETTINGS;
}

// --- The start-up step ---------------------------------------------------------------------------------------------

let ready: Promise<boolean> | null = null;

/** For the checks: forget that the start-up step ran, as a new worker start would. */
export function restartAnalytics(): void {
  ready = null;
}

/**
 * Runs once per worker start, after the move from the old Nanobrowser: when the analytics state does not exist yet, it
 * is made, and an old version's "Help improve Nanobrowser" choice sets both switches. A failed move leaves the state
 * missing, so the step runs again later. True once the step has finished.
 */
export function analyticsReady(): Promise<boolean> {
  ready ??= startUp().then(
    () => true,
    error => {
      console.error('[analytics] start-up failed', error);
      ready = null;
      return false;
    },
  );
  return ready;
}

async function startUp(): Promise<void> {
  await upgradeFromOldVersion();
  await serial(async () => {
    const stored = await local.get([ANALYTICS_KEY, UPGRADE_KEY]);
    if (stored[ANALYTICS_KEY]) return;
    const record = stored[UPGRADE_KEY] as UpgradeRecord | undefined;
    if (typeof record?.analytics === 'boolean') {
      const on = record.analytics;
      await settingsStorage.set(s => ({ ...s, analyticsPing: on, analyticsStats: on }));
    }
    const state: AnalyticsState = { installWeek: record ? 'v0.2' : 'unknown' };
    await local.set({ [ANALYTICS_KEY]: state });
  });
}

/** A real install: this week is its install week, and its first ping says it is new. */
export async function recordInstall(now = new Date()): Promise<void> {
  if (!(await analyticsReady())) return;
  await serial(async () => {
    const state: AnalyticsState = { installWeek: isoWeek(now), newInstall: true };
    await local.set({ [ANALYTICS_KEY]: state });
  });
}

/**
 * Delete everything: the analytics state and counts go with the rest, the two switches stay as the user set them, and
 * the install week becomes unknown. `remove` deletes everything else, settings included.
 */
export async function deleteKeepingChoices(remove: () => Promise<void>): Promise<void> {
  await analyticsReady();
  await serial(async () => {
    const { analyticsPing, analyticsStats } = await settings();
    await remove();
    await local.remove(ANALYTICS_KEYS);
    // Written whole: the settings store's cache may still hold what was just deleted.
    await local.set({ 'nb.settings': { ...DEFAULT_SETTINGS, analyticsPing, analyticsStats } });
    const state: AnalyticsState = { installWeek: 'unknown' };
    await local.set({ [ANALYTICS_KEY]: state });
  });
}

// --- Counting ------------------------------------------------------------------------------------------------------

type Counts = Record<string, Record<string, number>>;

/** Adds to today's counts, or sets a value as of today with `set`. Nothing is counted while usage counts are off. */
export async function count(key: string, n = 1, mode: 'add' | 'set' = 'add', now = new Date()): Promise<void> {
  if (!COUNT_KEYS.has(key)) return;
  await serial(async () => {
    // Checked in turn with the other writes, so a count cannot land after turning the switch off cleared the counts.
    if (!(await settings()).analyticsStats) return;
    const counts = ((await local.get(ANALYTICS_COUNTS_KEY))[ANALYTICS_COUNTS_KEY] ?? {}) as Counts;
    const day = (counts[dayOf(now)] ??= {});
    day[key] = mode === 'set' ? n : (day[key] ?? 0) + n;
    await local.set({ [ANALYTICS_COUNTS_KEY]: counts });
  });
}

export function countFeature(feature: Feature): void {
  void count(`feature.${feature}`);
}

/** The write card each open prompt was, so its answer can be counted. */
const openCards = new Set<string>();

/** What the run manager emits to the panels, counted where it says something worth counting. */
export function observe(body: PanelEventBody): void {
  switch (body.type) {
    case 'tool_execution_end': {
      const { tool, status, result } = body.row;
      if (status === 'skipped') return;
      void count(`tool.${tool}`);
      if (status === 'failed') void count(`tool_error.${tool}`);
      const code = (result as { ok?: boolean; error?: { code?: string } } | undefined)?.error?.code;
      if (code) void count(`layer_error.${code}`);
      if (tool === 'upload' && status === 'done') countFeature('upload');
      return;
    }
    case 'message_end':
      if (body.entry.kind === 'download') countFeature('file_saved');
      if (body.entry.kind === 'notice' && body.entry.text === NO_SUMMARY) void count('compaction.failed');
      return;
    case 'prompt_open':
      if (body.prompt.kind === 'write-card') {
        openCards.add(body.prompt.id);
        void count('write_card.shown');
      }
      if (body.prompt.kind === 'handover') void count(`handover.${String(body.prompt.data.reason)}`);
      return;
    case 'prompt_closed':
      if (!openCards.delete(body.id)) return;
      if (body.outcome === 'approve' || body.outcome === 'approve-remember') void count('write_card.approved');
      else if (body.outcome === 'decline') void count('write_card.declined');
      return;
    case 'compacted':
      void count('compaction.all');
      return;
  }
}

/** A panel's command: the panel opening, and the features it uses. */
export function observeCommand(command: PanelCommand): void {
  switch (command.type) {
    case 'subscribe':
      noteActivity('panel');
      return;
    case 'send':
      if (command.attachments.some(a => a.mimeType.startsWith('image/'))) countFeature('image');
      if (command.attachments.some(a => !a.mimeType.startsWith('image/'))) countFeature('text_file');
      if (command.context.some(c => c.kind === 'selection')) countFeature('context_menu');
      if (command.shortcut) countFeature('shortcut');
      return;
    case 'compact':
      void count('compaction.manual');
      return;
    case 'export':
    case 'retry':
    case 'edit':
    case 'stop':
      countFeature(command.type);
      return;
    case 'continue':
      void count('runs.continued');
      return;
    case 'resume':
      void count('runs.resumed');
      return;
    case 'voice-used':
      countFeature('voice');
      return;
  }
}

/** A run's model, as the counts name it: its provider and the catalogue row it matched. */
export async function runModel(ref: ModelRef): Promise<RunModel | undefined> {
  const found = findModel(await providersStorage.get(), ref);
  if (!found) return undefined;
  const { kind, baseUrl } = found.provider;
  const row = findRow(kind, ref.model, undefined, isCloudEndpoint(kind, baseUrl));
  return { provider: kind, modelRow: row?.id ?? 'unknown' };
}

/** A run started: the counts of its model, effort and mode, and the setup as of today. */
export async function runStarted(
  model: RunModel,
  effort: ReasoningEffort,
  mode: PermissionMode,
  vision: boolean,
  concurrent: boolean,
): Promise<void> {
  if (!(await settings()).analyticsStats) return;
  void count(`provider.${model.provider}`);
  void count(`effort.${effort}`);
  void count(`mode.${mode}`);
  if (vision) void count('vision');
  if (concurrent) void count('feature.concurrent', 1, 'set');
  // The setup and the site rules, as of today.
  const s = await settings();
  const providers = await providersStorage.get();
  // Every kind and both flags are set, zero included, so one removed earlier today does not keep its old value.
  for (const kind of PROVIDER_KINDS)
    void count(`setup.providers.${kind}`, providers.filter(p => p.kind === kind).length, 'set');
  const def = findModel(providers, s.defaultModel);
  const isLocal = !!def && !isCloudEndpoint(def.provider.kind, def.provider.baseUrl);
  void count('setup.default_model.local', isLocal ? 1 : 0, 'set');
  void count('setup.default_model.cloud', def && !isLocal ? 1 : 0, 'set');
  void count('setup.voice_model', s.voiceModel ? 1 : 0, 'set');
  void count('setup.custom_instructions', s.customInstructions.trim() ? 1 : 0, 'set');
  const rules = await siteRulesStorage.get();
  for (const value of ['allow', 'ask', 'block'] as const) {
    void count(`site_rules.${value}`, Object.values(rules).filter(r => r.rule === value).length, 'set');
  }
}

/** A run ended: how, its size, why it ended badly, and its model's outcome. */
export function runEnded(record: RunRecord, end: Pick<LoopEnd, 'cause' | 'providerError'>): void {
  const how = endOf(record.status, record.outcome);
  void count(`runs.ended.${how}`);
  void count(`turns.${turnsBucket(record.turns)}`);
  void count(`duration.${durationBucket(Date.now() - Date.parse(record.startedAt))}`);
  void count(`tokens.${tokensBucket(record.usage.input)}`);
  if (end.cause) void count(`stop.${end.cause}`);
  if (record.model) {
    void count(`model.${record.model.modelRow}.${how}`);
    if (end.providerError)
      void count(`provider_error.${record.model.provider}.${providerErrorClass(end.providerError)}`);
  }
}

// --- Sending -------------------------------------------------------------------------------------------------------

async function environment(): Promise<Environment> {
  const brands = (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }).userAgentData
    ?.brands;
  return {
    version: chrome.runtime.getManifest().version,
    browser: browserOf(brands),
    ui_language: resolveLanguage((await settings()).uiLanguage),
  };
}

/** The panel opened, or a run started: the day's ping and the past days' counts go out, if they are on. */
export function noteActivity(kind: 'panel' | 'run'): void {
  void sendDue(kind).catch(error => console.error('[analytics] send failed', error));
}

/** What `noteActivity` does, awaited; the checks call it. */
export async function sendDue(kind: 'panel' | 'run', now = new Date()): Promise<void> {
  if (!(await analyticsReady())) return;
  const s = await settings();
  const env = await environment();
  await serial(async () => {
    const stored = await local.get([ANALYTICS_KEY, ANALYTICS_COUNTS_KEY, ANALYTICS_QUEUE_KEY]);
    const state = (stored[ANALYTICS_KEY] ?? { installWeek: 'unknown' }) as AnalyticsState;
    const counts = (stored[ANALYTICS_COUNTS_KEY] ?? {}) as Counts;
    const queue = (stored[ANALYTICS_QUEUE_KEY] ?? []) as QueuedEvent[];
    const today = dayOf(now);
    if (kind === 'run') state.ranTaskOn = today;
    if (s.analyticsPing && state.lastPing !== today) {
      const hasModel = !!s.defaultModel;
      queue.push({
        body: event('active_day', pingProperties(state, now, env, hasModel), now.toISOString(), uuid()),
        tries: 0,
      });
      state.lastPing = today;
      delete state.newInstall;
    }
    // Past days' counts, oldest first; days older than a week are dropped.
    const oldest = dayOf(new Date(now.getTime() - KEEP_DAYS * 86_400_000));
    for (const day of Object.keys(counts).sort()) {
      if (day === today) continue;
      if (s.analyticsStats && day >= oldest)
        queue.push({ body: event('usage_day', { ...env, day, ...counts[day] }, noonOf(day), uuid()), tries: 0 });
      delete counts[day];
    }
    await local.set({ [ANALYTICS_KEY]: state, [ANALYTICS_COUNTS_KEY]: counts, [ANALYTICS_QUEUE_KEY]: queue });
  });
  await sendQueue();
}

/** Sends what is queued, if a destination exists. A failed event stays for the next trigger, at most three tries. */
async function sendQueue(): Promise<void> {
  if (!DESTINATION) {
    await serial(() => local.remove(ANALYTICS_QUEUE_KEY));
    return;
  }
  await serial(async () => {
    const queue = ((await local.get(ANALYTICS_QUEUE_KEY))[ANALYTICS_QUEUE_KEY] ?? []) as QueuedEvent[];
    const left: QueuedEvent[] = [];
    for (const item of queue) {
      // A switch turned off since the event was queued, or while an earlier one was sending: it is dropped, not sent.
      const s = await settings();
      if (item.body.event === 'active_day' && !s.analyticsPing) continue;
      if (item.body.event === 'usage_day' && !s.analyticsStats) continue;
      // An event its schema refuses is dropped, never sent.
      if (!isValidEvent(item.body)) continue;
      if (await post(item.body)) continue;
      if (item.tries + 1 < MAX_TRIES) left.push({ ...item, tries: item.tries + 1 });
    }
    await local.set({ [ANALYTICS_QUEUE_KEY]: left });
  });
}

/** One event to the destination. */
async function post(body: SentEvent): Promise<boolean> {
  if (!DESTINATION) return false;
  try {
    const response = await fetch(DESTINATION.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: DESTINATION.key, ...body }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const uuid = () => crypto.randomUUID();

/** Turning a switch off stops it at once: what was counted and not yet sent is cleared. */
export function listenForSwitches(): void {
  settingsStorage.subscribe(() => {
    const s = settingsStorage.getSnapshot();
    if (!s) return;
    void serial(async () => {
      if (!s.analyticsStats) await local.remove(ANALYTICS_COUNTS_KEY);
      const queue = ((await local.get(ANALYTICS_QUEUE_KEY))[ANALYTICS_QUEUE_KEY] ?? []) as QueuedEvent[];
      const kept = queue.filter(
        q => (q.body.event !== 'active_day' || s.analyticsPing) && (q.body.event !== 'usage_day' || s.analyticsStats),
      );
      if (kept.length !== queue.length) await local.set({ [ANALYTICS_QUEUE_KEY]: kept });
    });
  });
}
