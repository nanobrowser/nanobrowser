import { defineWebExtConfig } from 'wxt';

// `pnpm dev` does not launch a browser; load dist/ unpacked in Chrome instead.
export default defineWebExtConfig({ disabled: true });
