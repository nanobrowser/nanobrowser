// The sensitivity classifier: deterministic, from the accessible name and structural facts.
// It answers what the action will do; for forms, whether it will submit one. It follows the ideas of huashu-chrome's
// payment gate (vocabulary, and a money amount next to a generic confirmation label), written independently, and is
// deliberately kept at that scope for the first version: vocabulary, money next to a generic label, form ownership
// and HTML implicit submission, with no wider heuristics (the user's direction, 2026-10-04).
// The vocabulary errs toward inclusion: a false positive costs one prompt, a false negative an irreversible action.
import type { SensitiveCategory } from '../../protocol/results';
import type { FormFacts } from '../../probe';
import { quote } from '../text';

/** Builds a case-insensitive matcher: English phrases match on word boundaries, Chinese phrases anywhere. */
function vocabulary(english: string[], chinese: string[]): RegExp {
  const words = english.map(w => w.trim().split(/\s+/).join('\\s*'));
  return new RegExp(`\\b(?:${words.join('|')})\\b|${chinese.join('|')}`, 'i');
}

export const PAY_WORDS = vocabulary(
  [
    'pay',
    'payment',
    'pay now',
    'buy',
    'buy now',
    'purchase',
    'checkout',
    'check out',
    'place order',
    'place the order',
    'order now',
    'complete order',
    'complete purchase',
    'complete booking',
    'book now',
    'subscribe',
    'donate',
    'confirm and pay',
    'transfer money',
    'top up',
  ],
  ['付款', '支付', '购买', '下单', '结账', '结算', '充值', '订阅', '转账', '捐款'],
);
export const DELETE_WORDS = vocabulary(
  [
    'delete',
    'remove',
    'discard',
    'deactivate',
    'destroy',
    'erase',
    'purge',
    'trash',
    'unsubscribe',
    'cancel subscription',
    'cancel my subscription',
    'cancel account',
    'cancel membership',
    'cancel order',
    'close account',
  ],
  ['删除', '移除', '清空', '注销', '取消订阅'],
);
export const SUBMIT_WORDS = vocabulary(
  [
    'submit',
    'send',
    'publish',
    'post',
    'confirm',
    'apply',
    'sign up',
    'register',
    'save',
    'update',
    'create',
    'approve',
    'reject',
  ],
  ['提交', '发送', '发布', '确认', '保存', '更新', '创建', '批准', '拒绝', '驳回'],
);
/** A cookie banner's refusal ("Reject all", "Reject cookies"), which is not a write although "reject" is. */
export const COOKIE_REJECT = /cookie|^reject\s+all$|^(?:拒绝所有|全部拒绝|拒绝全部)$/i;
/** Granting access: protected, like a payment. */
export const GRANT_WORDS = vocabulary(
  ['authorize', 'authorise', 'allow access', 'grant access', 'give access'],
  ['授权', '允许访问', '授予访问'],
);
/** An affirmative label, which grants access on a consent page; "Allow" alone elsewhere is a cookie banner's. */
export const AFFIRMATIVE = /^(?:allow|continue|accept|approve|agree|yes|允许|继续|接受|同意|批准)(?:\b|$)/i;
/** The address path of a consent page. */
const CONSENT_PATH = /oauth|authori[sz]e|consent/i;

function onConsentPage(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return CONSENT_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}
/** A generic confirmation label: pay when a money amount is next to it. */
export const GENERIC_CONFIRM =
  /^(?:confirm|ok|okay|continue|next|proceed|agree|submit|yes|确认|确定|继续|下一步)(?:\b|$)/i;
const DELETE_CLASSES = /(^|[\s_-])(delete|remove|destroy|trash|discard)([\s_-]|$)/i;

export interface ClassifyInput {
  /** activate: a click, or Enter/Space on a focused button or link; enter: Enter in a field or submit:true. */
  mode: 'activate' | 'enter';
  /** The accessible name read during revalidation. */
  name: string;
  role: string;
  facts: FormFacts;
  /** The address of the frame the element is in, for the consent-page rule of `grant`. */
  url?: string;
}

export interface Classification {
  category: SensitiveCategory | null;
  reason: string;
}

function byName(name: string, money: string, url?: string): Classification | null {
  if (PAY_WORDS.test(name)) return { category: 'pay', reason: `the name ${quote(name)} is payment vocabulary` };
  // Grant before submit, so a consent form's submit button is a grant.
  if (GRANT_WORDS.test(name)) return { category: 'grant', reason: `the name ${quote(name)} grants access` };
  if (AFFIRMATIVE.test(name.trim()) && onConsentPage(url)) {
    return { category: 'grant', reason: `${quote(name)} on a consent page` };
  }
  if (GENERIC_CONFIRM.test(name.trim()) && money) {
    return { category: 'pay', reason: `${quote(name)} next to the amount ${quote(money, 40)}` };
  }
  if (DELETE_WORDS.test(name))
    return { category: 'delete', reason: `the name ${quote(name)} is destructive vocabulary` };
  return null;
}

/**
 * Whether Enter in a field submits its form owner (HTML implicit submission): the form has a default button that is
 * not disabled, or no submit button at all and at most one field that blocks implicit submission.
 */
export function enterSubmits(facts: FormFacts): boolean {
  const form = facts.form;
  if (!form) return false;
  if (form.defaultButton) return !form.defaultButton.disabled;
  return !form.hasSubmitButton && form.blockingFields <= 1;
}

export function classify(input: ClassifyInput): Classification {
  const { facts } = input;
  const name = input.name.trim();
  if (input.mode === 'enter') {
    // Enter in a text field with no form sends what it holds in chat, comment and message boxes (item 6).
    if (!facts.form && facts.textEntry && !facts.searchField) {
      return {
        category: 'submit',
        reason: 'Enter in a text field with no form (a chat or comment box sends on Enter)',
      };
    }
    if (!facts.form || !enterSubmits(facts)) return { category: null, reason: 'Enter does not submit a form here' };
    // The default button's name says what the submission does; a search form is exempt from submit only, so pay
    // and delete still need the user, as they would for a click on that button. Both its accessible name and the
    // probe's approximation are checked: either one is enough.
    const names = [facts.form.defaultButton?.accessibleName, facts.form.defaultButton?.name].filter(
      (n): n is string => !!n,
    );
    for (const button of names) {
      const named = byName(button, facts.money, input.url);
      if (named) return { ...named, reason: `Enter submits the form through ${quote(button)}: ${named.reason}` };
    }
    if (facts.form.search) return { category: null, reason: 'a search form' };
    return {
      category: 'submit',
      reason: `Enter submits the form (${facts.form.method.toUpperCase()} ${quote(facts.form.action)})`,
    };
  }
  const named = byName(name, facts.money, input.url);
  if (named) return named;
  if (DELETE_CLASSES.test(facts.classes))
    return { category: 'delete', reason: `its class or test ID (${quote(facts.classes, 80)}) is destructive` };
  if (facts.submitter && facts.form && !facts.form.search) {
    return {
      category: 'submit',
      reason: `it submits its form (${facts.form.method.toUpperCase()} ${quote(facts.form.action)})`,
    };
  }
  if (SUBMIT_WORDS.test(name) && !facts.form?.search && !COOKIE_REJECT.test(name))
    return { category: 'submit', reason: `the name ${quote(name)} is submission vocabulary` };
  return { category: null, reason: 'not submit, pay or delete' };
}
