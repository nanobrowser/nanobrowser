/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set only for unattended development runs (fixtures/autorun.mjs). */
  readonly WXT_AUTORUN_URL?: string;
  /** The PostHog project key and host; a production build with both sends analytics there. */
  readonly VITE_POSTHOG_API_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
