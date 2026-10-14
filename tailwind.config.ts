import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--nb-${name}) / <alpha-value>)`;

export default {
  content: ['./src/**/*.{ts,tsx}', './entrypoints/**/*.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'nb-canvas': token('canvas'),
        'nb-bg': token('bg'),
        'nb-fg': token('fg'),
        'nb-muted': token('muted'),
        'nb-border': token('border'),
        'nb-surface': token('surface'),
        'nb-accent': token('accent'),
        'nb-accent-strong': token('accent-strong'),
        'nb-sky': token('sky'),
        'nb-link': token('link'),
        'nb-auto': token('auto'),
      },
      // System fonts only, as in the dsh.directory site.
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
          '"Apple Color Emoji"',
          '"Segoe UI Emoji"',
          '"Segoe UI Symbol"',
          '"Noto Color Emoji"',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          '"Liberation Mono"',
          '"Courier New"',
          'monospace',
        ],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(var(--nb-shadow) / 0.06), 0 8px 24px rgb(var(--nb-shadow) / 0.08)',
        pop: '0 2px 6px rgb(var(--nb-shadow) / 0.08), 0 16px 40px rgb(var(--nb-shadow) / 0.16)',
      },
    },
  },
  plugins: [],
} satisfies Config;
