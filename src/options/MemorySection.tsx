// Settings → Memory: what the agent keeps across conversations. In the first release that is the custom instructions
// the user writes; saved memory that the agent writes is for later.
import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, settingsStorage } from '@src/store/settings';
import { CUSTOM_INSTRUCTIONS_MAX } from '@src/store/types';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { SettingsCard } from './SettingsCard';

/**
 * Custom instructions: edited here only, kept as typed and saved after a pause or on leaving the field, so the stored
 * value never moves the caret.
 */
function CustomInstructions() {
  const settings = useStorage(settingsStorage, DEFAULT_SETTINGS);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const value = draft ?? settings.customInstructions;
  const save = (text: string) => {
    clearTimeout(timer.current);
    void settingsStorage.set(s => ({ ...s, customInstructions: text })).then(() => setSaved(true));
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <SettingsCard
      title={t('agent.instructions')}
      description={t('agent.instructionsHint')}
      className="flex flex-col gap-2">
      <textarea
        aria-label={t('agent.instructions')}
        value={value}
        rows={6}
        maxLength={CUSTOM_INSTRUCTIONS_MAX}
        className="rounded-lg border border-nb-border bg-nb-bg px-3 py-2 text-[15px] leading-relaxed focus:border-nb-accent focus:outline-none focus:ring-2 focus:ring-nb-accent/25"
        onChange={e => {
          const text = e.target.value;
          setDraft(text);
          setSaved(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(text), 600);
        }}
        onBlur={() => draft !== null && draft !== settings.customInstructions && save(draft)}
      />
      <p className="text-sm text-nb-muted">
        {t('agent.instructionsCount', {
          count: value.length.toLocaleString(),
          max: CUSTOM_INSTRUCTIONS_MAX.toLocaleString(),
        })}
        {saved && draft !== null && draft === settings.customInstructions ? ` · ${t('agent.instructionsSaved')}` : ''}
      </p>
    </SettingsCard>
  );
}

export function MemorySection() {
  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">{t('settings.nav.memory')}</h2>
      <CustomInstructions />
    </div>
  );
}
