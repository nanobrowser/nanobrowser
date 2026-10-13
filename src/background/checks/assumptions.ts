// One check per assumption the layer is built on. Each returns { holds, detail }.
import { listFrames, PAGE_SESSION_ALIAS, sendRaw } from '@src/browser-control';
import type { FrameInfo } from '@src/browser-control';
import { FIXTURE_CROSS_ORIGIN, FIXTURE_ORIGIN, FIXTURE_PORT } from '../fixtures-config';
import { call } from '../rpc';
import { connectionFor } from '../spike-session';
import { defineCheck } from './registry';
import { countOf, evaluate, readRequests, resetRequests, sleep, waitForLoad, withTab } from './helpers';

interface Row {
  holds: boolean;
  detail: unknown;
}

type Send = <T = unknown>(
  sessionId: string | undefined,
  method: string,
  params?: Record<string, unknown>,
) => Promise<T>;

interface AXNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  backendDOMNodeId?: number;
}

async function attach(tabId: number): Promise<{ send: Send; frames: FrameInfo[] }> {
  await call('session.attach', { tabId });
  await sleep(800);
  const send: Send = (sessionId, method, params = {}) => sendRaw(tabId, sessionId, method, params, 10_000);
  const frames = listFrames(connectionFor(tabId).page);
  for (const sessionId of new Set(frames.map(f => f.sessionId))) {
    await send(sessionId, 'DOM.enable');
    await send(sessionId, 'Accessibility.enable');
  }
  return { send, frames };
}

async function axFind(send: Send, frame: FrameInfo, role: string, name: string): Promise<number> {
  const { nodes } = await send<{ nodes: AXNode[] }>(frame.sessionId, 'Accessibility.getFullAXTree', {
    frameId: frame.frameId,
  });
  const node = nodes.find(n => !n.ignored && n.role?.value === role && n.name?.value === name);
  if (!node?.backendDOMNodeId) throw new Error(`no ${role} "${name}" in ${frame.url}`);
  return node.backendDOMNodeId;
}

async function center(send: Send, sessionId: string, backendNodeId: number): Promise<{ x: number; y: number }> {
  const { quads } = await send<{ quads: number[][] }>(sessionId, 'DOM.getContentQuads', { backendNodeId });
  const q = quads[0];
  return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
}

/** The layout viewport's scroll offset of the session's root frame. */
async function scrollOffset(send: Send, sessionId: string): Promise<{ x: number; y: number }> {
  const m = await send<{ cssLayoutViewport: { pageX: number; pageY: number } }>(sessionId, 'Page.getLayoutMetrics');
  return { x: m.cssLayoutViewport.pageX, y: m.cssLayoutViewport.pageY };
}

/**
 * Hit test at a viewport point. DOM.getNodeForLocation takes document coordinates while getContentQuads and
 * Input.dispatchMouseEvent use viewport coordinates, so the scroll offset is added.
 */
async function nodeAtViewportPoint(send: Send, sessionId: string, x: number, y: number) {
  const offset = await scrollOffset(send, sessionId);
  return nodeAt(send, sessionId, x + offset.x, y + offset.y);
}

async function nodeAt(send: Send, sessionId: string, x: number, y: number) {
  return send<{ backendNodeId: number; frameId: string }>(sessionId, 'DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
    ignorePointerEventsNone: false,
  });
}

/** True when `hit` is `target` or inside it (same session). */
async function isInside(send: Send, sessionId: string, target: number, hit: number): Promise<boolean> {
  if (target === hit) return true;
  const t = await send<{ object: { objectId: string } }>(sessionId, 'DOM.resolveNode', { backendNodeId: target });
  const h = await send<{ object: { objectId: string } }>(sessionId, 'DOM.resolveNode', { backendNodeId: hit });
  const { result } = await send<{ result: { value: boolean } }>(sessionId, 'Runtime.callFunctionOn', {
    objectId: t.object.objectId,
    functionDeclaration: 'function (h) { return this.contains(h); }',
    arguments: [{ objectId: h.object.objectId }],
    returnByValue: true,
  });
  return result.value;
}

