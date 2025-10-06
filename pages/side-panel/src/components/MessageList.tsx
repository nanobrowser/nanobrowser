import type { Message } from '@extension/storage';
import { ACTOR_PROFILES } from '../types/message';
import { memo, useState } from 'react';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Collapse,
  IconButton,
  Typography,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
} from '@mui/material';
import { ExpandMore, ExpandLess } from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';

interface MessageListProps {
  messages: Message[];
  isDarkMode?: boolean;
}

export default memo(function MessageList({ messages, isDarkMode = false }: MessageListProps) {
  return (
    <List sx={{ width: '100%' }}>
      {messages.map((message, index) => (
        <MessageBlock
          key={`${message.actor}-${message.timestamp}-${index}`}
          message={message}
          isSameActor={index > 0 ? messages[index - 1].actor === message.actor : false}
          isDarkMode={isDarkMode}
        />
      ))}
    </List>
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
    return null;
  }
  const actor = ACTOR_PROFILES[message.actor as keyof typeof ACTOR_PROFILES];
  const isProgress = message.content === 'Showing progress...';
  const COLLAPSE_START = '<!--COLLAPSED_START-->';
  const COLLAPSE_END = '<!--COLLAPSED_END-->';

  const hasCollapsed =
    typeof message.content === 'string' &&
    (message.content.includes(COLLAPSE_START) || message.content.includes(COLLAPSE_END));
  const [expanded, setExpanded] = useState(false);

  let collapsedContent = '';
  let afterCollapsed = '';
  if (hasCollapsed) {
    const hasStart = message.content.includes(COLLAPSE_START);
    const end = message.content.lastIndexOf(COLLAPSE_END);
    if (hasStart) {
      const start = message.content.indexOf(COLLAPSE_START);
      collapsedContent = message.content.slice(start + COLLAPSE_START.length, end).trim();
    } else {
      collapsedContent = message.content.slice(0, end).trim();
    }
    afterCollapsed = message.content.slice(end + COLLAPSE_END.length).trim();
  }

  const actorParts: Array<{ actor: string; content: string }> = [];
  if (collapsedContent) {
    const parts = collapsedContent.split('[[ACTOR:').slice(1);
    for (const part of parts) {
      const [actor, content] = part.split(']]\n');
      actorParts.push({ actor: actor.trim(), content: content.trim() });
    }
  }

  const renderContent = (content: string) => (
    <Typography component="div" sx={{ typography: 'body2', '& p': { margin: 0 } }}>
      <ReactMarkdown>{content}</ReactMarkdown>
    </Typography>
  );

  return (
    <ListItem sx={{ alignItems: 'flex-start', gap: 1, mt: isSameActor ? 0 : 1, px: 1 }}>
      {!isSameActor && message.actor !== 'user' && (
        <ListItemAvatar sx={{ minWidth: 'auto', mr: 1 }}>
          <Avatar src={actor.icon} alt={actor.name} sx={{ width: 32, height: 32 }} />
        </ListItemAvatar>
      )}
      {isSameActor && <Box sx={{ width: 40, mr: 1 }} />}
      <Box sx={{ width: '100%' }}>
        {!isSameActor && (
          <Typography variant="subtitle2" component="div" sx={{ fontWeight: 'bold' }}>
            {actor.name}
          </Typography>
        )}
        <Card
          variant="outlined"
          sx={{
            width: '100%',
            bgcolor: message.actor === 'user' ? 'primary.light' : 'background.paper',
            borderColor: message.actor === 'user' ? 'primary.main' : 'divider',
          }}>
          <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
            {isProgress ? (
              <ProcessingIndicator />
            ) : hasCollapsed ? (
              <Box>
                <IconButton size="small" onClick={() => setExpanded(!expanded)}>
                  {expanded ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
                {renderContent(afterCollapsed || '')}
                <Collapse in={expanded} timeout="auto" unmountOnExit>
                  <List dense>
                    {actorParts.map((p, i) => {
                      const prof = ACTOR_PROFILES[p.actor as keyof typeof ACTOR_PROFILES];
                      return (
                        <ListItem key={i} sx={{ alignItems: 'flex-start', gap: 1 }}>
                          <ListItemAvatar>
                            <Avatar src={prof?.icon} alt={prof?.name} sx={{ width: 24, height: 24 }} />
                          </ListItemAvatar>
                          <ListItemText primary={renderContent(p.content)} />
                        </ListItem>
                      );
                    })}
                  </List>
                </Collapse>
              </Box>
            ) : (
              renderContent(message.content)
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
              {formatTimestamp(message.timestamp)}
            </Typography>
          </CardContent>
        </Card>
      </Box>
      {!isSameActor && message.actor === 'user' && (
        <ListItemAvatar sx={{ minWidth: 'auto', ml: 1 }}>
          <Avatar src={actor.icon} alt={actor.name} sx={{ width: 32, height: 32 }} />
        </ListItemAvatar>
      )}
    </ListItem>
  );
}

function ProcessingIndicator() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.disabled' }}>
      <Typography variant="caption" sx={{ fontStyle: 'italic' }}>
        Processing...
      </Typography>
    </Box>
  );
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const isThisYear = date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  if (isYesterday) {
    return `Yesterday, ${timeStr}`;
  }

  if (isThisYear) {
    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  return `${date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })}, ${timeStr}`;
}
