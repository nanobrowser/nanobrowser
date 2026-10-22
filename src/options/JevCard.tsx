// Jev complements the conversation model with optional routing and bounded browser-action proposals.
import { useState } from 'react';
import { DEFAULT_JEV_SETTINGS, JEV_KEY_ID, jevSettingsStorage, validateJevSettings } from '@src/store/jev';
import type { JevSettings } from '@src/store/jev';
import { capabilityOf, keysStorage, providersStorage } from '@src/store/settings';
import type { ReasoningEffort } from '@src/llm/catalogue';
import { effortRow } from '@src/side-panel/ModelMenu';
import type { ProviderConfig } from '@src/store/settings';
import type { ModelRef } from '@src/store/types';
import { Button, Input, Notice, Select, Switch } from '@src/ui/components';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import { SettingsCard, SettingsRow } from './SettingsCard';

const EMPTY_KEYS: Record<string, string> = {};
const EMPTY_PROVIDERS: ProviderConfig[] = [];
const modelValue = (model?: ModelRef) => (model ? `${model.providerId}\u0000${model.model}` : '');
const NUMBERS = [
  ['timeoutMs', 'jev.timeout', 1_000, 60_000, 1_000],
  ['proceedThreshold', 'jev.proceedThreshold', 0, 1, 0.01],
  ['completionThreshold', 'jev.completionThreshold', 0, 1, 0.01],
  ['selectionThreshold', 'jev.selectionThreshold', 0, 1, 0.01],
] as const;