/** Converts a point in `child`'s viewport to its parent frame's session coordinates. */
async function toParent(send: Send, frames: FrameInfo[], child: FrameInfo, p: { x: number; y: number }) {
  const parent = frames.find(f => f.frameId === child.parentFrameId)!;
  const { backendNodeId } = await send<{ backendNodeId: number }>(parent.sessionId, 'DOM.getFrameOwner', {
    frameId: child.frameId,
  });
  const { model } = await send<{ model: { content: number[] } }>(parent.sessionId, 'DOM.getBoxModel', {
    backendNodeId,
  });
  const metrics = await send<{ cssLayoutViewport: { clientWidth: number; clientHeight: number } }>(
    child.sessionId,
    'Page.getLayoutMetrics',
  );
  const c = model.content;
  const width = c[2] - c[0];
  const height = c[5] - c[1];
  return {
    parent,
    owner: backendNodeId,
    point: {
      x: c[0] + (p.x * width) / metrics.cssLayoutViewport.clientWidth,
      y: c[1] + (p.y * height) / metrics.cssLayoutViewport.clientHeight,
    },
  };
}

async function click(send: Send, p: { x: number; y: number }) {
  const base = { x: p.x, y: p.y, button: 'left', clickCount: 1 };
  await send(undefined, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send(undefined, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...base });
  await send(undefined, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...base });
}

const ASSUMPTIONS = `${FIXTURE_ORIGIN}/assumptions.html`;
const NESTED = `${FIXTURE_ORIGIN}/frames-nested.html`;

