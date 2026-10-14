// The first run: the welcome page, opened when the extension is installed. Three steps: what Nanobrowser does with a
// coach mark for Chrome's pin button; choosing a model (local or cloud, or Set it later); and three tips for safe use,
// with a row that allows the browser features.
// It uses Settings' type and cards, with the logo above the title.
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { listModels, resolveProfile } from '@src/llm';
import type { ModelList, ProviderKind } from '@src/llm';
import { newId } from '@src/store/conversations';
import { DEFAULT_SETTINGS, findModel, keysStorage, providersStorage, settingsStorage } from '@src/store/settings';
import type { ModelEntry, ProviderConfig } from '@src/store/settings';
import { Button, Input, Notice, Select, Switch } from '@src/ui/components';
import { useStorage } from '@src/ui/hooks';
import { setLanguage, t, useLanguage } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import { applyTheme } from '@src/ui/theme';
import { KeyInput, KINDS, ListedCount, OriginFix } from './ProvidersSection';
import { SettingsCard, SettingsRow } from './SettingsCard';
import { BrowserFeaturesRow } from './BrowserFeaturesCard';
import { listProblem, testModel } from './model-test';
import { EdgeExtensionsIcon, ExtensionsIcon, Logo, PinIcon, SlantedPinIcon } from '@src/ui/icons';

const STEPS: MessageKey[] = ['welcome.step.welcome', 'welcome.step.model', 'tips.title'];
const NO_PROVIDERS: ProviderConfig[] = [];
const PANEL_PATH = 'sidepanel.html';

