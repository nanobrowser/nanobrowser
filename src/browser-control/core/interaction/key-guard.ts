// The guard of a key sequence: every key and insertion of `set`, `type` and `press` must arrive at the element that was
// classified and approved. The text guard in the target's frame cancels events that reach anything else in that
// document; an away guard in every other frame cancels keys that reach another document. The controller sends one key
// or insertion at a time and, between two, checks that the previous one arrived at the target, that nothing was
// cancelled and that focus is still on the target, and renews the guards. A failed check stops the sequence: nothing
// more is sent. With nothing focused, the keys go to the body, and the document guard keeps them there. Keys are sent
// one event at a time (KeyPresser), so a dialog stops a chord between its modifier and its key, and the release of a
// key that activates on release is judged before it is sent.
import { LayerError } from '../../protocol/errors';
import type { GuardReport, GuardStep } from '../../probe';
import type { ToolContext } from '../controller';
import type { FrameRecord, PagePort } from '../ports';
import type { DialogInfo } from './pointer';
import { watchDialog } from './pointer';
import { releaseActivates } from './keys';
import { sendWithheld } from './withheld';
import { quote } from '../text';

/** A guard lasts this long after the last renewal. */
const LIFETIME_MS = 4_000;
/** Away guards are renewed this often during a long sequence. */
const AWAY_RENEW_MS = 2_000;

/** The element keys must go to; without an object, the body of a frame's document (nothing has focus). */
export interface GuardedElement {
  frame: FrameRecord;
  objectId?: string;
  backendNodeId?: number;
  description: string;
}

export interface KeyGuardOptions {
  /** Says how far the sequence got, from the number of units that arrived and were sent, for the error. */
  progress: (arrived: number, sent: number) => string;
  /** Input already reached the page before the first key (the field was clicked to focus it). */
  delivered: boolean;
}

export class KeyGuard {
  #sent = 0;
  #arrived = 0;
  /** Keydowns and insertions the target accepted, at the last confirmed unit and as last read. */
  #accepted = 0;
  #acceptedSeen = 0;
  #awayRenewed = performance.now();
  #dialog: DialogInfo | undefined;
  /** The command a dialog interrupted; it completes when the dialog closes. */
  #outstanding: Promise<void> | undefined;

  private constructor(
    private readonly ctx: ToolContext,
    private readonly target: GuardedElement,
    private readonly away: FrameRecord[],
    private readonly options: KeyGuardOptions,
    private readonly watch: ReturnType<typeof watchDialog>,
  ) {}

  /** Arms the text guard on the element and an away guard in every other frame of the tab. */
  static async arm(ctx: ToolContext, target: GuardedElement, options: KeyGuardOptions): Promise<KeyGuard> {
    const { cdp, topology } = await ctx.attach();
    const probe = ctx.tab().probe!;
    if (target.objectId) await probe.call(target.frame, target.objectId, 'armGuard', 'text', LIFETIME_MS);
    else await probe.callGlobal(target.frame, 'armDocumentGuard', LIFETIME_MS);
    const others = (await topology.frames()).filter(f => f.frameId !== target.frame.frameId);
    const armed = await Promise.all(
      others.map(f =>
        probe.callGlobal(f, 'armAwayGuard', LIFETIME_MS).then(
          () => f,
          () => null,
        ),
      ),
    );
    return new KeyGuard(
      ctx,
      target,
      armed.filter((f): f is FrameRecord => !!f),
      options,
      watchDialog(cdp),
    );
  }

  #fail(why: string, details?: unknown): never {
    throw new LayerError(
      'INTERCEPTED',
      `The input for ${this.target.description} was cancelled: ${why}. ${this.options.progress(this.#arrived, this.#sent)}`,
      // A key the target accepted ran its page handlers, even if a later event of the same key was cancelled.
      { delivered: this.options.delivered || this.#acceptedSeen > 0, details },
    );
  }

