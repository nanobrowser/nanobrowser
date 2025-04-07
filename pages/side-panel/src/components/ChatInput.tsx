import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { IoSendSharp } from 'react-icons/io5';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  onStopTask: () => void;
  disabled: boolean;
  showStopButton: boolean;
  setContent?: (setter: (text: string) => void) => void;
  isDarkMode?: boolean;
}

export default function ChatInput({
  onSendMessage,
  onStopTask,
  disabled,
  showStopButton,
  setContent,
  isDarkMode = false,
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
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 80), 200)}px`;
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
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 80), 200)}px`;
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

  return (
    <form
      onSubmit={handleSubmit}
      className={`overflow-hidden rounded-lg border-2 transition-colors ${
        disabled ? 'cursor-not-allowed' : 'focus-within:border-primary-500 hover:border-primary-400'
      } ${isDarkMode ? 'border-slate-600' : 'border-primary-400'} relative z-10`}
      aria-label="Chat input form">
      <div className="flex flex-col">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          aria-disabled={disabled}
          rows={3}
          className={`w-full resize-none border-none p-4 focus:outline-none ${
            disabled
              ? isDarkMode
                ? 'cursor-not-allowed bg-slate-800 text-gray-400'
                : 'cursor-not-allowed bg-gray-200 text-gray-500'
              : isDarkMode
                ? 'bg-slate-800 text-gray-100'
                : 'bg-primary-100 text-gray-900'
          }`}
          placeholder="We will assist you with any automation needs on Twitter/X."
          aria-label="Message input"
        />

        <div
          className={`flex items-center justify-between px-4 py-3 ${
            disabled ? (isDarkMode ? 'bg-slate-800' : 'bg-gray-200') : isDarkMode ? 'bg-slate-800' : 'bg-primary-100'
          }`}>
          <div className="flex gap-2 text-gray-500">{/* Icons can go here */}</div>

          {showStopButton ? (
            <button
              type="button"
              onClick={onStopTask}
              className="rounded-md bg-red-600 px-5 py-2.5 text-white transition-colors hover:bg-red-700 font-medium shadow-md z-20">
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={isSendButtonDisabled}
              aria-disabled={isSendButtonDisabled}
              className={`rounded-md px-5 py-2.5 transition-colors font-medium shadow-md flex items-center gap-2 z-20
                ${
                  isSendButtonDisabled
                    ? 'cursor-not-allowed bg-gray-400 text-gray-700'
                    : 'bg-primary-600 hover:bg-primary-700 text-white border-2 border-primary-500'
                }`}>
              <span className="font-bold">Send</span>
              <IoSendSharp className="text-lg" />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
