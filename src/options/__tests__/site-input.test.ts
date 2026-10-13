import { describe, expect, it } from 'vitest';
import { siteOf } from '@src/browser-control';
import { siteFromInput } from '../PermissionsSection';

describe('a site typed in Settings → Permissions', () => {
  it('gets the same key as the layer gives the address', () => {
    for (const address of [
      'https://www.Example.com/path',
      'http://shop.example.co.uk.',
      'https://localhost:8787/x',
      'http://127.0.0.1:80/',
      'https://[::1]:8443/',
    ]) {
      expect(siteFromInput(address)).toBe(siteOf(address));
    }
  });

  it('takes a bare host', () => {
    expect(siteFromInput('www.dell.com')).toBe('dell.com');
    expect(siteFromInput('localhost:8787')).toBe('localhost:8787');
    expect(siteFromInput('  ')).toBe('');
    expect(siteFromInput('not a host')).toBe('');
  });
});
