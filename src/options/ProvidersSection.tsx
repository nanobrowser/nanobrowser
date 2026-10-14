// Settings → Providers: the default model and its reasoning effort, then voice input, whose voice model comes from an
// OpenAI or Gemini provider, then the list of providers with their keys, base URLs and models. Test models calls
// src/llm from this page; settings are written through chrome.storage, with no worker command.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { listModels } from '@src/llm';
import type { ConnectionResult, ModelList, ProviderKind } from '@src/llm';
import type { ReasoningEffort } from '@src/llm/catalogue';
import {
  capabilityOf,
  DEFAULT_SETTINGS,
  keysStorage,
  LOCAL_KINDS,
  providersStorage,
  settingsStorage,
  withBaseUrl,
} from '@src/store/settings';
import type { ModelEntry, ProviderConfig } from '@src/store/settings';
import { newId } from '@src/store/conversations';
import { Button, Input, Notice, Select } from '@src/ui/components';
import { SettingsCard } from './SettingsCard';
import { VoiceCard } from './VoiceCard';
import { listProblem, saveTest, testModel, wholeTestOnAdd } from './model-test';
import { effortRow } from '@src/side-panel/ModelMenu';
import { useStorage } from '@src/ui/hooks';
import { CheckIcon, ChevronIcon, CloseIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from '@src/ui/icons';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';

export const KINDS: Array<{ kind: ProviderKind; label: string; needsKey: boolean; baseUrl?: string }> = [
  { kind: 'anthropic', label: 'Anthropic', needsKey: true },
  { kind: 'openai', label: 'OpenAI', needsKey: true },
  { kind: 'gemini', label: 'Google Gemini', needsKey: true },
  { kind: 'openrouter', label: 'OpenRouter', needsKey: true },
  { kind: 'ollama', label: 'Ollama', needsKey: false, baseUrl: 'http://localhost:11434' },
  { kind: 'lmstudio', label: 'LM Studio', needsKey: false, baseUrl: 'http://localhost:1234' },
  { kind: 'openai-compatible', label: 'OpenAI-compatible', needsKey: false, baseUrl: '' },
];

const EMPTY_PROVIDERS: ProviderConfig[] = [];
const EMPTY_KEYS: Record<string, string> = {};

/**
 * Presets: cloud endpoints that speak chat completions, added as OpenAI-compatible providers but listed and named as
 * providers of their own.
 */
const PRESETS: Array<{ id: string; label: string; baseUrl: string }> = [
  { id: 'xai', label: 'xAI Grok', baseUrl: 'https://api.x.ai/v1' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
];

/**
 * The Add a provider list: the vendors' own APIs (OpenAI, Anthropic, then Google Gemini), with the presets among them
 * as providers of their own, then OpenRouter, the local servers and any other OpenAI-compatible endpoint.
 */
const VENDORS: ProviderKind[] = ['openai', 'anthropic', 'gemini'];
const CHOICES: Array<{ value: string; label: string }> = [
  ...VENDORS.map(kind => ({ value: kind, label: kindInfo(kind).label })),
  ...PRESETS.map(p => ({ value: p.id, label: p.label })),
  ...KINDS.filter(k => !VENDORS.includes(k.kind)).map(k => ({ value: k.kind, label: k.label })),
];

function kindInfo(kind: ProviderKind) {
  return KINDS.find(k => k.kind === kind)!;
}

/** Whether a provider needs a key: its kind does, or it is a preset, a cloud service that always does. */
function needsKey(provider: ProviderConfig): boolean {
  return kindInfo(provider.kind).needsKey || PRESETS.some(p => p.baseUrl === provider.baseUrl);
}

function updateProvider(id: string, patch: Partial<ProviderConfig>): Promise<void> {
  return providersStorage.set(list => list.map(p => (p.id === id ? { ...p, ...patch } : p)));
}

const ICON_BUTTON =
  'rounded-md p-1.5 text-nb-muted hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent';

export function ProvidersSection() {
  const providers = useStorage(providersStorage, EMPTY_PROVIDERS);
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);

  const add = async (choice: string) => {
    const preset = PRESETS.find(p => p.id === choice);
    const kind = preset ? 'openai-compatible' : (choice as ProviderKind);
    const info = kindInfo(kind);
    const provider: ProviderConfig = {
      id: newId(),
      kind,
      name: preset?.label ?? info.label,
      baseUrl: preset?.baseUrl ?? info.baseUrl,
      models: [],
    };
    await providersStorage.set(list => [...list, provider]);
  };

  const choices = providers.flatMap(p =>
    p.models
      .filter(m => !m.noToolCalling)
      .map(m => ({ value: `${p.id}\u0000${m.name}`, label: `${p.name} · ${m.name}` })),
  );
  const current = settings.defaultModel
    ? `${settings.defaultModel.providerId}\u0000${settings.defaultModel.model}`
    : '';
  // The effort for new conversations, the one place it is set outside the composer, offered as the picker's row is for
  // this model: none for a model that does not reason, Low to High for one that cannot stop.
  const effort = current ? effortRow(capabilityOf(providers, settings.defaultModel), settings.reasoning) : null;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="sr-only">{t('settings.nav.providers')}</h2>
      <SettingsCard
        title={t('models.defaultModel')}
        description={t('models.defaultModelHint')}
        className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <label className="flex min-w-0 max-w-full items-center gap-3">
          <span className="text-nb-muted">{t('models.model')}</span>
          <Select
            aria-label={t('models.defaultModel')}
            className="min-w-0 sm:max-w-xs"
            value={current}
            onChange={e => {
              const [providerId, model] = e.target.value.split('\u0000');
              void settingsStorage.set(s => ({ ...s, defaultModel: providerId ? { providerId, model } : null }));
            }}>
            <option value="">{t('models.none')}</option>
            {choices.map(c => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        {effort ? (
          <label className="flex items-center gap-3">
            <span className="text-nb-muted">{t('agent.reasoning')}</span>
            <Select
              aria-label={t('agent.reasoning')}
              value={effort.shown}
              onChange={e => void settingsStorage.set(s => ({ ...s, reasoning: e.target.value as ReasoningEffort }))}>
              {effort.pills.map(value => (
                <option key={value} value={value}>
                  {t(`reasoning.${value}`)}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </SettingsCard>
      <VoiceCard />
      <SettingsCard title={t('settings.nav.providers')} className="flex flex-col gap-4">
        <Notice tone="ok">{t('models.keysNote')}</Notice>
        {providers.length ? (
          <ul className="divide-y divide-nb-border border-y border-nb-border">
            {providers.map(p => (
              <ProviderItem key={p.id} provider={p} />
            ))}
          </ul>
        ) : null}
        <AddProvider onAdd={choice => void add(choice)} />
      </SettingsCard>
    </section>
  );
}

/**
 * "Add a provider": the menu of kinds and presets, then the button, centred under the providers and set apart from
 * the last one by more space.
 */
function AddProvider({ onAdd }: { onAdd: (choice: string) => void }) {
  const [choice, setChoice] = useState<string>(CHOICES[0].value);
  return (
    <div className="mt-4 flex items-center gap-8 self-center">
      <ChoiceMenu label={t('models.addProvider')} choices={CHOICES} value={choice} onChoose={setChoice} />
      <Button
        variant="primary"
        className="inline-flex items-center gap-1.5 border border-nb-accent"
        onClick={() => onAdd(choice)}>
        <PlusIcon size={16} />
        {t('models.addProvider')}
      </Button>
    </div>
  );
}

/**
 * A menu in place of a select, so it can open above its button when there is not room for it below (the browser
 * places a native select's list itself). Built like the composer's mode menu: arrow keys move, Escape closes.
 */
function ChoiceMenu({
  label,
  choices,
  value,
  onChoose,
}: {
  label: string;
  choices: Array<{ value: string; label: string }>;
  value: string;
  onChoose: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const current = choices.find(c => c.value === value) ?? choices[0];

  // Measured before the menu is painted: above when it does not fit below and there is more room above.
  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const box = button.current.getBoundingClientRect();
    const below = window.innerHeight - box.bottom;
    setAbove(menu.current.offsetHeight + 8 > below && box.top > below);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={`${label}: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-label={label}
        data-value={current.value}
        className="flex items-center gap-2 rounded-lg border border-nb-border bg-nb-bg py-1.5 pl-2.5 pr-2 text-sm focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
        onClick={() => setOpen(o => !o)}>
        {current.label}
        <ChevronIcon size={14} className={`transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
      </button>
      {open ? (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            } else if (e.key === 'Tab') {
              setOpen(false);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
              const at = items.indexOf(document.activeElement as HTMLElement);
              items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            }
          }}
          className={`absolute left-0 z-10 flex w-56 flex-col rounded-xl border border-nb-border bg-nb-bg p-1 text-sm shadow-pop ${above ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
          {choices.map(c => (
            <button
              key={c.value}
              type="button"
              role="menuitemradio"
              aria-checked={c.value === value}
              data-value={c.value}
              className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left hover:bg-nb-surface focus-visible:bg-nb-surface focus-visible:outline-none"
              onClick={() => {
                close();
                onChoose(c.value);
              }}>
              <span className="flex-1">{c.label}</span>
              <CheckIcon size={16} className={c.value === value ? 'text-nb-accent' : 'invisible'} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One line of a provider: a muted name at the left, the field or fields at the right. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <span className="text-nb-muted sm:pt-1.5">{label}</span>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </>
  );
}

/**
 * One provider in the list: its name and kind, Test models (for all its models) and a bin, then its name, key and
 * address as compact lines, and its models as chips that show a remove icon on hover. Saving a key lists the provider's
 * models, so a key the provider refuses shows at once; Ollama and LM Studio, which take no key, list on List models.
 */
function ProviderItem({ provider }: { provider: ProviderConfig }) {
  const keys = useStorage(keysStorage, EMPTY_KEYS);
  const info = kindInfo(provider.kind);
  const local = LOCAL_KINDS.has(provider.kind) || provider.kind === 'openai-compatible';
  const [newModel, setNewModel] = useState('');
  const [listed, setListed] = useState<ModelList>({ models: [], hidden: [] });
  const [showAll, setShowAll] = useState(false);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<{ message: string; originRefused: boolean } | null>(null);
  // Counts the lists asked for, so only the latest one's answer is shown.
  const listAsked = useRef(0);
  const [testingModels, setTestingModels] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<Record<string, ConnectionResult>>({});
  const queue = useRef<Promise<void>>(Promise.resolve());
  const testing = testingModels.size > 0;
  const key = keys[provider.id] ?? '';
  const name = provider.name.trim();

  /** Lists the models with `apiKey`, the key just saved when called on saving it. */
  const fetchModels = async (apiKey = key) => {
    const asked = ++listAsked.current;
    setListError(null);
    setListing(true);
    try {
      const list = await listModels({ kind: provider.kind, apiKey, baseUrl: provider.baseUrl });
      if (asked !== listAsked.current) return;
      setListed(list);
      setShowAll(!list.models.length);
    } catch (error) {
      if (asked !== listAsked.current) return;
      setListed({ models: [], hidden: [] });
      setListError(listProblem(error, local));
    } finally {
      if (asked === listAsked.current) setListing(false);
    }
  };

  const addModel = async (model: string) => {
    const trimmed = model.trim();
    if (!trimmed || provider.models.some(m => m.name === trimmed)) return;
    await updateProvider(provider.id, { models: [...provider.models, { name: trimmed }] });
    setNewModel('');
    runTests([trimmed], 'add');
  };

  /**
   * Tests models one at a time: `whole` for Test models; `add` for a model added, a key saved or a base URL
   * changed, which runs the whole test on a cloud endpoint and reads only the API on a local one. A kind that needs a
   * key waits for it. A queued test reads the provider and its key when its turn comes, and is skipped if the address
   * changed since it was queued, so a key never goes to an address it was not tested with.
   */
  const runTests = (names: string[], mode: 'whole' | 'add') => {
    void providersStorage.get().then(list => {
      const queuedAt = list.find(p => p.id === provider.id)?.baseUrl ?? '';
      for (const modelName of names) enqueue(modelName, mode, queuedAt);
    });
  };

  const enqueue = (modelName: string, mode: 'whole' | 'add', queuedAt: string) => {
    setTestingModels(prev => new Set(prev).add(modelName));
    queue.current = queue.current.then(async () => {
      const fresh = (await providersStorage.get()).find(p => p.id === provider.id);
      const usedKey = (await keysStorage.get())[provider.id] ?? '';
      if (
        fresh?.models.some(m => m.name === modelName) &&
        (fresh.baseUrl ?? '') === queuedAt &&
        !(needsKey(fresh) && !usedKey)
      ) {
        const test = await testModel(fresh, modelName, usedKey, mode === 'whole' || wholeTestOnAdd(fresh));
        const r = test.result;
        if (r) setResults(prev => ({ ...prev, [modelName]: r }));
        await saveTest(fresh.id, fresh.baseUrl, modelName, test);
      }
      setTestingModels(prev => {
        const next = new Set(prev);
        next.delete(modelName);
        return next;
      });
    });
  };

  const testAll = () => {
    setResults({});
    runTests(
      provider.models.map(m => m.name),
      'whole',
    );
  };

  // The base URL as it was when its field was entered, to test again on leaving it changed.
  const urlAtFocus = useRef<string | null>(null);

  const keyLabel = needsKey(provider) ? t('models.apiKey') : t('models.apiKeyOptional');
  const problems = provider.models.flatMap(m => {
    const r = results[m.name];
    return r && !(r.ok && r.toolCalling) ? [{ name: m.name, result: r }] : [];
  });

  return (
    <li className="flex flex-col gap-3 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{name || info.label}</span>
        {name && name !== info.label && !PRESETS.some(p => p.label === name) ? (
          <span className="text-sm text-nb-muted">{info.label}</span>
        ) : null}
        <span className="flex-1" />
        <Button onClick={testAll} disabled={testing || !provider.models.length}>
          {testing ? t('models.testing') : t('models.test')}
        </Button>
        <button
          type="button"
          aria-label={t('models.removeProvider')}
          title={t('models.removeProvider')}
          className={ICON_BUTTON}
          onClick={() => {
            void providersStorage.set(list => list.filter(p => p.id !== provider.id));
            void keysStorage.set(({ [provider.id]: _removed, ...rest }) => rest);
          }}>
          <TrashIcon size={16} />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-y-2">
        <Line label={t('models.providerName')}>
          <DraftField
            label={t('models.providerName')}
            saveLabel={t('models.saveName')}
            saved={provider.name}
            onSave={value => void updateProvider(provider.id, { name: value })}
          />
        </Line>
        {provider.kind !== 'ollama' && provider.kind !== 'lmstudio' ? (
          <Line label={keyLabel}>
            <KeyField
              label={keyLabel}
              saved={key}
              onSave={value =>
                void keysStorage
                  .set(k => ({ ...k, [provider.id]: value }))
                  .then(() => {
                    // An OpenAI-compatible endpoint lists only once it has an address.
                    if (provider.kind !== 'openai-compatible' || provider.baseUrl) void fetchModels(value);
                    runTests(
                      provider.models.map(m => m.name),
                      'add',
                    );
                  })
              }
              onClear={() => {
                // A list still running for the old key is dropped, and its refusal goes with it.
                listAsked.current++;
                setListing(false);
                setListError(null);
                void keysStorage.set(({ [provider.id]: _cleared, ...rest }) => rest);
              }}
            />
          </Line>
        ) : null}
        {local ? (
          <Line label={t('models.baseUrl')}>
            <Input
              aria-label={t('models.baseUrl')}
              className="w-full sm:max-w-sm"
              value={provider.baseUrl ?? ''}
              placeholder={info.baseUrl || 'http://localhost:8000/v1'}
              onChange={e => {
                const baseUrl = e.target.value;
                void providersStorage.set(list => list.map(p => (p.id === provider.id ? withBaseUrl(p, baseUrl) : p)));
              }}
              onFocus={() => (urlAtFocus.current = provider.baseUrl ?? '')}
              onBlur={() => {
                if (urlAtFocus.current !== null && urlAtFocus.current !== (provider.baseUrl ?? '')) {
                  runTests(
                    provider.models.map(m => m.name),
                    'add',
                  );
                }
                urlAtFocus.current = null;
              }}
            />
          </Line>
        ) : null}
        <Line label={t('models.models')}>
          {provider.models.length ? (
            <ul className="mb-2 flex flex-wrap gap-2" aria-label={t('models.models')}>
              {provider.models.map(m => (
                <ModelChip
                  key={m.name}
                  model={m}
                  result={results[m.name]}
                  testing={testingModels.has(m.name)}
                  onRemove={() =>
                    void updateProvider(provider.id, { models: provider.models.filter(x => x.name !== m.name) })
                  }
                />
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t('models.addModel')}
              className="w-48"
              list={`models-${provider.id}`}
              value={newModel}
              placeholder={t('models.modelNamePlaceholder')}
              onChange={e => setNewModel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void addModel(newModel);
              }}
            />
            <datalist id={`models-${provider.id}`}>
              {(showAll ? [...listed.models, ...listed.hidden] : listed.models).map(n => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <Button onClick={() => void addModel(newModel)}>{t('common.add')}</Button>
            <Button variant="ghost" onClick={() => void fetchModels()}>
              {t('models.fetchModels')}
            </Button>
            {listing ? (
              <span className="text-nb-muted">{t('models.listing')}</span>
            ) : (
              <ListedCount list={listed} showAll={showAll} onShowAll={() => setShowAll(true)} />
            )}
          </div>
          {/* A name typed or picked is not kept until Add is pressed, which a user may not know. */}
          {newModel.trim() && !provider.models.some(m => m.name === newModel.trim()) ? (
            <p className="text-nb-muted">{t('models.addHint')}</p>
          ) : null}
        </Line>
      </div>
      {listError ? (
        listError.originRefused ? (
          <OriginFix kind={provider.kind} />
        ) : (
          <Notice tone="error">{listError.message}</Notice>
        )
      ) : null}
      {problems.map(({ name: model, result }) =>
        result.ok ? (
          <Notice key={model} tone="warn">
            <span className="font-mono">{model}</span>: {t('models.testNoTools')}
          </Notice>
        ) : result.originRefused ? (
          <OriginFix key={model} kind={provider.kind} />
        ) : (
          <Notice key={model} tone="error">
            <span className="font-mono">{model}</span>: {result.error}
          </Notice>
        ),
      )}
    </li>
  );
}

/**
 * A field whose change is kept as a draft until it is saved with the check (or Enter) or dropped with the cross (or
 * Escape); the two buttons show only while the draft differs from the saved value. Used for the name.
 */
function DraftField({
  label,
  saveLabel,
  saved,
  onSave,
}: {
  label: string;
  saveLabel: string;
  saved: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const changed = draft !== null && draft !== saved;
  const save = () => {
    if (draft === null) return;
    onSave(draft.trim());
    setDraft(null);
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={label}
        className="w-full sm:max-w-sm"
        autoComplete="off"
        value={draft ?? saved}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && changed) save();
          else if (e.key === 'Escape' && draft !== null) {
            e.stopPropagation();
            setDraft(null);
          }
        }}
      />
      {changed ? (
        <>
          <button
            type="button"
            aria-label={saveLabel}
            title={saveLabel}
            className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent dark:text-emerald-400 dark:hover:bg-emerald-950"
            onClick={save}>
            <CheckIcon size={16} />
          </button>
          <button
            type="button"
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
            className={ICON_BUTTON}
            onClick={() => setDraft(null)}>
            <CloseIcon size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * The API key. Before it is saved it is a draft, hidden as it is typed, which the eye shows in plain text so it can be
 * checked; the check (or Enter) saves it and the cross (or Escape) drops it. Once saved it is not shown and cannot be
 * edited, only cleared with the red cross after the field, which shows on hover or keyboard focus, as a model chip's
 * does; a new key is typed in its place.
 */
function KeyField({
  label,
  saved,
  onSave,
  onClear,
}: {
  label: string;
  saved: string;
  onSave: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState('');
  if (saved) {
    return (
      <div className="group flex items-center gap-1">
        <Input aria-label={label} className="w-full text-nb-muted sm:max-w-sm" readOnly value={'•'.repeat(16)} />
        <button
          type="button"
          aria-label={t('models.clearKey')}
          title={t('models.clearKey')}
          className="rounded-md p-1.5 text-red-600 opacity-0 hover:bg-red-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent group-hover:opacity-100 dark:text-red-400 dark:hover:bg-red-950"
          onClick={onClear}>
          <CloseIcon size={16} />
        </button>
      </div>
    );
  }
  const typed = draft.trim();
  const save = () => {
    if (!typed) return;
    onSave(typed);
    setDraft('');
  };
  return (
    <div className="flex items-center gap-1">
      <KeyInput
        label={label}
        className="w-full sm:max-w-sm"
        value={draft}
        onChange={setDraft}
        onKeyDown={e => {
          if (e.key === 'Enter') save();
          else if (e.key === 'Escape' && draft) {
            e.stopPropagation();
            setDraft('');
          }
        }}
      />
      {typed ? (
        <>
          <button
            type="button"
            aria-label={t('models.saveKey')}
            title={t('models.saveKey')}
            className="rounded-md p-1.5 text-emerald-700 hover:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent dark:text-emerald-400 dark:hover:bg-emerald-950"
            onClick={save}>
            <CheckIcon size={16} />
          </button>
          <button
            type="button"
            aria-label={t('common.cancel')}
            title={t('common.cancel')}
            className={ICON_BUTTON}
            onClick={() => setDraft('')}>
            <CloseIcon size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}

/** A key being typed: hidden, with an eye inside the field's right end that shows it in plain text and hides it again. */
export function KeyInput({
  label,
  className = '',
  value,
  onChange,
  onKeyDown,
}: {
  label: string;
  className?: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [shown, setShown] = useState(false);
  const toggle = shown ? t('models.hideKey') : t('models.showKey');
  return (
    <div className={`relative min-w-0 ${className}`}>
      <Input
        aria-label={label}
        className="w-full pr-9"
        type={shown ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        aria-label={toggle}
        title={toggle}
        className={`absolute right-1 top-1/2 -translate-y-1/2 ${ICON_BUTTON}`}
        onClick={() => setShown(s => !s)}>
        {shown ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
      </button>
    </div>
  );
}

/** A model as a chip: a check once it passed the test, "no tool calling" when it failed it, and remove on hover. */
function ModelChip({
  model,
  result,
  testing,
  onRemove,
}: {
  model: ModelEntry;
  result?: ConnectionResult;
  /** A test of this model is running or waiting its turn. */
  testing: boolean;
  onRemove: () => void;
}) {
  const passed = result?.ok && result.toolCalling;
  return (
    <li
      title={
        passed
          ? // What the reasoning probe learnt, when it learnt something.
            `${t('models.testOk', { ms: result.ms })}${result.tested?.reasons !== undefined ? ` · ${t(result.tested.reasons ? 'models.reasons' : 'models.noReasoning')}` : ''}`
          : undefined
      }
      className={`group flex items-center gap-1.5 rounded-lg border py-1 pl-2.5 pr-1 ${model.noToolCalling ? 'border-red-300 dark:border-red-800' : 'border-nb-border'} bg-nb-surface`}>
      {passed ? <CheckIcon size={14} className="text-emerald-600 dark:text-emerald-400" /> : null}
      <span className="font-mono">{model.name}</span>
      {testing ? <span className="text-nb-muted">· {t('models.testing')}</span> : null}
      {!testing && model.noToolCalling ? (
        <span className="text-red-700 dark:text-red-300">· {t('models.noToolCalling')}</span>
      ) : null}
      <button
        type="button"
        aria-label={t('models.removeModel', { name: model.name })}
        title={t('models.removeModel', { name: model.name })}
        className="rounded p-0.5 text-nb-muted opacity-0 hover:bg-nb-bg hover:text-nb-fg focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent group-hover:opacity-100"
        onClick={onRemove}>
        <CloseIcon size={14} />
      </button>
    </li>
  );
}

function platform(): 'mac' | 'windows' | 'linux' {
  const p = navigator.userAgent;
  if (/Mac/i.test(p)) return 'mac';
  if (/Win/i.test(p)) return 'windows';
  return 'linux';
}

/** The fix for a local server that refuses the extension's origin. */
/** "43 of 137 models listed" with Show all at its right, or "137 models listed". */
export function ListedCount({
  list,
  showAll,
  onShowAll,
}: {
  list: ModelList;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const total = list.models.length + list.hidden.length;
  if (!total) return null;
  const partial = list.hidden.length > 0 && !showAll;
  return (
    <span className="text-nb-muted">
      {partial ? t('models.listedOf', { count: list.models.length, total }) : t('models.listed', { count: total })}
      {partial ? (
        <button
          type="button"
          className="ml-2 text-nb-link underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent"
          onClick={onShowAll}>
          {t('models.showAll')}
        </button>
      ) : null}
    </span>
  );
}

export function OriginFix({ kind }: { kind: ProviderKind }) {
  if (kind === 'lmstudio') return <Notice tone="warn">{t('models.fix.lmstudio')}</Notice>;
  if (kind !== 'ollama') return <Notice tone="warn">{t('models.fix.generic')}</Notice>;
  const key: MessageKey = `models.fix.ollama.${platform()}`;
  return (
    <Notice tone="warn">
      <p className="mb-1">{t('models.fix.ollama')}</p>
      <code className="block whitespace-pre-wrap font-mono">{t(key)}</code>
    </Notice>
  );
}
