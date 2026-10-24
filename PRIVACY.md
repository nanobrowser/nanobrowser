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

## What is sent to the Nanobrowser team

Nanobrowser sends its developers only the small amounts of data below. Nothing sent has an ID. The daily count cannot be linked from one day to another, and the usage counts name no one. It never includes your pages, the sites you visit, your messages, your files, your keys or your settings' text.

- **A daily count of users** (on by default; turn it off in Settings → Data → **Anonymous daily count**). At most once a day, on a day you use Nanobrowser: the version, the browser (Chrome, Edge or other), the language of the screens, the week you installed Nanobrowser, whether it is the first time this week and this month, and whether you have set up a model or run a task that day.
- **Usage counts** (on unless you turn them off, on the welcome page or in Settings → Data → **Help improve Nanobrowser**). At most once a day, with the version, the browser and the language of the screens, totals for a past day: how many tasks started, were resumed or continued, and how they ended, how long they were and how much text the model read, which tools ran and which errors happened (as fixed codes), which kind of provider, catalogue model, reasoning effort and mode were used, whether the model can see images, how often features such as attachments, shortcuts, voice input and Retry were used, how often a long conversation was shortened to fit, what you have set up (the kinds of providers, whether the default model runs on your computer, whether voice input and custom instructions are set, how many site rules of each kind you have), and how often confirmation cards were shown, approved or declined, and how often a step was handed to you. If you turned off the "Help improve Nanobrowser" switch of the earlier version, both start off.

This data goes to PostHog, a product analytics service, in the United States. Nanobrowser asks PostHog not to store your IP address or work out your location, and to create no profile of you. The data is kept for one year.

When you remove Nanobrowser, Chrome opens a short optional Google Form that asks why. Nanobrowser fills in nothing in it; you can answer any question or none. Google asks you to sign in, so that each person answers once, but the form does not record who you are.

## What is sent to the providers you choose

To work, Nanobrowser sends data directly from your browser to the AI providers you set up, and only to them:

- **Your model provider** (for example Anthropic, OpenAI, Google, OpenRouter, or a local server such as Ollama): your messages, your attachments, the content of the tabs the agent works in, and, for models that can see images, screenshots of those tabs.
- **Your voice model provider** (OpenAI or Google), only if you turn on voice input: the audio of each recording. Recordings are not kept.
- **Your advisory decision model provider** (TypeSafe's Jev or OpenAI Decisions), only if you select it in Settings → Providers → Decision models: the text and questions the agent supplies to the `decide` tool. This can include page content the agent has read. The tool sends no screenshots or attachments directly, and reads no pages itself. Its answers are stored in the conversation. Calls go directly to the selected service, using the key saved in that card.
- **The optional automatic Jev service** (TypeSafe), only when you enable it in the separate Jev card: the task and relevant bounded page text, proposed action descriptors, recent outcomes and completion claims used to evaluate actions, completion, routing or click proposals. Requests go directly to `https://api.typesafe.ai/v1/systemone`. Its key is sent only to TypeSafe. Automatic Jev is off by default for a new installation.

Before sending automatic Jev evidence, Nanobrowser redacts credential patterns, cookies, URL credentials and query values, sensitive input values, typed action text and serialized form-field values. Redaction is best effort for arbitrary page text and prose. Use pages and tasks whose remaining content may be sent to TypeSafe. No screenshots are sent by this adapter. The advisory `decide` tool sends the supplied text and questions; it does not apply this automatic-evidence redaction pipeline.

Automatic Jev records stored with the conversation retain selected outcomes, confidence, elapsed time, request counts and token usage, with estimated cost only when prices were explicitly supplied. These records do not retain raw Jev response bodies, credentials or page/action payloads, and are not sent as analytics to Nanobrowser's developers.

How these providers handle your data is governed by their own privacy policies. A local conversation model processes its requests on your computer. Optional decision services and cloud voice input still send the data described above to their respective providers.

## API keys

- You provide your own API keys. The Decision models and automatic Jev cards store separate keys, even when both use TypeSafe, independently of conversation-model credentials.
- Keys are stored locally in your browser, and are sent only to their own provider.
- These keys use the extension's existing local storage; it is not an encrypted vault.
- Keys are never included in exports and never written to logs.

## Updating from an earlier version

When Nanobrowser updates from its earlier version, it moves your providers and API keys, your default model, your saved prompts and your blocked sites into the new version, in your browser, and deletes the rest of the earlier version's data. Your earlier conversations are kept in your browser until you export or delete them in Settings → Data; nothing is sent anywhere.

If you update from a Jev prerelease, valid Jev settings and its saved key are migrated locally into the new separate settings/key stores. A previous explicit enabled choice can be retained. The migration itself makes no TypeSafe or LLM requests; malformed legacy data is retained for later recovery rather than used to enable calls.

## Your control

- Delete a conversation at any time, or delete all your data in Settings → Data. Your two choices about what is sent stay as you set them.
- Turn off the daily count and the usage counts at any time in Settings → Data; what was counted and not yet sent is deleted at once.
- Set Decision models to **Off** in Settings → Providers to stop further advisory `decide` calls, or clear that card's saved key.
- Turn off **Enable Jev** in the separate Jev card and save its settings to disable automatic Jev for subsequent runs. These controls are independent; use **Stop** to end a run already in progress.
- Uninstall the extension to remove all its local data.

## Changes to this policy

We may update this policy. Changes are published in the GitHub repository.

## Contact

Questions or concerns? Contact us at cws@felight.xyz.

Last updated: October 22, 2026
