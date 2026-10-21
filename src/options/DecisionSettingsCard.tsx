// Optional decision APIs answer bounded questions for the agent; their keys stay separate from exported settings.
import { useState } from 'react';
import { DECISION_KEY_IDS, DECISION_MODELS } from '@src/llm/decisions';
import type { DecisionProvider } from '@src/llm/decisions';
import { DEFAULT_SETTINGS, keysStorage, settingsStorage } from '@src/store/settings';
import { Button, Input, Select } from '@src/ui/components';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { SettingsCard, SettingsRow } from './SettingsCard';

const EMPTY_KEYS: Record<string, string> = {};

export function DecisionSettingsCard() {
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const keys = useStorage(keysStorage, EMPTY_KEYS);
  const provider = settings.decisionProvider;

  return (
    <SettingsCard title={t('decisions.title')} description={t('decisions.description')} className="flex flex-col gap-6">
      <SettingsRow
        label={t('decisions.provider')}
        description={provider ? t('decisions.model', { model: DECISION_MODELS[provider] }) : undefined}>
        <Select
          aria-label={t('decisions.provider')}
          value={provider ?? ''}
          onChange={e =>
            void settingsStorage.set(s => ({
              ...s,
              decisionProvider: (e.target.value || null) as DecisionProvider | null,
            }))
          }>
          <option value="">{t('decisions.off')}</option>
          <option value="jev">Jev (TypeSafe)</option>
          <option value="openai">OpenAI Decisions</option>
        </Select>
      </SettingsRow>
      {provider ? (
        <DecisionKey key={provider} provider={provider} saved={keys[DECISION_KEY_IDS[provider]] ?? ''} />
      ) : null}
      <p className="text-sm leading-relaxed text-nb-muted">{t('decisions.privacy')}</p>
    </SettingsCard>
  );
}

function DecisionKey({ provider, saved }: { provider: DecisionProvider; saved: string }) {
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const keyId = DECISION_KEY_IDS[provider];
  const save = async () => {
    const value = draft.trim();
    if (!value || pending || saved) return;
    setPending(true);
    try {
      await keysStorage.set(keys => ({ ...keys, [keyId]: value }));
      setDraft('');
    } finally {
      setPending(false);
    }
  };
  const clear = async () => {
    if (pending) return;
    setPending(true);
    try {
      await keysStorage.set(({ [keyId]: _removed, ...rest }) => rest);
    } finally {
      setPending(false);
    }
  };

  return (
    <SettingsRow label={t('decisions.apiKey')} description={t(saved ? 'decisions.keySaved' : 'decisions.keyRequired')}>
      <Input
        aria-label={t('decisions.apiKey')}
        className="w-full sm:w-60"
        type="password"
        autoComplete="off"
        spellCheck={false}
        readOnly={!!saved}
        disabled={pending}
        value={saved ? '•'.repeat(16) : draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !saved) void save();
          else if (e.key === 'Escape' && draft) {
            e.stopPropagation();
            setDraft('');
          }
        }}
      />
      {saved ? (
        <Button onClick={() => void clear()} disabled={pending}>
          {t('decisions.clearKey')}
        </Button>
      ) : (
        <Button onClick={() => void save()} disabled={pending || !draft.trim()}>
          {t('decisions.saveKey')}
        </Button>
      )}
    </SettingsRow>
  );
}