export function Welcome() {
  useLanguage();
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const providers = useStorage(providersStorage, NO_PROVIDERS);
  // Step 2's Next waits for a default model; until then, Set it later goes on.
  const hasModel = !!findModel(providers, settings.defaultModel);
  const [step, setStep] = useState(0);
  const tabId = useRef<number | undefined>();
  useEffect(() => void setLanguage(settings.uiLanguage), [settings.uiLanguage]);
  useEffect(() => applyTheme(settings.theme), [settings.theme]);
  useEffect(() => {
    void chrome.tabs.getCurrent().then(tab => (tabId.current = tab?.id));
  }, []);

  const finish = () => {
    // The panel opens on this tab inside the click: sidePanel.open needs the user's gesture.
    const id = tabId.current;
    if (id !== undefined) {
      void chrome.sidePanel.setOptions({ tabId: id, path: PANEL_PATH, enabled: true });
      chrome.sidePanel.open({ tabId: id }).catch(() => undefined);
    }
    void settingsStorage.set(s => ({ ...s, onboarded: true }));
  };

  return (
    <div className="nb-wave min-h-full">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 p-6 sm:pt-12">
        <Logo height={30} className="self-start" />
        <h1 className="font-serif text-[28px] font-normal leading-tight">{t('welcome.title')}</h1>
        <ol aria-label={t('welcome.steps')} className="flex flex-wrap gap-1">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? 'step' : undefined}
              // Not clickable: the open step on a white pill with a soft blue ring and blue text.
              className={`rounded-lg px-3 py-2 text-[15px] ${i === step ? 'bg-nb-bg font-medium text-nb-link ring-1 ring-nb-accent/30' : 'text-nb-muted'}`}>
              {i + 1}. {t(label)}
            </li>
          ))}
        </ol>
        <main className="flex flex-col gap-6 text-[15px] leading-relaxed">
          <h2 className="text-xl font-semibold leading-tight">{t(STEPS[step])}</h2>
          {step === 0 ? <WelcomeStep /> : step === 2 ? <TipsStep /> : null}
          {/* Kept mounted, so the chosen provider and model are still there after Next and Back. */}
          <div className={step === 1 ? 'flex flex-col gap-6' : 'hidden'}>
            <ModelStep />
          </div>
        </main>
        <div className="flex justify-between">
          {step > 0 ? <Button onClick={() => setStep(step - 1)}>{t('welcome.back')}</Button> : <span />}
          {step < STEPS.length - 1 ? (
            <div className="flex gap-2">
              {step === 1 ? (
                <Button disabled={hasModel} onClick={() => setStep(step + 1)}>
                  {t('welcome.later')}
                </Button>
              ) : null}
              <Button variant="primary" disabled={step === 1 && !hasModel} onClick={() => setStep(step + 1)}>
                {t('welcome.next')}
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={finish}>
              {t('welcome.finish')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Whether the action is on the toolbar; checked again every two seconds while the step is shown. */
function usePinned(): boolean | null {
  const [pinned, setPinned] = useState<boolean | null>(null);
  useEffect(() => {
    const check = () =>
      void chrome.action
        .getUserSettings()
        .then(s => setPinned(s.isOnToolbar))
        .catch(() => setPinned(null));
    check();
    const timer = setInterval(check, 2000);
    return () => clearInterval(timer);
  }, []);
  return pinned;
}

/** A few typical tasks, shown on the first step. */
const EXAMPLES: MessageKey[] = ['welcome.example.summary', 'welcome.example.form', 'welcome.example.research'];

/** Edge draws its Extensions button and its pin differently: another puzzle piece, and the pin slanted. */
const IS_EDGE =
  (navigator as Navigator & { userAgentData?: { brands: Array<{ brand: string }> } }).userAgentData?.brands.some(
    b => b.brand === 'Microsoft Edge',
  ) ?? /\bEdg\//.test(navigator.userAgent);
const ICON_CLASS = 'mx-0.5 inline-block align-[-3px]';
const PIN_ICONS: Record<string, ReactNode> = {
  extensions: IS_EDGE ? <EdgeExtensionsIcon className={ICON_CLASS} /> : <ExtensionsIcon className={ICON_CLASS} />,
  pin: IS_EDGE ? <SlantedPinIcon className={ICON_CLASS} /> : <PinIcon className={ICON_CLASS} />,
};

/** A string with `{name}` placeholders replaced by icons. */
function withIcons(text: string, icons: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{icons[part]}</Fragment> : part));
}

function WelcomeStep() {
  const pinned = usePinned();
  return (
    <>
      <p>{t('welcome.intro')}</p>
      <div>
        <p>{t('welcome.examples')}</p>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
          {EXAMPLES.map(key => (
            <li key={key}>{t(key)}</li>
          ))}
        </ul>
      </div>
      {/* The coach mark, until the action is pinned: it points at the top right, where the Extensions button is. */}
      {pinned ? null : (
        <div
          role="note"
          className="fixed right-4 top-2 z-10 flex max-w-xs items-start gap-2 rounded-xl border border-nb-accent bg-nb-bg p-3 text-sm shadow-pop">
          <span className="motion-safe:animate-bounce" aria-hidden>
            ↗
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-semibold">{t('welcome.pin.title')}</span>
            <span>{withIcons(t('welcome.pin.body'), PIN_ICONS)}</span>
          </span>
        </div>
      )}
    </>
  );
}

function ModelStep() {
  const [choice, setChoice] = useState<'local' | 'cloud' | null>(null);
  const options: Array<{ id: 'local' | 'cloud'; label: MessageKey; hint: MessageKey }> = [
    { id: 'local', label: 'welcome.model.local', hint: 'welcome.model.localHint' },
    { id: 'cloud', label: 'welcome.model.cloud', hint: 'welcome.model.cloudHint' },
  ];
  return (
    <>
      <p>{t('welcome.model.intro')}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('welcome.step.model')}>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={choice === o.id}
            className={`flex flex-col gap-1 rounded-xl border bg-nb-bg px-5 py-4 text-left transition-colors ${choice === o.id ? 'border-nb-accent ring-2 ring-nb-accent/20' : 'border-nb-border hover:border-nb-accent/40'}`}
            onClick={() => setChoice(o.id)}>
            <span className="text-base">{t(o.label)}</span>
            <span className="text-sm leading-relaxed text-nb-muted">{t(o.hint)}</span>
          </button>
        ))}
      </div>
      {choice ? <ModelSetup key={choice} local={choice === 'local'} /> : null}
    </>
  );
}