  /** Confirms the last unit arrived at the target; before another unit, also that one can be sent. */
  async #check(final: boolean): Promise<void> {
    const probe = this.ctx.tab().probe!;
    const step = await probe.callGlobal<GuardStep>(this.target.frame, 'stepGuard', LIFETIME_MS);
    this.#acceptedSeen = step.accepted ?? 0;
    if (step.verdict === 'cancelled') this.#fail(`focus was on ${quote(step.hit, 80)}`, step);
    if (this.#sent > this.#arrived) {
      if ((step.accepted ?? 0) <= this.#accepted)
        this.#fail(
          `the last key did not arrive at it (focus was on ${step.focus ? quote(step.focus, 80) : 'another document'})`,
          step,
        );
      this.#arrived = this.#sent;
      this.#accepted = step.accepted ?? 0;
    }
    if (final) return;
    if (!step.armed) this.#fail('the guard lapsed before the next key could be sent', step);
    if (!step.focusOk) this.#fail(`focus was on ${quote(step.focus, 80)}`, step);
    if (performance.now() - this.#awayRenewed > AWAY_RENEW_MS) {
      this.#awayRenewed = performance.now();
      await Promise.all(this.away.map(f => probe.callGlobal(f, 'renewGuard', LIFETIME_MS).catch(() => undefined)));
    }
  }

  /**
   * Sends one key or insertion after the checks, raced against a JavaScript dialog. Returns the dialog when one
   * opened: the page is blocked, so nothing more can be sent or checked.
   */
  async unit(send: () => Promise<void>): Promise<DialogInfo | undefined> {
    await this.#check(false);
    this.#sent++;
    return this.#race(send);
  }

  /**
   * Sends a keyup for a key already down, without the checks (the key's own default action may have moved focus;
   * the text guard withholds a stray keyup). Nothing is sent while a dialog holds the page.
   */
  async release(send: () => Promise<void>): Promise<DialogInfo | undefined> {
    if (this.#dialog) return this.#dialog;
    return this.#race(send);
  }

  async #race(send: () => Promise<void>): Promise<DialogInfo | undefined> {
    const sending = send();
    sending.catch(() => undefined);
    const dialog = await Promise.race([sending.then(() => undefined), this.watch.opened]);
    if (dialog) {
      this.#dialog = dialog;
      this.#outstanding = sending;
    }
    return dialog;
  }

  /** The dialog that opened during the sequence, if any. */
  get dialog(): DialogInfo | undefined {
    return this.#dialog;
  }

  /** The command the dialog interrupted. */
  get outstanding(): Promise<void> | undefined {
    return this.#outstanding;
  }

  /**
   * After the last unit: it arrived, and no other frame received a key. When the target's document was replaced (the
   * last key submitted a form), the check cannot be read; the guards were armed when the key was sent.
   */
  async finish(): Promise<void> {
    if (this.#dialog) return;
    const probe = this.ctx.tab().probe!;
    try {
      await this.#check(true);
    } catch (error) {
      if (error instanceof LayerError) throw error;
      return;
    }
    const reports = await Promise.all(
      this.away.map(f =>
        probe.callGlobal<GuardReport>(f, 'readGuard').then(
          report => ({ frame: f, report }),
          () => null,
        ),
      ),
    );
    const hit = reports.find(r => r?.report.verdict === 'cancelled');
    if (hit)
      this.#fail(
        `a key arrived in another frame, at ${quote(hit.report.hit, 80)} in ${quote(hit.frame.url)}`,
        hit.report,
      );
  }

  /** Removes every guard; with a dialog open the commands run when it closes. */
  async disarm(): Promise<void> {
    this.watch.dispose();
    const probe = this.ctx.tab().probe!;
    const all = [this.target.frame, ...this.away].map(f => probe.callGlobal(f, 'disarm').catch(() => undefined));
    if (!this.#dialog) await Promise.all(all);
  }
}

/**
 * Sends keys one event at a time under a key guard: a keydown or an inserted character is a checked unit; a keyup only
 * releases a key that is down. After a dialog nothing more is sent, so a chord stops between its modifier and its key;
 * the keys still down are released when the dialog closes, after the interrupted command.
 *
 * Releasing Space is what activates a button or a checkbox, and the keydown's handlers run first, so that release is
 * judged again before it is sent (`judgeRelease`). A release that fails the judgement, or that is left over when a
 * sequence stops, is withheld from the page (withheld.ts).
 */
export class KeyPresser {
  #down: string[] = [];

  constructor(
    private readonly ctx: ToolContext,
    private readonly guard: KeyGuard,
    private readonly port: PagePort,
    /** Throws when the element would no longer do what the gate judged; absent when no element was judged. */
    private readonly judgeRelease?: (key: string) => Promise<void>,
  ) {}

  async down(key: string): Promise<DialogInfo | undefined> {
    const dialog = await this.guard.unit(() => this.port.keyDown(key));
    this.#down.push(key);
    if (dialog) this.#releaseLater();
    return dialog;
  }

  async up(key: string): Promise<DialogInfo | undefined> {
    if (this.guard.dialog) return this.guard.dialog;
    if (releaseActivates(key)) await this.judgeRelease?.(key);
    const dialog = await this.guard.release(() => this.port.keyUp(key));
    this.#down = this.#down.filter(k => k !== key);
    if (dialog) this.#releaseLater();
    return dialog;
  }

  /** A checked unit of another kind (an insertion, an editing command). */
  async unit(send: () => Promise<void>): Promise<DialogInfo | undefined> {
    return this.guard.unit(send);
  }

  /** A whole key: down, then up unless a dialog opened. */
  async press(key: string): Promise<DialogInfo | undefined> {
    return (await this.down(key)) ?? this.up(key);
  }

  /** One character, as typing sends it: a key when the layout has one, inserted text otherwise. */
  async type(char: string): Promise<DialogInfo | undefined> {
    if (this.port.isKey(char)) return this.press(char);
    return this.guard.unit(() => this.port.insertCharacter(char));
  }

  /** After an error: releases the keys still down, unless a dialog holds the page (they are released after it). */
  async releaseAll(): Promise<void> {
    if (this.guard.dialog) return;
    const keys = [...this.#down].reverse();
    this.#down = [];
    await this.#release(keys, false);
  }

  #releaseLater(): void {
    const keys = [...this.#down].reverse();
    this.#down = [];
    if (!keys.length) return;
    const outstanding = this.guard.outstanding;
    this.ctx.tab().pendingRelease = async () => {
      await outstanding?.catch(() => undefined);
      return this.#release(keys, true);
    };
  }

  /**
   * Releases keys left down. A key whose release activates is released normally only after a dialog (`judged`), and
   * only if the judgement still holds: the page ran in between. In every other case its release is withheld from
   * the page; the note returned says so.
   */
  async #release(keys: string[], judged: boolean): Promise<string | undefined> {
    let note: string | undefined;
    for (const key of keys) {
      const up = () => this.port.keyUp(key);
      if (!releaseActivates(key)) {
        await up().catch(() => undefined);
        continue;
      }
      if (judged) {
        try {
          await this.judgeRelease?.(key);
          await up().catch(() => undefined);
          continue;
        } catch (error) {
          note = `${key} was not released to the page after the dialog: ${error instanceof Error ? error.message : error}`;
        }
      }
      await sendWithheld(this.ctx.tab(), 'text', up).catch(() => false);
    }
    return note;
  }
}
