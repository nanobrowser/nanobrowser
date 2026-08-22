# WebMCP support

Nanobrowser can use tools that a website declares for agents through the
[WebMCP](https://github.com/webmachinelearning/webmcp) proposal (the Web Model Context API,
`navigator.modelContext`).

Instead of guessing which button to click, the Navigator agent sees the tools the page itself
publishes - `add_to_cart`, `search_products`, `apply_filter` - and calls them directly. That is
both cheaper (no screenshot round trips, fewer steps) and far more reliable than driving a UI.

The feature is **off by default**. Turn it on under **Settings → General → Enable Page Tools
(WebMCP)**.

## How a site declares tools

```js
navigator.modelContext.provideContext({
  tools: [
    {
      name: 'add_to_cart',
      description: 'Add a product to the shopping cart',
      inputSchema: {
        type: 'object',
        properties: {
          sku: { type: 'string' },
          quantity: { type: 'number' },
        },
        required: ['sku'],
      },
      async execute({ sku, quantity = 1 }) {
        await cart.add(sku, quantity);
        return { content: [{ type: 'text', text: `Added ${quantity} x ${sku}` }] };
      },
    },
  ],
});
```

`navigator.modelContext.registerTool(tool)` is also supported for adding a single tool; it
returns a handle with an `unregister()` method.

## How it works

```
page (MAIN world)                background service worker
─────────────────────            ─────────────────────────
navigator.modelContext
        │ provideContext / registerTool
        ▼
webmcpBridge.js  ◄───── CDP evaluate ─────  Page.getWebMCPTools()
  tool registry  ─────  descriptors  ────►  prompt "Page tools" section
        │        ◄───── CDP evaluate ─────  Page.callWebMCPTool()
   tool.execute() ────  result  ─────────►  call_page_tool action result
```

1. `chrome-extension/public/webmcpBridge.js` is registered as a dynamic content script that runs
   in the page's **MAIN world at `document_start`**, so it is in place before any page script
   calls `navigator.modelContext`. It provides the API when the browser has none and wraps a
   native implementation when it does; either way every declaration is mirrored into a registry
   on `window.__nanobrowserWebMCP__`.
2. The background reads that registry over the Puppeteer/CDP connection it already holds for the
   tab (`Page.getWebMCPTools()`), and lists the tools in the browser-state message the Navigator
   sees each step.
3. When the model picks one, the `call_page_tool` action invokes it through the same channel and
   feeds the result back as the action result.

The bridge is only registered while the setting is on - with WebMCP disabled, nothing is injected
into any page.

## Security model

Page tools are declared by the page, so everything about them is untrusted input:

- Tool names, descriptions and results are wrapped in `<nano_untrusted_content>` and pass through
  the same guardrails sanitizer as page content.
- Tool names are restricted to `[A-Za-z0-9_.:-]` so a page cannot smuggle prompt syntax through a
  name, and duplicates are dropped.
- A page can advertise at most 30 tools, and names, descriptions, schemas and results are all
  length-capped before they reach the model.
- `call_page_tool` re-reads the declared tools and refuses any name the current page does not
  actually declare, so a hallucinated or stale name fails instead of reaching the page.
- A tool call that never settles is abandoned after 30 seconds.

A page tool can still do anything the page itself can do, on the user's behalf and with the
user's cookies - the same as a click the agent performs. Treat enabling WebMCP as granting pages
a more direct way to be automated, not as a sandbox.

## Limitations

- Only the top-level document is considered; tools declared inside iframes are ignored.
- A tab that was already open when you enabled the setting gets the bridge injected late, so
  tools that page declared before that point are not visible until it reloads.
- The proposal is still a draft. The bridge accepts both `inputSchema` and the older `params`
  field, and tolerates results that are plain values rather than MCP `content` arrays.

## Code map

| Path | Purpose |
| --- | --- |
| `chrome-extension/public/webmcpBridge.js` | MAIN-world polyfill and tool registry |
| `chrome-extension/src/background/browser/webmcp/inject.ts` | Registers/injects the bridge |
| `chrome-extension/src/background/browser/webmcp/service.ts` | Normalizing and formatting helpers |
| `chrome-extension/src/background/browser/webmcp/types.ts` | Shared types and limits |
| `chrome-extension/src/background/browser/page.ts` | `getWebMCPTools()` / `callWebMCPTool()` |
| `chrome-extension/src/background/agent/actions/builder.ts` | The `call_page_tool` action |
| `chrome-extension/src/background/agent/prompts/base.ts` | "Page tools" section of the state message |
