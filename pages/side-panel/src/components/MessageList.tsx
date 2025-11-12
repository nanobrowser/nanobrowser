import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo } from 'react';
import { t } from '@extension/i18n';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
  failureMessage?: string;
  showRetryOptions?: boolean;
  onRetry?: () => void;
  onNewChat?: () => void;
  retryDisabled?: boolean;
}

export default memo(function MessageList({
  messages,
  isDarkMode = false,
  failureMessage,
  showRetryOptions = false,
  onRetry,
  onNewChat,
  retryDisabled = false,
}: MessageListProps) {
  return (
    <div className="max-w-full space-y-4">
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
          showRetryControls={
            Boolean(showRetryOptions && failureMessage && message.content === failureMessage && message.actor === 'system')
          }
          onRetry={onRetry}
          onNewChat={onNewChat}
          retryDisabled={retryDisabled}
        />
      ))}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
  showRetryControls?: boolean;
  onRetry?: () => void;
  onNewChat?: () => void;
  retryDisabled?: boolean;
}

function MessageBlock({
  message,
  isSameActor,
  isDarkMode = false,
  showRetryControls = false,
  onRetry,
  onNewChat,
  retryDisabled = false,
}: MessageBlockProps) {
  if (!message.actor) {
    console.error('No actor found');
    return <div />;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';

  return (
    <div
      className={`flex max-w-full gap-3 ${
        !isSameActor
          ? `mt-4 border-t ${isDarkMode ? 'border-slate-700/50' : 'border-gray-300/60'} pt-4 first:mt-0 first:border-t-0 first:pt-0`
          : ''
      }`}>
      {!isSameActor && (
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: actor.iconBackground }}>
          <img src={actor.icon} alt={actor.name} className="size-6" />
        </div>
      )}
      {isSameActor && <div className="w-8" />}

      <div className="min-w-0 flex-1">
        {!isSameActor && (
          <div className={`mb-1 text-sm font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            {actor.name}
          </div>
        )}

        <div className="space-y-0.5">
          <div className={`whitespace-pre-wrap break-words text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
            {isProgress ? (
              <div className={`h-1 overflow-hidden rounded ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                <div className="h-full animate-progress bg-gray-500" />
              </div>
            ) : (
              message.content
            )}
          </div>
          {showRetryControls && (
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={retryDisabled}
                onClick={() => !retryDisabled && onRetry?.()}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 ${
                  retryDisabled
                    ? isDarkMode
                      ? 'cursor-not-allowed border border-slate-700 bg-slate-800 text-slate-500'
                      : 'cursor-not-allowed border border-gray-300 bg-gray-200 text-gray-400'
                    : isDarkMode
                      ? 'border border-slate-600 bg-slate-600 text-gray-100 hover:bg-slate-500'
                      : 'border border-gray-400 bg-[#9F9F9F] text-white hover:bg-gray-600'
                }`}
              >
                {t('chat_retry_tryAgain')}
              </button>
              <button
                type="button"
                onClick={() => onNewChat?.()}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400 ${
                  isDarkMode
                    ? 'border-slate-600 bg-transparent text-gray-200 hover:border-slate-400 hover:text-gray-100'
                    : 'border-gray-400 bg-transparent text-gray-700 hover:border-gray-500 hover:text-gray-900'
                }`}
              >
                {t('chat_retry_newChat')}
              </button>
            </div>
          )}
          {!isProgress && (
            <div className={`text-right text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-300'}`}>
              {formatTimestamp(message.timestamp)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Formats a timestamp (in milliseconds) to a readable time string
 * @param timestamp Unix timestamp in milliseconds
 * @returns Formatted time string
 */
function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  // Check if the message is from today
  const isToday = date.toDateString() === now.toDateString();

  // Check if the message is from yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  // Check if the message is from this year
  const isThisYear = date.getFullYear() === now.getFullYear();

  // Format the time (HH:MM)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr; // Just show the time for today's messages
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    // Show month and day for this year
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  // Show full date for older messages
  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