const tests: Record<string, () => Promise<Row>> = {
  // 1. A backendNodeId stays valid for the node's lifetime, across captures and same-document navigation.
  async backendNodeIdStable() {
    return withTab(ASSUMPTIONS, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const main = frames[0];
      const first = await axFind(send, main, 'button', 'Counted button');
      const second = await axFind(send, main, 'button', 'Counted button');
      await evaluate(
        tab.tabId,
        undefined,
        `history.pushState({}, '', '#moved'); document.body.prepend(document.createElement('div')); 1`,
      );
      await sleep(100);
      const third = await axFind(send, main, 'button', 'Counted button');
      const resolved = await send<{ object: { description?: string } }>(undefined, 'DOM.resolveNode', {
        backendNodeId: first,
      });
      // Detach and re-insert the same node object: still the same node.
      await evaluate(
        tab.tabId,
        undefined,
        `(() => { const b = document.getElementById('counted'); const p = b.parentNode; b.remove(); p.append(b); })()`,
      );
      const fourth = await axFind(send, main, 'button', 'Counted button');
      // A new document: the old ID must not resolve to the new document's button.
      const load = waitForLoad(tab.tabId);
      await evaluate(tab.tabId, undefined, `location.reload()`);
      await load;
      await sleep(300);
      let afterReload: string;
      try {
        const r = await send<{ object: { description?: string } }>(undefined, 'DOM.resolveNode', {
          backendNodeId: first,
        });
        afterReload = `resolved to ${r.object.description}`;
      } catch (e) {
        afterReload = `failed: ${String(e)}`;
      }
      const newId = await axFind(send, main, 'button', 'Counted button');
      return {
        holds: first === second && second === third && third === fourth && resolved.object.description !== undefined,
        detail: {
          first,
          second,
          afterPushState: third,
          afterReinsert: fourth,
          resolved: resolved.object.description,
          afterReload,
          newDocumentId: newId,
        },
      };
    });
  },

  // 2. getContentQuads and getNodeForLocation share coordinates within a session, same-process iframes included.
  async quadsAndHitTestShareSpace() {
    return withTab(ASSUMPTIONS, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const main = frames[0];
      const inner = frames.find(f => f.url.endsWith('/assumptions-inner.html'))!;
      const results: Record<string, unknown> = { innerFrameSession: inner.sessionId };
      let holds = inner.sessionId === main.sessionId;
      let fallbackHolds = holds;
      // Unscrolled, then scrolled so that only the bottom button is in view: both calls use viewport coordinates.
      const cases = [
        { scroll: 0, frame: main, name: 'Counted button' },
        { scroll: 0, frame: inner, name: 'Inner button' },
        { scroll: 1500, frame: main, name: 'Bottom button' },
      ];
      for (const { scroll, frame, name } of cases) {
        await evaluate(tab.tabId, undefined, `window.scrollTo(0, ${scroll}); 1`);
        await sleep(100);
        const target = await axFind(send, frame, 'button', name);
        const p = await center(send, main.sessionId, target);
        const viewport = await evaluate<{ scrollX: number; scrollY: number }>(
          tab.tabId,
          undefined,
          `({ scrollX, scrollY, innerHeight, innerWidth })`,
        );
        // The fallback: add the layout viewport's scroll offset (Page.getLayoutMetrics) before hit-testing.
        let withScrollOffset: { hit?: number; inside: boolean; error?: string };
        try {
          const d = await nodeAtViewportPoint(send, main.sessionId, p.x, p.y);
          withScrollOffset = {
            hit: d.backendNodeId,
            inside: await isInside(send, main.sessionId, target, d.backendNodeId),
          };
        } catch (e) {
          withScrollOffset = { inside: false, error: String(e) };
        }
        fallbackHolds &&= withScrollOffset.inside;
        let hit: { backendNodeId: number; frameId: string };
        try {
          hit = await nodeAt(send, main.sessionId, p.x, p.y);
        } catch (e) {
          results[`${name}@${scroll}`] = { point: p, viewport, error: String(e), withScrollOffset };
          holds = false;
          continue;
        }
        const inside = await isInside(send, main.sessionId, target, hit.backendNodeId);
        results[`${name}@${scroll}`] = {
          point: p,
          viewport,
          target,
          hit: hit.backendNodeId,
          hitFrame: hit.frameId,
          inside,
          withScrollOffset,
        };
        holds &&= inside;
      }
      return { holds, detail: { fallbackHolds, ...results } };
    });
  },

  // 3. A point in an out-of-process frame converts to the parent's coordinates through the owner's content quad,
  //    and the parent's hit test there returns the owner iframe element. 4. Mouse input on the root session at
  //    the converted top-level point reaches the out-of-process frame.
  async oopifConversionAndRouting() {
    return withTab(NESTED, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const grandchild = frames.find(f => f.depth === 2)!;
      const target = await axFind(send, grandchild, 'button', 'Grandchild button');
      let point = await center(send, grandchild.sessionId, target);
      const local = await nodeAt(send, grandchild.sessionId, point.x, point.y);
      const steps: unknown[] = [{ frame: grandchild.url, point, hit: local.backendNodeId, target }];
      let conversion = local.backendNodeId === target;
      let frame = grandchild;
      while (frame.parentFrameId) {
        const up = await toParent(send, frames, frame, point);
        const hit = await nodeAt(send, up.parent.sessionId, up.point.x, up.point.y);
        steps.push({ frame: up.parent.url, point: up.point, owner: up.owner, hit: hit.backendNodeId });
        conversion &&= hit.backendNodeId === up.owner;
        frame = up.parent;
        point = up.point;
      }
      await click(send, point);
      await sleep(200);
      const text = await evaluate<string>(
        tab.tabId,
        grandchild.sessionId,
        `document.getElementById('grandchild-button').textContent`,
      );
      return {
        holds: conversion && text === 'Clicked',
        detail: { conversion, routedClick: text === 'Clicked', buttonText: text, steps },
      };
    });
  },

  // 3 and 4 again, with the parent page scrolled: the owner's quad is in viewport coordinates, the parent's
  // hit test needs the scroll offset added, and the click goes to the viewport point.
  async oopifScrolledConversion() {
    return withTab(ASSUMPTIONS, async tab => {
      const { send, frames } = await attach(tab.tabId);
      await evaluate(tab.tabId, undefined, `window.scrollTo(0, 1500); 1`);
      await sleep(200);
      const cross = frames.find(f => f.url.startsWith(`${FIXTURE_CROSS_ORIGIN}/assumptions-inner.html`))!;
      const target = await axFind(send, cross, 'button', 'Inner button');
      const local = await center(send, cross.sessionId, target);
      const localHit = await nodeAtViewportPoint(send, cross.sessionId, local.x, local.y);
      const up = await toParent(send, frames, cross, local);
      const parentHit = await nodeAtViewportPoint(send, up.parent.sessionId, up.point.x, up.point.y);
      await click(send, up.point);
      await sleep(200);
      const text = await evaluate<string>(
        tab.tabId,
        cross.sessionId,
        `document.getElementById('inner-button').textContent`,
      );
      const conversion = localHit.backendNodeId === target && parentHit.backendNodeId === up.owner;
      return {
        holds: conversion && text === 'Inner clicked',
        detail: {
          ownSession: cross.sessionId !== PAGE_SESSION_ALIAS,
          local,
          parentPoint: up.point,
          owner: up.owner,
          parentHit: parentHit.backendNodeId,
          conversion,
          text,
        },
      };
    });
  },

  // 5. getPartialAXTree for a backend node returns the same role and name as the full tree for an unchanged node.
  async partialMatchesFull() {
    const urls = [ASSUMPTIONS, NESTED, `${FIXTURE_ORIGIN}/shadow-closed.html`];
    const mismatches: unknown[] = [];
    let compared = 0;
    for (const url of urls) {
      await withTab(url, async tab => {
        const { send, frames } = await attach(tab.tabId);
        for (const frame of frames) {
          const { nodes } = await send<{ nodes: AXNode[] }>(frame.sessionId, 'Accessibility.getFullAXTree', {
            frameId: frame.frameId,
          });
          for (const node of nodes) {
            if (node.ignored || !node.backendDOMNodeId || !node.role?.value) continue;
            if (['StaticText', 'InlineTextBox', 'LineBreak'].includes(node.role.value)) continue;
            const partial = await send<{ nodes: AXNode[] }>(frame.sessionId, 'Accessibility.getPartialAXTree', {
              backendNodeId: node.backendDOMNodeId,
              fetchRelatives: false,
            });
            const p = partial.nodes.find(n => n.backendDOMNodeId === node.backendDOMNodeId && !n.ignored);
            compared++;
            if (p?.role?.value !== node.role.value || (p?.name?.value ?? '') !== (node.name?.value ?? '')) {
              mismatches.push({
                url: frame.url,
                full: [node.role.value, node.name?.value],
                partial: [p?.role?.value, p?.name?.value],
              });
            }
          }
        }
      });
    }
    return {
      holds: mismatches.length === 0 && compared > 0,
      detail: { compared, mismatches: mismatches.slice(0, 20) },
    };
  },

  // 6. A capture-phase window listener in an isolated world sees trusted pointer and beforeinput events and can
  //    cancel them before page handlers on elements run.
  async isolatedGuardCancels() {
    return withTab(ASSUMPTIONS, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const main = frames[0];
      const { executionContextId } = await send<{ executionContextId: number }>(undefined, 'Page.createIsolatedWorld', {
        frameId: main.frameId,
        worldName: 'nb3-assumption-probe',
      });
      await send(undefined, 'Runtime.evaluate', {
        contextId: executionContextId,
        expression: `
          window.__guard = { seen: [] };
          for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'beforeinput', 'keydown']) {
            window.addEventListener(type, e => {
              window.__guard.seen.push(type + ':' + e.isTrusted);
              e.preventDefault();
              e.stopImmediatePropagation();
            }, true);
          }
          1`,
      });
      const targets: Record<string, number> = {
        button: await axFind(send, main, 'button', 'Counted button'),
        link: await axFind(send, main, 'link', 'Guarded link'),
        checkbox: await axFind(send, main, 'checkbox', 'Guarded checkbox'),
      };
      for (const id of Object.values(targets)) await click(send, await center(send, main.sessionId, id));
      await evaluate(tab.tabId, undefined, `document.getElementById('text').focus(); 1`);
      await send(undefined, 'Input.insertText', { text: 'abc' });
      await sleep(200);
      const page = await evaluate<{ counts: Record<string, number>; hash: string; checked: boolean; value: string }>(
        tab.tabId,
        undefined,
        `({ counts: window.counts, hash: location.hash, checked: document.getElementById('guard-check').checked, value: document.getElementById('text').value })`,
      );
      const { result } = await send<{ result: { value: string[] } }>(undefined, 'Runtime.evaluate', {
        contextId: executionContextId,
        expression: 'window.__guard.seen',
        returnByValue: true,
      });
      const pageHandlersRan = Object.values(page.counts).some(n => n > 0);
      const allTrusted = result.value.every(s => s.endsWith(':true'));
      return {
        holds:
          !pageHandlersRan &&
          allTrusted &&
          page.hash === '' &&
          !page.checked &&
          page.value === '' &&
          result.value.includes('beforeinput:true'),
        detail: { page, guardSaw: result.value },
      };
    });
  },

  // 7. Fetch interception of document requests coexists with Puppeteer, and every redirect hop is paused again.
  async fetchInterceptsRedirectHops() {
    const outcomes: Record<string, unknown> = {};
    let holds = true;
    for (const errorReason of ['BlockedByClient', 'Aborted']) {
      await resetRequests();
      const outcome = await withTab(`${FIXTURE_ORIGIN}/network.html`, async tab => {
        const { send, frames } = await attach(tab.tabId);
        const paused: Array<{ url: string; frameId: string; decision: string }> = [];
        const listener = (source: chrome.debugger.Debuggee, method: string, params?: object) => {
          if (source.tabId !== tab.tabId || method !== 'Fetch.requestPaused') return;
          const event = params as { requestId: string; request: { url: string }; frameId: string };
          const deny = event.request.url.startsWith(FIXTURE_CROSS_ORIGIN);
          paused.push({ url: event.request.url, frameId: event.frameId, decision: deny ? errorReason : 'continue' });
          void sendRaw(
            tab.tabId,
            undefined,
            deny ? 'Fetch.failRequest' : 'Fetch.continueRequest',
            deny ? { requestId: event.requestId, errorReason } : { requestId: event.requestId },
          );
        };
        chrome.debugger.onEvent.addListener(listener);
        try {
          await send(undefined, 'Fetch.enable', { patterns: [{ resourceType: 'Document', requestStage: 'Request' }] });
          await evaluate(
            tab.tabId,
            undefined,
            `location.href = '/redirect?to=${encodeURIComponent(`${FIXTURE_CROSS_ORIGIN}/network-landed.html`)}'; 1`,
          );
          await sleep(1500);
          // Puppeteer must still be tracking the page: its main frame URL and our frame list.
          const puppeteerUrl = connectionFor(tab.tabId).page.url();
          const tabNow = await chrome.tabs.get(tab.tabId);
          const allowed = await (async () => {
            const load = waitForLoad(tab.tabId);
            await evaluate(tab.tabId, undefined, `location.href = '/network-landed.html'; 1`).catch(() => undefined);
            return (await load).url;
          })();
          await send(undefined, 'Fetch.disable');
          return {
            paused,
            tabUrlAfterBlock: tabNow.url,
            puppeteerUrlAfterBlock: puppeteerUrl,
            allowedNavigationLanded: allowed,
            mainFrameId: frames[0].frameId,
          };
        } finally {
          chrome.debugger.onEvent.removeListener(listener);
        }
      });
      const counters = await readRequests();
      const reachedDenied = countOf(counters, 'GET', '/network-landed.html', `127.0.0.1:${FIXTURE_PORT}`);
      const hops = outcome.paused.map(p => p.url);
      // Nothing may reach the denied host, and every hop must be paused. With 'Aborted' the page must also stay
      // and Puppeteer keep working; 'BlockedByClient' is recorded for comparison (Chrome commits an error page).
      const blocked =
        reachedDenied === 0 &&
        hops.some(u => u.includes('/redirect')) &&
        hops.some(u => u.startsWith(FIXTURE_CROSS_ORIGIN));
      const pageStayed =
        outcome.tabUrlAfterBlock === `${FIXTURE_ORIGIN}/network.html` &&
        outcome.puppeteerUrlAfterBlock === `${FIXTURE_ORIGIN}/network.html` &&
        outcome.allowedNavigationLanded === `${FIXTURE_ORIGIN}/network-landed.html`;
      const ok = blocked && (errorReason === 'BlockedByClient' || pageStayed);
      holds &&= ok;
      outcomes[errorReason] = { ...outcome, reachedDenied, blocked, pageStayed };
    }
    return { holds, detail: outcomes };
  },

  // 8. Input.insertText and key events on the root session reach the focused element inside an out-of-process frame.
  async keyboardIntoOopif() {
    return withTab(NESTED, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const child = frames.find(f => f.depth === 1)!;
      const field = await axFind(send, child, 'textbox', 'Child field');
      await evaluate(tab.tabId, child.sessionId, `document.querySelector('input').value = ''; 1`);
      const local = await center(send, child.sessionId, field);
      const up = await toParent(send, frames, child, local);
      await click(send, up.point);
      await sleep(100);
      const focused = await evaluate<boolean>(
        tab.tabId,
        child.sessionId,
        `document.activeElement === document.querySelector('input')`,
      );
      await send(undefined, 'Input.insertText', { text: 'hello' });
      await send(undefined, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'X',
        code: 'KeyX',
        text: 'X',
        windowsVirtualKeyCode: 88,
      });
      await send(undefined, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'X',
        code: 'KeyX',
        windowsVirtualKeyCode: 88,
      });
      await sleep(100);
      const value = await evaluate<string>(tab.tabId, child.sessionId, `document.querySelector('input').value`);
      return { holds: focused && value === 'helloX', detail: { focusedByClick: focused, value } };
    });
  },

  // 9. DOM.resolveNode with an isolated world's executionContextId works for nodes in closed shadow roots.
  async isolatedHandleInClosedShadow() {
    return withTab(`${FIXTURE_ORIGIN}/shadow-closed.html`, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const main = frames[0];
      const button = await axFind(send, main, 'button', 'Shadow button');
      const { executionContextId } = await send<{ executionContextId: number }>(undefined, 'Page.createIsolatedWorld', {
        frameId: main.frameId,
        worldName: 'nb3-assumption-probe',
      });
      const { object } = await send<{ object: { objectId: string } }>(undefined, 'DOM.resolveNode', {
        backendNodeId: button,
        executionContextId,
      });
      const { result } = await send<{ result: { value: unknown } }>(undefined, 'Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration:
          'function () { const r = this.getRootNode(); return { text: this.textContent, mode: r.mode, host: r.host && r.host.localName, visible: this.checkVisibility() }; }',
        returnByValue: true,
      });
      const v = result.value as { text: string; mode: string; host: string };
      return { holds: v.text === 'Shadow button' && v.mode === 'closed', detail: v };
    });
  },

  // 11. Attaching chrome.debugger does not set navigator.webdriver.
  async webdriverUnset() {
    return withTab(ASSUMPTIONS, async tab => {
      await attach(tab.tabId);
      const webdriver = await evaluate<unknown>(tab.tabId, undefined, 'navigator.webdriver');
      return { holds: webdriver === false || webdriver === undefined, detail: { webdriver } };
    });
  },

  // The internal Puppeteer accessors FrameTopology reads, compared with Page.getFrameTree.
  async puppeteerAccessors() {
    return withTab(NESTED, async tab => {
      const { send, frames } = await attach(tab.tabId);
      const rows = [];
      let idsAgree = true;
      let loaderIdsSet = true;
      for (const frame of frames) {
        const { frameTree } = await send<{ frameTree: { frame: { id: string; loaderId: string; parentId?: string } } }>(
          frame.sessionId,
          'Page.getFrameTree',
        );
        idsAgree &&=
          frameTree.frame.id === frame.frameId && (frameTree.frame.parentId ?? undefined) === frame.parentFrameId;
        loaderIdsSet &&= frame.loaderId === frameTree.frame.loaderId;
        rows.push({
          frameId: frame.frameId,
          session: frame.sessionId === PAGE_SESSION_ALIAS ? 'root' : frame.sessionId,
          puppeteerLoaderId: frame.loaderId,
          treeLoaderId: frameTree.frame.loaderId,
        });
      }
      // After a navigation Puppeteer has seen the lifecycle event, so its loader ID should be set.
      const load = waitForLoad(tab.tabId);
      await evaluate(tab.tabId, undefined, `location.reload()`);
      await load;
      await sleep(1000);
      const after = listFrames(connectionFor(tab.tabId).page);
      const { frameTree } = await send<{ frameTree: { frame: { loaderId: string } } }>(undefined, 'Page.getFrameTree');
      return {
        holds: idsAgree && loaderIdsSet,
        detail: {
          idsAgree,
          loaderIdsSet,
          frames: rows,
          afterNavigation: { puppeteerLoaderId: after[0].loaderId, treeLoaderId: frameTree.frame.loaderId },
        },
      };
    });
  },
};

defineCheck({
  name: 'assumptions',
  title: 'Assumptions of the layer',
  description:
    'Runs one check per assumption on the fixture pages and reports holds or does not hold with details. Arguments: {"only": ["name", ...]}.',
  async run(args) {
    const only = args.only as string[] | undefined;
    const results: Record<string, Row | { holds: false; error: string }> = {};
    for (const [name, test] of Object.entries(tests)) {
      if (only && !only.includes(name)) continue;
      try {
        results[name] = await test();
      } catch (error) {
        results[name] = {
          holds: false,
          error: error instanceof Error ? `${error.message}\n${error.stack}` : String(error),
        };
      }
    }
    return results;
  },
});
