// Unattended runs for development: a build made with WXT_AUTORUN_URL set asks the fixture server for checks
// to run at start and posts the reports back. Normal builds leave the variable unset and skip this entirely.
// Chrome is started as a plain process by fixtures/autorun.mjs; nothing connects to it over CDP.
import type { CheckReport } from './messages';
import { runCheck } from './checks/registry';

interface AutorunJob {
  checks: Array<{ name: string; args?: Record<string, unknown> }>;
}

export async function startAutorun(): Promise<void> {
  const base = import.meta.env.WXT_AUTORUN_URL;
  if (!base) return;
  let job: AutorunJob | null = null;
  try {
    const response = await fetch(`${base}/__autorun/job`);
    if (response.status !== 200) return;
    job = (await response.json()) as AutorunJob;
  } catch (error) {
    console.warn('[autorun] no job', error);
    return;
  }
  const reports: CheckReport[] = [];
  for (const { name, args } of job.checks) {
    console.info('[autorun] running', name);
    const report = await runCheck(name, args);
    reports.push(report);
    await post(base, 'progress', report);
  }
  await post(base, 'report', { reports });
}

async function post(base: string, path: string, body: unknown): Promise<void> {
  try {
    await fetch(`${base}/__autorun/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.warn('[autorun] post failed', path, error);
  }
}
