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

How these providers handle your data is governed by their own privacy policies. If you use a local model, the data stays on your computer.

## API keys

- You provide your own API keys.
- Keys are stored locally in your browser, and are sent only to their own provider.
- Keys are never included in exports and never written to logs.

## Updating from an earlier version

When Nanobrowser updates from its earlier version, it moves your providers and API keys, your default model, your saved prompts and your blocked sites into the new version, in your browser, and deletes the rest of the earlier version's data. Your earlier conversations are kept in your browser until you export or delete them in Settings → Data; nothing is sent anywhere.

## Your control

- Delete a conversation at any time, or delete all your data in Settings → Data. Your two choices about what is sent stay as you set them.
- Turn off the daily count and the usage counts at any time in Settings → Data; what was counted and not yet sent is deleted at once.
- Uninstall the extension to remove all its local data.

## Changes to this policy

We may update this policy. Changes are published in the GitHub repository.

## Contact

Questions or concerns? Contact us at cws@felight.xyz.

Last updated: October 13, 2026
