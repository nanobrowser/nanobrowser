// The manifest's permission lists. The product must not require a permission that adds an install warning the old
// Nanobrowser did not have, or Chrome turns it off on update until the user accepts; the autorun build requires them,
// so its checks run without a click.
import { describe, expect, it } from 'vitest';
import { OPTIONAL_PERMISSIONS, permissionLists } from '../manifest-permissions';

const FOUR = ['tabGroups', 'notifications', 'downloads', 'downloads.open'];

describe('manifest permission lists', () => {
  it('the product makes the four optional and requires none of them', () => {
    const product = permissionLists('product');
    expect([...OPTIONAL_PERMISSIONS].sort()).toEqual([...FOUR].sort());
    for (const p of FOUR) expect(product.permissions).not.toContain(p);
    expect([...product.optional_permissions].sort()).toEqual([...FOUR].sort());
  });

  it('the product asks for neither scripting nor activeTab', () => {
    const product = permissionLists('product');
    for (const p of ['scripting', 'activeTab']) {
      expect(product.permissions).not.toContain(p);
      expect(product.optional_permissions).not.toContain(p);
    }
  });

  it('the autorun build requires the four and has nothing optional', () => {
    const autorun = permissionLists('autorun');
    for (const p of FOUR) expect(autorun.permissions).toContain(p);
    expect(autorun.optional_permissions).toEqual([]);
  });

  it('both builds require the same other permissions', () => {
    const others = (list: string[]) => list.filter(p => !FOUR.includes(p)).sort();
    expect(others(permissionLists('product').permissions)).toEqual(others(permissionLists('autorun').permissions));
  });
});