export function JevCard() {
  const saved = useStorage(jevSettingsStorage, DEFAULT_JEV_SETTINGS);
  const providers = useStorage(providersStorage, EMPTY_PROVIDERS);
  const [draft, setDraft] = useState<JevSettings | null>(null);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);
  const settings = draft ?? saved;
  const ready = jevSettingsStorage.getSnapshot() !== null;
  const models = providers.flatMap(provider =>
    provider.models
      .filter(model => !model.noToolCalling)
      .map(model => ({
        ref: { providerId: provider.id, model: model.name },
        label: `${provider.name} · ${model.name}`,
      })),
  );
  const update = <K extends keyof JevSettings>(key: K, value: JevSettings[K]) => {
    setDraft(previous => ({ ...(previous ?? saved), [key]: value }));
    setStatus(null);
  };
  const save = async () => {
    if (pending) return;
    setPending(true);
    setStatus(null);
    try {
      await jevSettingsStorage.set(validateJevSettings(settings));
      setDraft(null);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      setPending(false);
    }
  };
  const routingModel = (key: 'fastModel' | 'capableModel', label: MessageKey) => {
    const current = modelValue(settings[key]);
    const unavailable = current && !models.some(model => modelValue(model.ref) === current);
    return (
      <SettingsRow label={t(label)}>
        <Select
          aria-label={t(label)}
          className="sm:max-w-xs"
          value={current}
          onChange={event => update(key, models.find(model => modelValue(model.ref) === event.target.value)?.ref)}>
          <option value="">{t('jev.currentModel')}</option>
          {unavailable ? (
            <option value={current}>{t('jev.unavailableModel', { model: settings[key]!.model })}</option>
          ) : null}
          {models.map(model => (
            <option key={modelValue(model.ref)} value={modelValue(model.ref)}>
              {model.label}
            </option>
          ))}
        </Select>
      </SettingsRow>
    );
  };

  const routingReasoning = (key: 'fastReasoning' | 'capableReasoning', label: MessageKey) => {
    const model = settings[key === 'fastReasoning' ? 'fastModel' : 'capableModel'];
    const effort = effortRow(capabilityOf(providers, model), settings[key] ?? 'medium');
    if (!effort) return null;
    return (
      <SettingsRow label={t(label)}>
        <Select
          aria-label={t(label)}
          className="sm:max-w-xs"
          value={settings[key] === undefined ? '' : effort.shown}
          onChange={event => update(key, (event.target.value || undefined) as ReasoningEffort | undefined)}>
          <option value="">{t('jev.currentReasoning')}</option>
          {effort.pills.map(value => (
            <option key={value} value={value}>
              {t(`reasoning.${value}`)}
            </option>
          ))}
        </Select>
      </SettingsRow>
    );
  };
  return (
    <SettingsCard title={t('jev.title')} description={t('jev.description')} className="flex flex-col gap-6">
      <JevKey />
      <p className="text-sm leading-relaxed text-nb-muted">{t('jev.privacy')}</p>
      <fieldset disabled={!ready || pending} className="flex min-w-0 flex-col gap-6">
        <SettingsRow label={t('jev.enabled')}>
          <Switch
            aria-label={t('jev.enabled')}
            checked={settings.enabled}
            onChange={value => update('enabled', value)}
          />
        </SettingsRow>
        <SettingsRow label={t('jev.model')}>
          <Input
            aria-label={t('jev.model')}
            className="w-full sm:w-60"
            value={settings.model}
            spellCheck={false}
            onChange={event => update('model', event.target.value)}
          />
        </SettingsRow>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {NUMBERS.map(([key, label, min, max, step]) => (
            <label key={key} className="flex min-w-0 flex-col gap-2 text-sm">
              <span>{t(label)}</span>
              <Input
                aria-label={t(label)}
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number.isFinite(settings[key]) ? settings[key] : ''}
                onChange={event => update(key, event.target.valueAsNumber)}
              />
            </label>
          ))}
        </div>
        <SettingsRow label={t('jev.routing')} description={t('jev.routingHint')}>
          <Switch
            aria-label={t('jev.routing')}
            checked={settings.routingEnabled}
            onChange={value => update('routingEnabled', value)}
          />
        </SettingsRow>
        {routingModel('fastModel', 'jev.fastModel')}
        {routingReasoning('fastReasoning', 'jev.fastReasoning')}
        {routingModel('capableModel', 'jev.capableModel')}
        {routingReasoning('capableReasoning', 'jev.capableReasoning')}
        <SettingsRow label={t('jev.system1')} description={t('jev.system1Hint')}>
          <Switch
            aria-label={t('jev.system1')}
            checked={settings.system1Enabled}
            onChange={value => update('system1Enabled', value)}
          />
        </SettingsRow>
        <div>
          <Button onClick={() => void save()}>{t('jev.saveSettings')}</Button>
        </div>
      </fieldset>
      {status ? (
        <div role="status">
          <Notice tone={status === 'error' ? 'error' : 'ok'}>
            {t(status === 'error' ? 'jev.settingsError' : 'jev.saved')}
          </Notice>
        </div>
      ) : null}
    </SettingsCard>
  );
}

function JevKey() {
  const keys = useStorage(keysStorage, EMPTY_KEYS);
  const saved = keys[JEV_KEY_ID] ?? '';
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = keysStorage.getSnapshot() !== null;
  const change = async (remove = false) => {
    if (pending || (!remove && !draft.trim())) return;
    setPending(true);
    setFailed(false);
    try {
      await keysStorage.set(({ [JEV_KEY_ID]: _removed, ...rest }) =>
        remove ? rest : { ...rest, [JEV_KEY_ID]: draft.trim() },
      );
      setDraft('');
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsRow label={t('jev.apiKey')} description={t(saved ? 'jev.keySaved' : 'jev.keyHint')}>
        <Input
          aria-label={t('jev.apiKey')}
          className="w-full sm:w-60"
          type="password"
          autoComplete="off"
          spellCheck={false}
          readOnly={!!saved}
          disabled={!ready || pending}
          value={saved ? '•'.repeat(16) : draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !saved) void change();
            else if (event.key === 'Escape' && draft) {
              event.stopPropagation();
              setDraft('');
            }
          }}
        />
        <Button disabled={!ready || pending || (!saved && !draft.trim())} onClick={() => void change(!!saved)}>
          {t(saved ? 'jev.clearKey' : 'jev.saveKey')}
        </Button>
      </SettingsRow>
      {failed ? <Notice tone="error">{t('jev.keyError')}</Notice> : null}
    </div>
  );
}
