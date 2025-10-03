import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { FaMicrophone } from 'react-icons/fa';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';
import { t } from '@extension/i18n';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStopTask: () => void;
  onMicClick?: () => void;
  isRecording?: boolean;
  isProcessingSpeech?: boolean;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  // Historical session ID - if provided, shows replay button instead of send button
  historicalSessionId?: string | null;
  onReplay?: (sessionId: string) => void;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  onMicClick,
  isRecording = false,
  isProcessingSpeech = false,
  disabled,
  showStopButton,
  setContent,
  historicalSessionId,
  onReplay,
}: ChatInputProps) {
  const [text, setText] = useState('');
  const isSendButtonDisabled = useMemo(() => disabled || text.trim() === '', [disabled, text]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Handle text changes and resize textarea
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);

    // Resize textarea
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

  // Initial resize when component mounts
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 100)}px`;
    }
  }, []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (text.trim()) {
        onSendMessage(text);
        setText('');
      }
    },
    [text, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    },
    [handleSubmit],
  );

  const handleReplay = useCallback(() => {
    if (historicalSessionId && onReplay) {
      onReplay(historicalSessionId);
    }
  }, [historicalSessionId, onReplay]);

  return (
    <form
      onSubmit={handleSubmit}
      className={`transition-theme input-area ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      aria-label={t('chat_input_form')}>
      <div className="flex flex-col">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={5}
          className={
            'w-full resize-none p-3 text-sm transition-theme focus:outline-none ' +
            (disabled ? 'cursor-not-allowed bg-slate-900 text-gray-400' : 'bg-transparent text-[var(--text)]')
          }
          placeholder={t('chat_input_placeholder')}
          aria-label={t('chat_input_editor')}
        />

        <div className={`input-row flex items-center justify-between p-2`}>
          <div className={`muted flex gap-2`}>
            {onMicClick && (
              <button
                type="button"
                onClick={onMicClick}
                disabled={disabled || isProcessingSpeech}
                aria-label={
                  isProcessingSpeech
                    ? t('chat_stt_processing')
                    : isRecording
                      ? t('chat_stt_recording_stop')
                      : t('chat_stt_input_start')
                }
                className={
                  'rounded-lg p-2 transition-theme ' +
                  (disabled || isProcessingSpeech
                    ? 'cursor-not-allowed opacity-50'
                    : isRecording
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'text-gray-400 hover:bg-[rgba(255,255,255,0.02)]')
                }>
                {isProcessingSpeech ? (
                  <AiOutlineLoading3Quarters className="size-4 animate-spin" />
                ) : (
                  <FaMicrophone className={`size-4 ${isRecording ? 'animate-pulse' : ''}`} />
                )}
              </button>
            )}
          </div>

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="rounded-md bg-red-500 px-3 py-1 text-white transition-colors hover:bg-red-600">
              {t('chat_buttons_stop')}
            </button>
          ) : historicalSessionId ? (
            <button
              type="button"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              className={`rounded-md bg-green-500 px-3 py-1 text-white transition-colors hover:bg-green-600 ${!historicalSessionId ? 'cursor-not-allowed opacity-50' : ''}`}>
              {t('chat_buttons_replay')}
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              className={
                'rounded-lg px-4 py-1 shadow-md transition-transform text-white ' +
                (isSendButtonDisabled
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed opacity-80'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95')
              }>
              {t('chat_buttons_send')}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
