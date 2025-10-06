import { List, ListItem, ListItemText, IconButton, Typography, Box } from '@mui/material';
import { Delete, Bookmark } from '@mui/icons-material';
import { t } from '@extension/i18n';

interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
}

interface ChatHistoryListProps {
  sessions: ChatSession[];
  onSessionSelect: (sessionId: string) => void;
  onSessionDelete: (sessionId: string) => void;
  onSessionBookmark: (sessionId: string) => void;
  visible: boolean;
  isDarkMode?: boolean;
}

const ChatHistoryList: React.FC<ChatHistoryListProps> = ({
  sessions,
  onSessionSelect,
  onSessionDelete,
  onSessionBookmark,
  visible,
}) => {
  if (!visible) return null;

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <Box sx={{ height: '100%', overflowY: 'auto', p: 1 }}>
      <Typography variant="h6" sx={{ mb: 1, px: 1 }}>
        {t('chat_history_title')}
      </Typography>
      {sessions.length === 0 ? (
        <Typography sx={{ textAlign: 'center', color: 'text.secondary' }}>{t('chat_history_empty')}</Typography>
      ) : (
        <List>
          {sessions.map(session => (
            <ListItem
              key={session.id}
              button
              onClick={() => onSessionSelect(session.id)}
              secondaryAction={
                <>
                  <IconButton
                    edge="end"
                    aria-label="bookmark"
                    onClick={e => {
                      e.stopPropagation();
                      onSessionBookmark(session.id);
                    }}>
                    <Bookmark />
                  </IconButton>
                  <IconButton
                    edge="end"
                    aria-label="delete"
                    onClick={e => {
                      e.stopPropagation();
                      onSessionDelete(session.id);
                    }}>
                    <Delete />
                  </IconButton>
                </>
              }>
              <ListItemText primary={session.title} secondary={formatDate(session.createdAt)} />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
};

export default ChatHistoryList;
