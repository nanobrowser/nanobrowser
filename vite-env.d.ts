/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set only for unattended development runs (fixtures/autorun.mjs). */
  readonly WXT_AUTORUN_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
