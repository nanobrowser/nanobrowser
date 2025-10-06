import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TextField, IconButton, Button, Box, CircularProgress } from '@mui/material';
import { Mic, Stop, Replay, Send } from '@mui/icons-material';
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
  };

  // Expose a method to set content from outside
  useEffect(() => {
    if (setContent) {
      setContent(setText);
    }
  }, [setContent]);

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
        handleSubmit(e as any);
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
    <Box component="form" onSubmit={handleSubmit} sx={{ p: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <TextField
        inputRef={textareaRef}
        value={text}
        onChange={handleTextChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        multiline
        maxRows={4}
        fullWidth
        placeholder={t('chat_input_placeholder')}
        variant="outlined"
        size="small"
      />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          {onMicClick && (
            <IconButton
              onClick={onMicClick}
              disabled={disabled || isProcessingSpeech}
              aria-label={
                isProcessingSpeech
                  ? t('chat_stt_processing')
                  : isRecording
                    ? t('chat_stt_recording_stop')
                    : t('chat_stt_input_start')
              }
              color={isRecording ? 'error' : 'default'}>
              {isProcessingSpeech ? <CircularProgress size={24} /> : <Mic />}
            </IconButton>
          )}
        </Box>
        <Box>
          {showStopButton ? (
            <Button variant="contained" color="error" onClick={onStopTask} startIcon={<Stop />}>
              {t('chat_buttons_stop')}
            </Button>
          ) : historicalSessionId ? (
            <Button
              variant="contained"
              color="success"
              onClick={handleReplay}
              disabled={!historicalSessionId}
              startIcon={<Replay />}>
              {t('chat_buttons_replay')}
            </Button>
          ) : (
            <Button type="submit" variant="contained" disabled={isSendButtonDisabled} endIcon={<Send />}>
              {t('chat_buttons_send')}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
