// When a message was sent, under it in the transcript: "now", "5 minutes ago", "3 hours ago" within a day, then the
// date and time. The full date and time is the tooltip.
import type { Language } from '@src/ui/i18n';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The short form under a message, in the UI's language. */
export function messageTime(at: number, now: number, language: Language): string {
  const locale = language.replace('_', '-');
  const ago = Math.max(0, now - at);
  if (ago < DAY) {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (ago < MINUTE) return relative.format(0, 'second');
    if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute');
    return relative.format(-Math.floor(ago / HOUR), 'hour');
  }
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(locale, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(at);
}

/** The tooltip: the full date and time. */
export function messageTimeFull(at: number, language: Language): string {
  return new Intl.DateTimeFormat(language.replace('_', '-'), { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}
