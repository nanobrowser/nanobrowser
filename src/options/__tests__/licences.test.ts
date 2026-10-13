import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LICENCES } from '../licences';

const root = join(import.meta.dirname, '../../..');
const read = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'));

describe('Settings → About', () => {
  it('lists every runtime dependency with the licence its package declares', () => {
    const dependencies = Object.keys(read('package.json').dependencies).sort();
    expect(LICENCES.map(l => l.name).sort()).toEqual(dependencies);
    for (const entry of LICENCES) {
      expect(read(`node_modules/${entry.name}/package.json`).license, entry.name).toBe(entry.licence);
    }
  });
});
