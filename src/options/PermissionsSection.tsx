// Settings → Permissions: the microphone, the browser features (Chrome permissions the user allows here), then the
// one site list: what Allow, Ask and Block do, then each site set to
// one of them, with the date it was set and a remove icon, and adding a site by hand. Nothing here allows payments,
// access grants or secrets. The default mode is in Settings → General.
import { Fragment, useState } from 'react';
import { siteRulesStorage } from '@src/store/settings';
import type { SiteRule, SiteRuleEntry } from '@src/store/settings';
import { Button, Input, Notice, Select } from '@src/ui/components';
import { BrowserFeaturesCard } from './BrowserFeaturesCard';
import { MicrophoneCard } from './MicrophoneCard';
import { SettingsCard } from './SettingsCard';
import { useStorage } from '@src/ui/hooks';
import { t } from '@src/ui/i18n';
import { TrashIcon } from '@src/ui/icons';

const EMPTY: Record<string, SiteRuleEntry> = {};

/** The three rules, each with what it does, listed above the sites. */
const RULES = [
  ['perm.allow', 'perm.allowHint'],
  ['perm.ask', 'perm.askHint'],
  ['perm.block', 'perm.blockHint'],
] as const;

/**
 * The site key of what the user typed: a host or an address. The same rules as the layer's `siteOf` (lower case,
 * no trailing dot, no leading `www.`, the port when not the default); a unit test keeps the two in step.
 */
export function siteFromInput(input: string): string {
  const text = input.trim();
  if (!text) return '';
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    let host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host.startsWith('www.')) host = host.slice(4);
    return url.port ? `${host}:${url.port}` : host;
  } catch {
    return '';
  }
}

function date(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : '—';
}

export function PermissionsSection() {
  const rules = useStorage(siteRulesStorage, EMPTY);
  const [site, setSite] = useState('');
  const [rule, setRule] = useState<SiteRule>('allow');
  const [error, setError] = useState(false);
  const sites = Object.entries(rules).sort(([a], [b]) => a.localeCompare(b));
  const setRuleOf = (key: string, value: SiteRule) =>
    siteRulesStorage.set(r => ({ ...r, [key]: { ...r[key], rule: value, setAt: new Date().toISOString() } }));
  return (
    <div className="flex flex-col gap-6">
      <h2 className="sr-only">{t('settings.nav.permissions')}</h2>
      <MicrophoneCard />
      <BrowserFeaturesCard />
      <SettingsCard title={t('perm.sites')} description={t('perm.sitesHint')} className="flex flex-col gap-8">
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {RULES.map(([name, hint]) => (
              <Fragment key={name}>
                <dt className="font-medium">{t(name)}</dt>
                <dd className="text-nb-muted">{t(hint)}</dd>
              </Fragment>
            ))}
          </dl>
          <Notice>{t('perm.neverAllowed')}</Notice>
        </div>
        <div className="flex flex-col gap-4">
          {sites.length ? (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-nb-muted">
                <tr>
                  <th className="pb-2 font-normal">{t('perm.site')}</th>
                  <th className="pb-2 font-normal">{t('perm.rule')}</th>
                  <th className="pb-2 font-normal">{t('perm.setAt')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sites.map(([key, entry]) => (
                  <tr key={key} className="border-t border-nb-border">
                    <td className="py-2 font-mono">{key}</td>
                    <td className="py-2">
                      <Select
                        aria-label={t('perm.ruleFor', { site: key })}
                        value={entry.rule}
                        onChange={e => void setRuleOf(key, e.target.value as SiteRule)}>
                        <option value="allow">{t('perm.allow')}</option>
                        <option value="ask">{t('perm.ask')}</option>
                        <option value="block">{t('perm.block')}</option>
                      </Select>
                    </td>
                    <td className="py-2 text-xs">{date(entry.setAt)}</td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="rounded-md p-1.5 text-nb-muted hover:bg-nb-surface hover:text-nb-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-nb-accent"
                        aria-label={t('perm.removeSite', { site: key })}
                        title={t('perm.removeSite', { site: key })}
                        onClick={() =>
                          void siteRulesStorage.set(r => {
                            const next = { ...r };
                            delete next[key];
                            return next;
                          })
                        }>
                        <TrashIcon size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              const key = siteFromInput(site);
              setError(!key);
              if (!key) return;
              void siteRulesStorage.set(r => ({ ...r, [key]: { rule, setAt: new Date().toISOString() } }));
              setSite('');
            }}>
            <Input
              aria-label={t('perm.addSite')}
              placeholder="example.com"
              value={site}
              onChange={e => setSite(e.target.value)}
              className="w-64"
            />
            <Select aria-label={t('perm.rule')} value={rule} onChange={e => setRule(e.target.value as SiteRule)}>
              <option value="allow">{t('perm.allow')}</option>
              <option value="ask">{t('perm.ask')}</option>
              <option value="block">{t('perm.block')}</option>
            </Select>
            <Button type="submit" variant="primary" className="ml-4">
              {t('perm.add')}
            </Button>
            {error ? <span className="text-xs text-red-700 dark:text-red-300">{t('perm.badSite')}</span> : null}
          </form>
        </div>
      </SettingsCard>
    </div>
  );
}
