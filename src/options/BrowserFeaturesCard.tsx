// Additional browser permissions: Chrome permissions Nanobrowser asks for only when the user allows them (tab groups, notifications,
// saving files). Settings → Permissions lists each with a green check once allowed, as the Microphone card does; the
// welcome page's tips show one row. Allow asks Chrome for all of them in one dialog, from the click.
import { Button } from '@src/ui/components';
import { t } from '@src/ui/i18n';
import type { MessageKey } from '@src/ui/i18n';
import { CheckIcon } from '@src/ui/icons';
import { allGranted, requestOptionalPermissions, useGrantedPermissions } from '@src/ui/optional-permissions';
import type { GrantedPermissions } from '@src/ui/optional-permissions';
import { SettingsCard, SettingsRow } from './SettingsCard';

const FEATURES: Array<{ label: MessageKey; hint: MessageKey; allowed: (g: GrantedPermissions) => boolean }> = [
  { label: 'perm.features.tabGroups', hint: 'perm.features.tabGroupsHint', allowed: g => g.tabGroups },
  { label: 'perm.features.notifications', hint: 'perm.features.notificationsHint', allowed: g => g.notifications },
  {
    label: 'perm.features.files',
    hint: 'perm.features.filesHint',
    allowed: g => g.downloads && g['downloads.open'],
  },
];

function Mark({ allowed }: { allowed: boolean }) {
  return allowed ? (
    <span
      role="img"
      aria-label={t('perm.features.allowed')}
      className="flex size-6 items-center justify-center rounded-full bg-emerald-700 text-white">
      <CheckIcon size={14} />
    </span>
  ) : (
    <span
      role="img"
      aria-label={t('perm.features.notYet')}
      className="block size-6 rounded-full border-2 border-nb-border"
    />
  );
}

function AllowButton() {
  return (
    // The request comes first in the click: Chrome takes it only while the click lasts.
    <Button onClick={() => void requestOptionalPermissions()}>{t('perm.features.allow')}</Button>
  );
}

/** Settings → Permissions: each feature with its check, and Allow while any is missing. */
export function BrowserFeaturesCard() {
  const granted = useGrantedPermissions();
  return (
    <SettingsCard
      title={t('perm.features.title')}
      description={t('perm.features.cardHint')}
      className="flex flex-col gap-5">
      {FEATURES.map(f => (
        <SettingsRow
          key={f.label}
          label={t(f.label)}
          description={t(f.hint)}
          icon={<Mark allowed={!!granted && f.allowed(granted)} />}
        />
      ))}
      {granted && !allGranted(granted) ? (
        <div className="flex justify-end">
          <AllowButton />
        </div>
      ) : null}
    </SettingsCard>
  );
}

/** The welcome page's row: the same words and Allow, or a green check once all are allowed. */
export function BrowserFeaturesRow() {
  const granted = useGrantedPermissions();
  const done = allGranted(granted);
  return (
    <SettingsRow
      label={t('perm.features.title')}
      description={t('perm.features.welcomeHint')}
      icon={done ? <Mark allowed /> : undefined}>
      {granted && !done ? <AllowButton /> : null}
    </SettingsRow>
  );
}
