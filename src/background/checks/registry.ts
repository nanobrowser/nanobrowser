import type { CheckReport, CheckSummary } from '../messages';
import { register } from '../rpc';

export interface Check extends CheckSummary {
  run(args: Record<string, unknown>): Promise<unknown>;
}

const checks = new Map<string, Check>();

export function defineCheck(check: Check): void {
  checks.set(check.name, check);
}

export async function runCheck(name: string, args: Record<string, unknown> = {}): Promise<CheckReport> {
  const check = checks.get(name);
  const startedAt = new Date().toISOString();
  const start = performance.now();
  if (!check) return { name, ok: false, startedAt, durationMs: 0, error: `Unknown check ${name}` };
  try {
    const result = await check.run(args);
    return { name, ok: true, startedAt, durationMs: Math.round(performance.now() - start), result };
  } catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    return { name, ok: false, startedAt, durationMs: Math.round(performance.now() - start), error: message };
  }
}

register('checks.list', async () =>
  [...checks.values()].map(({ name, title, description }) => ({ name, title, description })),
);

register('checks.run', async params => {
  const { name, args } = params as { name: string; args?: Record<string, unknown> };
  return runCheck(name, args);
});
