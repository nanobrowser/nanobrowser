// The theme: system, light or dark, applied with Tailwind's `dark` class.
// public/theme-init.js applies the stored choice before first paint; this module keeps it current.
export type ThemePreference = 'system' | 'light' | 'dark';

const KEY = 'nb.theme';
const media = () => matchMedia('(prefers-color-scheme: dark)');

export function storedTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePreference): void {
  try {
    localStorage.setItem(KEY, pref);
  } catch {
    // The class below still applies for this page.
  }
  const dark = pref === 'dark' || (pref === 'system' && media().matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Follows the system's scheme while the preference is "system". */
export function watchSystemTheme(): () => void {
  const listener = () => {
    if (storedTheme() === 'system') applyTheme('system');
  };
  media().addEventListener('change', listener);
  return () => media().removeEventListener('change', listener);
}
