// Masking of sensitive field values wherever page content is returned (browser-use's rule).
import type { FieldFacts } from './capture';
import type { ProbeState } from '../../probe';
import { quote } from '../text';

const SENSITIVE_TYPES = new Set(['password', 'hidden', 'file']);
const SENSITIVE_AUTOCOMPLETE = /(^|\s)(cc-|one-time-code|current-password|new-password)/;
// Names, ids and labels of fields that hold a secret. Code fields are matched by what kind of code they hold
// (verification, authentication, two-factor), so a promo, zip or postal code is still printed.
const SENSITIVE_NAME =
  /(card.?num|cc.?num|credit.?card|cvv|cvc|csc|security.?code|one.?time|otp|totp|2fa|mfa|two.?factor|verif(?:y|ication).?code|auth(?:entication|enticator|orization)?.?code|passcode|password|passwd)/i;

/** Digits only, 13 to 19 long, passing the Luhn check. */
export function looksLikeCardNumber(value: string): boolean {
  if (!/^[\d\s-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isSensitiveField(facts: FieldFacts | undefined, name: string, value: string): boolean {
  if (facts?.type && SENSITIVE_TYPES.has(facts.type)) return true;
  if (facts?.autocomplete && SENSITIVE_AUTOCOMPLETE.test(facts.autocomplete)) return true;
  if (SENSITIVE_NAME.test(facts?.name ?? '') || SENSITIVE_NAME.test(facts?.id ?? '') || SENSITIVE_NAME.test(name)) {
    return true;
  }
  // Chrome already masks password values with bullets; keep them masked whatever the field says.
  if (/^[•●*]+$/.test(value)) return true;
  return looksLikeCardNumber(value);
}

/**
 * A field whose input is the user's step: a password field, an `autocomplete` of a card, a one-time code or a password,
 * or a name, id or label that names one. The value plays no part: this is about the field, not what is in it.
 */
export function isSecretField(state: ProbeState | null | undefined, name: string): boolean {
  if (!state) return false;
  if (state.type === 'password') return true;
  if (state.autocomplete && SENSITIVE_AUTOCOMPLETE.test(state.autocomplete)) return true;
  return SENSITIVE_NAME.test(state.name ?? '') || SENSITIVE_NAME.test(state.id ?? '') || SENSITIVE_NAME.test(name);
}

/** The same rule over a live element's state, as the probe reads it at action time. */
export function isSensitiveState(state: ProbeState | null | undefined, name: string): boolean {
  if (!state) return false;
  return isSensitiveField(
    { tag: state.tag, type: state.type, autocomplete: state.autocomplete, name: state.name, id: state.id },
    name,
    state.value ?? '',
  );
}

export const MASK = '••••••';

/** A select option: its index and value identify it; its label is what the page shows. */
export interface OptionFacts {
  index: number;
  value: string;
  label: string;
}

/**
 * Whether an option's value may be printed. The value is an attribute the page does not show, so in a sensitive select
 * no value is printed; a value or a label that is itself a card number is not printed anywhere.
 */
export function isSensitiveOption(option: OptionFacts, sensitiveSelect: boolean): boolean {
  return sensitiveSelect || looksLikeCardNumber(option.value) || looksLikeCardNumber(option.label);
}

/**
 * Whether an option's label may be printed. A label is what the page shows, so it is printed, except a card number
 * anywhere, and, in a sensitive select, a label that is the secret itself: one that repeats a value with digits in it
 * (a code), or that has no letters (a one-time code, a PIN, an expiry month). A label such as "Visa ending 1111" or
 * "Saved card" is still printed, so the agent can tell saved cards apart.
 */
export function isSensitiveLabel(option: OptionFacts, sensitiveSelect: boolean): boolean {
  const label = option.label.trim();
  if (looksLikeCardNumber(label)) return true;
  if (!sensitiveSelect || !label) return false;
  const value = option.value.trim().toLowerCase();
  const shown = label.toLowerCase();
  const repeats = /\d/.test(value) && (shown === value || (value.length >= 4 && shown.includes(value)));
  return repeats || !/\p{L}/u.test(label);
}

function optionLabel(option: OptionFacts, sensitiveSelect: boolean): string {
  return isSensitiveLabel(option, sensitiveSelect) ? MASK : option.label;
}

/** An option in an error's list: `label (value)`; a masked one gives its position in place of its value. */
export function listedOption(option: OptionFacts, sensitiveSelect: boolean): string {
  return isSensitiveOption(option, sensitiveSelect)
    ? `${quote(optionLabel(option, sensitiveSelect))} (option ${option.index + 1}, value masked)`
    : `${quote(option.label)} (${quote(option.value)})`;
}

/**
 * An option in a read-back: its label, and, when labels are shared (`tellApart`) or the label is masked, its value,
 * or its position when the value is masked.
 */
export function quotedOption(option: OptionFacts, sensitiveSelect: boolean, tellApart: boolean): string {
  const masked = isSensitiveLabel(option, sensitiveSelect);
  if (!tellApart && !masked) return quote(option.label);
  return isSensitiveOption(option, sensitiveSelect)
    ? `${quote(optionLabel(option, sensitiveSelect))} (option ${option.index + 1})`
    : `${quote(option.label)} (${quote(option.value)})`;
}
