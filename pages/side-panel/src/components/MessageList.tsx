import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState } from 'react';
import { FiCpu } from 'react-icons/fi';

// Minimal safe markdown renderer (no external deps)
function escapeHtml(str: string) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(md: string) {
  if (!md) return '';
  let html = escapeHtml(md);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  const paragraphs = html.split(/\n{2,}/g).map(p => `<p>${p.replace(/\n/g, '<br/>')}</p>`);
  return paragraphs.join('');
}

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  return (
    <div className="max-w-full">
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
        />
      ))}
    </div>
  );
});

interface MessageBlockProps {
  message: Message;
  isSameActor: boolean;
  isDarkMode?: boolean;
}

function MessageBlock({ message, isSameActor }: MessageBlockProps) {
  if (!message.actor) {
    console.error('No actor found');
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';
  const COLLAPSE_START = '<!--COLLAPSED_START-->';
  const COLLAPSE_END = '<!--COLLAPSED_END-->';

  // Detect collapsed region in message content
  const hasCollapsed =
    typeof message.content === 'string' &&
    message.content.includes(COLLAPSE_START) &&
    message.content.includes(COLLAPSE_END);
  const [expanded, setExpanded] = useState(false);

  // beforeCollapsed removed (not used)
  let collapsedContent = '';
  let afterCollapsed = '';
  if (hasCollapsed) {
    const start = message.content.indexOf(COLLAPSE_START);
    const end = message.content.indexOf(COLLAPSE_END, start);
    collapsedContent = message.content.slice(start + COLLAPSE_START.length, end).trim();
    afterCollapsed = message.content.slice(end + COLLAPSE_END.length).trim();
  }

  // parse collapsedContent into actor parts of form [[ACTOR:role]]\ncontent
  const actorParts: Array<{ actor: string; content: string }> = [];
  if (collapsedContent) {
    const re = /\[\[ACTOR:([^\]]+)\]\]\s*\n([\s\S]*?)(?=(\[\[ACTOR:)|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(collapsedContent)) !== null) {
      actorParts.push({ actor: m[1].trim(), content: (m[2] || '').trim() });
    }
  }

  return (
    <div className={`message-row ${!isSameActor ? 'mt-1' : ''}`}>
      {!isSameActor &&
        message.actor !== 'user' &&
        (hasCollapsed ? (
          // Collapsed messages show AI header which toggles expand/collapse
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            data-collapsed-toggle
            aria-label={expanded ? 'Collapse details' : 'Expand details'}>
            <div className="avatar" data-actor={expanded ? message.actor : 'ai'}>
              {expanded ? (
                <img src={actor.icon} alt={actor.name} className="avatar-img" />
              ) : (
                <span data-ai-icon aria-hidden>
                  <FiCpu />
                </span>
              )}
            </div>
          </button>
        ) : (
          <div className="avatar" data-actor={message.actor}>
            <img src={actor.icon} alt={actor.name} className="avatar-img" />
          </div>
        ))}

      {isSameActor && <div className="spacer-40" />}

      <div className="sb-grow">
        {!isSameActor &&
          (hasCollapsed ? (
            <div className="mb-0.5 text-sm font-semibold">
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="text-left"
                aria-label={expanded ? 'Collapse details' : 'Expand details'}>
                {expanded ? actor.name : 'AI'}
              </button>
            </div>
          ) : (
            <div className="mb-0.5 text-sm font-semibold">{actor.name}</div>
          ))}

        {/* Inline message content (no bubble) */}
        <div className="text-sm">
          {isProgress ? (
            <ProcessingIndicator actorName={actor.name} />
          ) : hasCollapsed ? (
            <div>
              {/* When collapsed (not expanded), show only the planner's final content */}
              {!expanded ? (
                <div
                  className="whitespace-pre-wrap"
                  data-md="1"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(afterCollapsed || '') }}
                />
              ) : (
                /* expanded: render the actor parts (Planner/Navigator) then planner final content */
                <div>
                  <div data-collapsed-region className="mt-1 text-[var(--muted-text)]">
                    {actorParts.map((p, i) => {
                      const prof = ACTOR_PROFILES[p.actor as keyof typeof ACTOR_PROFILES];
                      return (
                        <div key={i} className="mb-2 flex items-start gap-2">
                          <div className="avatar" data-actor={p.actor} data-restored>
                            <img src={prof?.icon} alt={prof?.name} className="avatar-img" />
                          </div>
                          <div
                            className="whitespace-pre-wrap"
                            data-md="1"
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(p.content) }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {afterCollapsed ? (
                    <div
                      className="mt-2 whitespace-pre-wrap"
                      data-md="1"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(afterCollapsed) }}
                    />
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div
              className="whitespace-pre-wrap"
              data-md="1"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
            />
          )}
        </div>

        {!isProgress && <div className="message-meta">{formatTimestamp(message.timestamp)}</div>}
      </div>

      {!isSameActor && message.actor === 'user' && (
        <div className="avatar" data-actor={message.actor}>
          <img src={actor.icon} alt={actor.name} className="avatar-img" />
        </div>
      )}
    </div>
  );
}

function ProcessingIndicator({ actorName }: { actorName: string }) {
  return (
    <div data-processing className="text-sm text-[var(--muted-text)]">
      <span className="italic">{actorName} is processing</span>
      <span data-dots className="ml-2">
        (Processing<span aria-hidden>...</span>)
      </span>
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
