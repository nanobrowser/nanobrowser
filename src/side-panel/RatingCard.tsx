// The card that asks the user to rate Nanobrowser in the web store, right after a run finishes well in this panel, once
// they use it often (the rule is in src/store/rating.ts). Leave a rating opens the store's page in a new tab; Maybe
// later closes it until a month later. A new run the user starts while it shows counts as Maybe later.
import { useState } from 'react';
import {
  NO_ANSWER,
  NO_USAGE,
  answerRating,
  ratingAnswerStorage,
  ratingShowsIn,
  ratingStorage,
  ratingUrl,
} from '@src/store/rating';
import { useStorage } from '@src/ui/hooks';
import { LogoMark } from '@src/ui/icons';
import { t } from '@src/ui/i18n';

function answer(choice: 'rate' | 'later'): void {
  void ratingAnswerStorage.set(a => answerRating(a, choice, new Date()));
}

/**
 * Whether this panel shows the card: `conversationId` is the conversation it shows, `startedAt` when its latest run
 * began, `active` whether that run is working, and `waiting` whether another card (What's new) goes first.
 */
export function useRatingCard(
  conversationId: string | null,
  startedAt: string | undefined,
  active: boolean,
  waiting: boolean,
): boolean {
  // When the panel began showing this conversation: on opening, and again on every switch to another one.
  const [shown, setShown] = useState(() => ({ conversationId, at: Date.now() }));
  if (shown.conversationId !== conversationId) setShown({ conversationId, at: Date.now() });
  const usage = useStorage(ratingStorage, NO_USAGE);
  const choice = useStorage(ratingAnswerStorage, NO_ANSWER);
  if (active || waiting || shown.conversationId !== conversationId) return false;
  const since = Math.max(shown.at, startedAt ? Date.parse(startedAt) : 0);
  return ratingShowsIn(usage, choice, conversationId, since, new Date());
}

/** The user started a new run while the card showed: that is their Maybe later. */
export function ratingMovedOn(): void {
  answer('later');
}

export function RatingCard() {
  const rate = () => {
    void chrome.tabs.create({ url: ratingUrl(navigator.userAgent) });
    answer('rate');
  };
  const edge = navigator.userAgent.includes('Edg/');
  return (
    <section
      aria-label={t('rating.title')}
      className="flex flex-col gap-2.5 rounded-2xl border border-nb-border bg-nb-bg p-3.5 text-sm shadow-soft">
      <div className="flex items-start gap-3">
        <LogoMark size={36} className="mt-0.5 rounded-lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-semibold text-nb-fg">{t('rating.title')}</h2>
          <p className="leading-relaxed text-nb-muted">
            {t('rating.body', { store: t(edge ? 'rating.store.edge' : 'rating.store.chrome') })}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg border border-nb-border bg-nb-bg px-3 py-1.5 text-xs font-medium text-nb-fg shadow-sm transition-colors hover:bg-nb-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent"
          onClick={() => answer('later')}>
          {t('rating.later')}
        </button>
        <button
          type="button"
          className="rounded-lg bg-nb-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-nb-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-nb-accent"
          onClick={rate}>
          {t('rating.rate')}
        </button>
      </div>
    </section>
  );
}
