# Contributing to Nanobrowser

Thank you for your interest in contributing to Nanobrowser! Every contribution helps make it better for everyone.

## Quick start

1. Fork and clone the repository.
2. Create a branch (`git checkout -b feature-name`).
3. Make your changes, leaving out the files a pull request may not change (below).
4. Open a pull request.

## What a pull request may not change

These files are left to the maintainers, and a pull request may not change them:

- anywhere in the tree:
  - anything whose name, or the name of a folder it is in, starts with a dot (CI under `.github/`, tool and editor settings), and anything under a `node_modules/` or `vendor/` folder;
  - package manifests and lock files: `package.json`, `package.yaml`, `package.json5`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `composer.json`, `composer.lock`;
  - compiler and tool configs: `tsconfig*.json`, `jsconfig.json`, and any `*.config.*` file;
  - build files and scripts: `Makefile`, `Dockerfile`, `Justfile`, and any shell script (`*.sh`);
  - instructions to AI tools: `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, and any other `.md` file whose name starts with one of those words, such as `CLAUDE.local.md`;
- in this repository:
  - the entrypoints (`entrypoints/`) and WXT's local modules (`modules/`);
  - the fixture server and its scripts and data: the files directly in `fixtures/`, and `fixtures/upgrade/`;
  - script, pages, styles and WebAssembly under `public/` (`.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.xhtml`, `.css`, `.wasm`);
  - the type declarations at the root (`*.d.ts`), `LICENSE`, and `src/ui/manifest-permissions.ts`, the extension's permission list.

Names are matched in any letter case: `Package.JSON` counts as `package.json`.

File names use only ASCII letters, digits and `.`, `_`, `@`, `+`, `-`, and a pull request may not add or change a symlink or change 300 files or more.

A required check, `file-guard`, fails a pull request that changes one of these files, and it is not merged until those files are dropped from it. Everything else may be changed in a pull request, for example the code, styles and data under `src/`, images and locale files under `public/`, the test pages under `fixtures/pages/`, and `README.md`, `CONTRIBUTING.md`, `PRIVACY.md` and `SECURITY.md`. If your change needs one of the maintainers' files, for example a new or updated dependency, a configuration file, an entrypoint, the fixture server or CI, open an issue that describes it, and a maintainer makes that part.

## Local development

Use Node.js 24 LTS (v24.22.1 or higher, see `engines` in `package.json`) and pnpm 10. The exact pnpm version is pinned in `package.json`: run `corepack enable` once, or use `corepack pnpm <script>`, and the pinned version is used.

```bash
corepack enable # skip if pnpm 10 is already installed
pnpm install
pnpm dev
```

Load the repository's `dist/` folder as an unpacked extension in Chrome or Edge (`chrome://extensions` or `edge://extensions`, Developer mode, Load unpacked). WXT rebuilds as you edit and reloads the extension.

| Command               | What it does                                                 |
| --------------------- | ------------------------------------------------------------ |
| `pnpm build`          | Production build into `dist/`                                |
| `pnpm zip`            | Production build, packed into `dist-zip/nanobrowser-<version>.zip` |
| `pnpm type-check`     | TypeScript checks                                            |
| `pnpm lint`           | ESLint, including the import rules between the parts of the code |
| `pnpm test`           | Unit tests                                                   |
| `pnpm prettier`       | Format the repository                                        |
| `pnpm install-chrome` | Install Chrome for Testing for the automated browser checks  |
| `pnpm autorun <check>` | Run browser checks headless against the local test pages, for example `pnpm autorun scenarios` |

Before you open a pull request, make sure `pnpm prettier`, `pnpm lint`, `pnpm type-check` and `pnpm test` pass. CI runs the same checks, and a build, on a pull request once a maintainer approves the run. The browser checks (`pnpm autorun`) are run by maintainers by hand.

[AGENTS.md](AGENTS.md) (also `CLAUDE.md`) describes the layout of the code, the design rules that are not open for change, and the working rules. Please read it before a larger change. It is also the guide for AI coding assistants.

## How can I contribute?

### Reporting bugs

- Search the existing issues first.
- Include a clear description, the steps to reproduce, your environment (OS, browser and its version, Nanobrowser version), the provider and model you used, and screenshots if they help.
- Never include API keys, passwords or other secrets.

### Suggesting enhancements

- Open an issue with a clear title and a detailed description.
- Explain why the enhancement would be useful.

### Code contributions

1. Follow the existing code style (Prettier and ESLint enforce most of it).
2. Keep each pull request to one change.
3. Add unit tests for pure functions, and a test page and scenario for anything that needs a browser.
4. Write clear commit messages in the present tense ("Add feature", not "Added feature").
5. If your change affects what `README.md`, `PRIVACY.md`, `SECURITY.md` or this guide says, update it in the same pull request. For any other document, open an issue.
6. Respond to review comments.

## Security

Please do not report security vulnerabilities in public issues. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the project's [Apache License 2.0](LICENSE).
