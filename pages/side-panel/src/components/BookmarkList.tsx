import { useState, useRef, useEffect } from 'react';
import { Grid, Card, CardActionArea, CardContent, Typography, IconButton, TextField, Box, Paper } from '@mui/material';
import { Delete, Edit, Check, Close } from '@mui/icons-material';
import { t } from '@extension/i18n';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkUpdateTitle?: (id: number, title: string) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
}

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkUpdateTitle,
  onBookmarkDelete,
  onBookmarkReorder,
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleEditClick = (bookmark: Bookmark) => {
    setEditingId(bookmark.id);
    setEditTitle(bookmark.title);
  };

  const handleSaveEdit = (id: number) => {
    if (onBookmarkUpdateTitle && editTitle.trim()) {
      onBookmarkUpdateTitle(id, editTitle);
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (draggedId === null || draggedId === targetId) return;

    if (onBookmarkReorder) {
      onBookmarkReorder(draggedId, targetId);
    }
  };

  useEffect(() => {
    if (editingId !== null && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingId]);

  return (
    <Box sx={{ p: 2 }}>
      {/*       <Typography variant="h6" sx={{ mb: 2, color: 'white' }}>
        {t('chat_bookmarks_header')}
      </Typography> */}
      <Grid container spacing={2}>
        {bookmarks.map(bookmark => (
          <Grid
            item
            xs={12}
            sm={6}
            key={bookmark.id}
            draggable={editingId !== bookmark.id}
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}>
            <Paper
              sx={{
                backdropFilter: 'blur(10px)',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                '&:hover': {
                  backgroundColor: 'rgba(255, 255, 255, 0.2)',
                },
              }}>
              {editingId === bookmark.id ? (
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <TextField
                      inputRef={inputRef}
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      size="small"
                      variant="outlined"
                      fullWidth
                      sx={{ '.MuiInputBase-root': { color: 'white' } }}
                    />
                    <IconButton onClick={() => handleSaveEdit(bookmark.id)} size="small" sx={{ color: 'white' }}>
                      <Check />
                    </IconButton>
                    <IconButton onClick={handleCancelEdit} size="small" sx={{ color: 'white' }}>
                      <Close />
                    </IconButton>
                  </Box>
                </CardContent>
              ) : (
                <CardActionArea onClick={() => onBookmarkSelect(bookmark.content)}>
                  <CardContent>
                    <Typography noWrap sx={{ color: 'white' }}>
                      {bookmark.title}
                    </Typography>
                    <Box sx={{ position: 'absolute', top: 0, right: 0, zIndex: 1 }}>
                      <IconButton
                        onClick={e => {
                          e.stopPropagation();
                          handleEditClick(bookmark);
                        }}
                        size="small"
                        sx={{ color: 'white' }}>
                        <Edit fontSize="small" />
                      </IconButton>
                      <IconButton
                        onClick={e => {
                          e.stopPropagation();
                          onBookmarkDelete?.(bookmark.id);
                        }}
                        size="small"
                        sx={{ color: 'white' }}>
                        <Delete fontSize="small" />
                      </IconButton>
                    </Box>
                  </CardContent>
                </CardActionArea>
              )}
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};

export default BookmarkList;
