# Privacy Policy for Nanobrowser

## Introduction

[Nanobrowser](https://github.com/nanobrowser/nanobrowser) is an open-source AI web automation extension for Chrome and Edge. This Privacy Policy explains how it handles your data.

## Open source

Nanobrowser is licensed under the Apache License 2.0. All source code is public in our [GitHub repository](https://github.com/nanobrowser/nanobrowser), so you can check everything this policy says.

## What stays in your browser

- Nanobrowser runs entirely in your browser. There is no Nanobrowser server, and no account.
- Your conversations, attachments, saved shortcuts, custom instructions, site settings and other settings are stored locally in your browser.
- Your logins and cookies never leave your browser through Nanobrowser.
- The values of password, payment-card and one-time-code fields are hidden from the AI model.

## No analytics

Nanobrowser collects no analytics, telemetry or usage data, and sends nothing to its developers.

## What is sent to the providers you choose

To work, Nanobrowser sends data directly from your browser to the AI providers you set up, and only to them:

- **Your model provider** (for example Anthropic, OpenAI, Google, OpenRouter, or a local server such as Ollama): your messages, your attachments, the content of the tabs the agent works in, and, for models that can see images, screenshots of those tabs.
- **Your voice model provider** (OpenAI or Google), only if you turn on voice input: the audio of each recording. Recordings are not kept.

How these providers handle your data is governed by their own privacy policies. If you use a local model, the data stays on your computer.

## API keys

- You provide your own API keys.
- Keys are stored locally in your browser, and are sent only to their own provider.
- Keys are never included in exports and never written to logs.

## Updating from an earlier version

When Nanobrowser updates from its earlier version, it moves your providers and API keys, your default model, your saved prompts and your blocked sites into the new version, in your browser, and deletes the rest of the earlier version's data. Your earlier conversations are kept in your browser until you export or delete them in Settings → Data; nothing is sent anywhere.

## Your control

- Delete a conversation at any time, or delete all your data in Settings → Data.
- Uninstall the extension to remove all its local data.

## Changes to this policy

We may update this policy. Changes are published in the GitHub repository.

## Contact

Questions or concerns? Contact us at cws@felight.xyz.

Last updated: October 12, 2026