const LOCAL: ProviderKind[] = ['ollama', 'lmstudio'];
// The cloud providers in the welcome page's order, OpenAI first.
const CLOUD: ProviderKind[] = ['openai', 'anthropic', 'gemini', 'openrouter'];

/** Connect to a server or a provider, pick a model, test its tool calling and make it the default. */
function ModelSetup({ local }: { local: boolean }) {
  const kinds = (local ? LOCAL : CLOUD).map(kind => KINDS.find(k => k.kind === kind)!);
  const [kind, setKind] = useState<ProviderKind>(kinds[0].kind);
  const info = kinds.find(k => k.kind === kind)!;
  const [baseUrl, setBaseUrl] = useState(info.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [found, setFound] = useState<ModelList | null>(null);
  const [showAll, setShowAll] = useState(false);
  const listed = found && (showAll ? [...found.models, ...found.hidden] : found.models);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ originRefused: boolean; message: string } | null>(null);
  const [result, setResult] = useState<{ model: string; toolCalling: boolean; window?: number } | null>(null);
  const base = local ? baseUrl.trim() : undefined;

  const connect = async () => {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const list = await listModels({ kind, apiKey, baseUrl: base });
      setFound(list);
      // When every model is hidden, the list shows them all rather than look empty.
      setShowAll(!list.models.length);
      setName(list.models[0] ?? list.hidden[0] ?? '');
    } catch (error) {
      setProblem(listProblem(error, local));
      // A cloud provider that cannot list models can still take a typed name.
      setFound(local ? null : { models: [], hidden: [] });
    } finally {
      setBusy(false);
    }
  };

  const use = async () => {
    const model = name.trim();
    if (!model) return;
    setBusy(true);
    setProblem(null);
    setResult(null);
    // The whole test: the model's API, then the probes.
    const test = await testModel({ id: '', kind, name: '', baseUrl: base, models: [] }, model, apiKey, true);
    const tested = test.result!;
    if (!tested.ok) {
      setProblem({ originRefused: !!tested.originRefused && local, message: tested.error ?? '' });
      setBusy(false);
      return;
    }
    const detected = test.patch.detectedContext;
    // One provider per kind and address: a second model joins the first's card.
    const existing = (await providersStorage.get()).find(p => p.kind === kind && (p.baseUrl ?? '') === (base ?? ''));
    const provider: ProviderConfig = existing ?? {
      id: newId(),
      kind,
      name: info.label,
      ...(base ? { baseUrl: base } : {}),
      models: [],
    };
    const at = new Date().toISOString();
    const entry: ModelEntry = {
      name: model,
      noToolCalling: !tested.toolCalling,
      ...(detected ? { detectedContext: detected } : {}),
      ...(test.patch.fromApi ? { fromApi: test.patch.fromApi } : {}),
      ...(test.patch.tested ? { tested: { ...test.patch.tested, at } } : {}),
    };
    await providersStorage.set(list => [
      ...list.filter(p => p.id !== provider.id),
      { ...provider, models: [...provider.models.filter(m => m.name !== model), entry] },
    ]);
    if (apiKey) await keysStorage.set(k => ({ ...k, [provider.id]: apiKey }));
    if (tested.toolCalling) {
      await settingsStorage.set(s => ({ ...s, defaultModel: { providerId: provider.id, model } }));
    }
    const window =
      detected ?? (local ? undefined : resolveProfile({ kind, modelName: model, baseUrl: base }).contextWindow);
    setResult({ model, toolCalling: tested.toolCalling, window });
    setBusy(false);
  };

  const serverLabel = local ? t('welcome.model.server') : t('welcome.model.provider');
  return (
    <SettingsCard className="flex flex-col gap-6">
      {!local ? <Notice tone="ok">{t('models.keysNote')}</Notice> : null}
      <SettingsRow label={serverLabel}>
        <Select
          aria-label={serverLabel}
          value={kind}
          onChange={e => {
            const next = e.target.value as ProviderKind;
            setKind(next);
            setBaseUrl(KINDS.find(k => k.kind === next)?.baseUrl ?? '');
            setFound(null);
            setProblem(null);
            setResult(null);
          }}>
          {kinds.map(k => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </Select>
      </SettingsRow>
      {local ? (
        <SettingsRow label={t('models.baseUrl')}>
          <Input
            aria-label={t('models.baseUrl')}
            className="w-72 max-w-full"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
          />
        </SettingsRow>
      ) : (
        <SettingsRow label={t('models.apiKey')}>
          <KeyInput label={t('models.apiKey')} className="w-72 max-w-full" value={apiKey} onChange={setApiKey} />
        </SettingsRow>
      )}
      <Button
        className="self-end"
        disabled={busy || (local ? !baseUrl.trim() : !apiKey.trim())}
        onClick={() => void connect()}>
        {busy && !listed ? t('welcome.model.connecting') : t('welcome.model.connect')}
      </Button>
      {listed ? (
        <SettingsRow
          label={t('welcome.model.choose')}
          description={
            found ? <ListedCount list={found} showAll={showAll} onShowAll={() => setShowAll(true)} /> : undefined
          }>
          {listed.length ? (
            <Select aria-label={t('welcome.model.choose')} value={name} onChange={e => setName(e.target.value)}>
              {listed.map(n => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              aria-label={t('welcome.model.choose')}
              placeholder={t('welcome.model.typeName')}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          )}
        </SettingsRow>
      ) : null}
      {listed ? (
        <Button className="self-end" variant="primary" disabled={busy || !name.trim()} onClick={() => void use()}>
          {busy ? t('models.testing') : t('welcome.model.use')}
        </Button>
      ) : null}
      {listed && !listed.length && local ? <Notice tone="warn">{t('welcome.model.noneListed')}</Notice> : null}
      {problem ? (
        problem.originRefused ? (
          <OriginFix kind={kind} />
        ) : (
          <Notice tone="error">{problem.message}</Notice>
        )
      ) : null}
      {result ? (
        result.toolCalling ? (
          <>
            <Notice tone="ok">{t('welcome.model.ready', { model: result.model })}</Notice>
            {local && (result.window ?? 0) < 16_384 ? (
              <Notice tone="warn">
                {result.window
                  ? t('welcome.model.small', { tokens: result.window.toLocaleString() })
                  : t('welcome.model.smallUnknown')}
              </Notice>
            ) : null}
          </>
        ) : (
          <Notice tone="warn">{t('welcome.model.noTools', { model: result.model })}</Notice>
        )
      ) : null}
    </SettingsCard>
  );
}

/** Three tips for safe use, as cards: a title and a short line each. */
const TIPS: Array<{ title: MessageKey; body: MessageKey }> = [
  { title: 'tips.familiar.title', body: 'tips.familiar.body' },
  { title: 'tips.profile.title', body: 'tips.profile.body' },
  { title: 'tips.avoid.title', body: 'tips.avoid.body' },
];

function TipsStep() {
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  return (
    <>
      <p>{t('tips.intro')}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TIPS.map(tip => (
          <li key={tip.title} className="flex flex-col gap-1 rounded-xl border border-nb-border bg-nb-bg px-5 py-4">
            <h3 className="text-base font-semibold">{t(tip.title)}</h3>
            <p className="text-sm leading-relaxed text-nb-muted">{t(tip.body)}</p>
          </li>
        ))}
      </ul>
      {/* Its own button: Open the panel uses its click to open the side panel. Skipping it is fine. */}
      <SettingsCard>
        <BrowserFeaturesRow />
      </SettingsCard>
      <SettingsCard>
        <SettingsRow label={t('welcome.help')} description={t('welcome.helpHint')}>
          <Switch
            aria-label={t('welcome.help')}
            checked={settings.analyticsStats}
            onChange={on => void settingsStorage.set(s => ({ ...s, analyticsStats: on }))}
          />
        </SettingsRow>
      </SettingsCard>
    </>
  );
}
