// Unattended checks drive the panel through this hook. It exists only in autorun builds (WXT_AUTORUN_URL set);
// normal builds compile it away, so no message can type into the panel or press its buttons.
// The options page uses the same hook, addressed as 'options'.
export function installTestHook(tabId: number, target: 'panel' | 'options' = 'panel'): void {
  if (!import.meta.env.WXT_AUTORUN_URL) return;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.nbTest !== target || (target === 'panel' && message.tabId !== tabId)) return;
    const input = document.querySelector<HTMLTextAreaElement>('#nb-composer-input');
    switch (message.op) {
      case 'type-send': {
        if (!input) return sendResponse({ ok: false, error: 'no composer' });
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(input, message.text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => {
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          sendResponse({ ok: true });
        }, 50);
        return true;
      }
      case 'click': {
        const button = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
          b =>
            b.getAttribute('aria-label') === message.label ||
            b.innerText
              .trim()
              .split('\n')
              .some(line => line.trim() === message.label),
        );
        // On request, scrolled into view first, as a user would, so a menu it opens is placed where it shows.
        if (message.scroll) button?.scrollIntoView({ block: 'nearest' });
        button?.click();
        return sendResponse({ ok: !!button });
      }
      case 'fill': {
        const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${message.label}"]`);
        if (!field) return sendResponse({ ok: false });
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(field, message.text);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        if (message.submit) field.form?.requestSubmit();
        return sendResponse({ ok: true });
      }
      case 'field': {
        // A field's type, read-only state and value, by its label.
        const field = document.querySelector<HTMLInputElement>(`input[aria-label="${message.label}"]`);
        return sendResponse({
          ok: !!field,
          ...(field ? { type: field.type, readOnly: field.readOnly, value: field.value } : {}),
        });
      }
      case 'drop-files': {
        // Files dropped on the composer, as a user would drag them in.
        const transfer = new DataTransfer();
        for (const f of message.files as Array<{ name: string; type: string; text?: string; base64?: string }>) {
          const body = f.base64 ? Uint8Array.from(atob(f.base64), c => c.charCodeAt(0)) : (f.text ?? '');
          transfer.items.add(new File([body], f.name, { type: f.type }));
        }
        input?.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        return sendResponse({ ok: !!input });
      }
      case 'toggle': {
        // A checkbox in the label whose text starts with `label`.
        const box = [...document.querySelectorAll('label')]
          .find(l => l.innerText.trim().startsWith(message.label))
          ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
        box?.click();
        return sendResponse({ ok: !!box });
      }
      case 'select': {
        const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${message.label}"]`);
        const menu = document.querySelector<HTMLButtonElement>(
          `button[aria-haspopup="menu"][data-label="${message.label}"]`,
        );
        if (!select && menu) {
          // A menu button (the composer's mode or model): open it, then pick the item with that value, a menu item or a
          // pill of the model menu's effort row.
          if (menu.getAttribute('aria-expanded') !== 'true') menu.click();
          setTimeout(() => {
            const item = document.querySelector<HTMLElement>(
              `[role="menuitemradio"][data-value="${message.value}"], [role="radio"][data-value="${message.value}"]`,
            );
            item?.click();
            sendResponse({ ok: !!item });
          }, 50);
          return true;
        }
        if (!select) return sendResponse({ ok: false });
        Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, message.value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return sendResponse({ ok: true });
      }
      case 'key': {
        // A key pressed where the focus is, bubbling to the document as a typed key does.
        const target = (document.activeElement as HTMLElement | null) ?? document.body;
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: message.key,
            ctrlKey: !!message.ctrl,
            metaKey: !!message.meta,
            shiftKey: !!message.shift,
            bubbles: true,
            cancelable: true,
          }),
        );
        return sendResponse({ ok: true, focused: document.activeElement?.id ?? '' });
      }
      case 'layout': {
        const reducedMotion = [...document.styleSheets].some(sheet => {
          try {
            return [...sheet.cssRules].some(
              rule => rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion'),
            );
          } catch {
            return false;
          }
        });
        return sendResponse({
          ok: true,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          reducedMotion,
          live: document.querySelector('[aria-live]')?.textContent ?? null,
          mode: document.querySelector<HTMLElement>('button[data-label="Mode"]')?.dataset.value ?? null,
          composerHeight:
            document.querySelector('#nb-composer-input')?.parentElement?.getBoundingClientRect().height ?? null,
          tabChips: [...document.querySelectorAll<HTMLElement>('[data-role="tab-chips"] > li')].map(li => ({
            text: li.innerText,
            height: li.getBoundingClientRect().height,
          })),
        });
      }
      case 'read':
        return sendResponse({
          ok: true,
          title: document.querySelector('header h1')?.textContent ?? '',
          transcript: document.querySelector<HTMLElement>('[data-role="transcript"]')?.innerText ?? '',
          status: document.querySelector('[role="status"]')?.textContent ?? '',
          body: document.body.innerText,
          dialog: document.querySelector<HTMLElement>('[role="dialog"]')?.innerText ?? '',
          input: input?.value ?? '',
          inputDisabled: input?.disabled ?? null,
          activityImages: document.querySelectorAll('[data-role="activity"] img').length,
          chipImages: document.querySelectorAll('[data-role="chips"] img').length,
          // Icon buttons have no text, so their labels are read separately.
          buttons: [...document.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label')),
          // The open menu's box and the viewport's width, to see that it fits a narrow panel.
          menu: (() => {
            const r = document.querySelector('[role="menu"]')?.getBoundingClientRect();
            const pills = [...document.querySelectorAll('[role="radio"]')].map(p => p.getBoundingClientRect().right);
            return r
              ? {
                  left: r.left,
                  right: Math.max(r.right, ...pills),
                  width: window.innerWidth,
                  top: r.top,
                  bottom: r.bottom,
                  height: window.innerHeight,
                }
              : null;
          })(),
          // The model menu's effort pills, when it is open: their values, the checked one marked.
          pills: [...document.querySelectorAll<HTMLElement>('[role="radio"]')].map(
            b => `${b.dataset.value}${b.getAttribute('aria-checked') === 'true' ? '*' : ''}`,
          ),
          // Disabled buttons by their label, or their text when they have none.
          disabled: [...document.querySelectorAll<HTMLElement>('button:disabled')].map(
            b => b.getAttribute('aria-label') ?? b.innerText,
          ),
        });
    }
  });
}
