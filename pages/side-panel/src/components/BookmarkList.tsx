/* eslint-disable react/prop-types */
import { useState } from 'react';
import { FaTrash, FaPen } from 'react-icons/fa';
import { t } from '@extension/i18n';

interface Bookmark {
  id: number;
  title: string;
  content: string;
}

interface BookmarkListProps {
  bookmarks: Bookmark[];
  onBookmarkSelect: (content: string) => void;
  onBookmarkEdit?: (bookmark: Bookmark) => void;
  onBookmarkDelete?: (id: number) => void;
  onBookmarkReorder?: (draggedId: number, targetId: number) => void;
  onAddShortcut?: () => void;
  isDarkMode?: boolean;
}

const PlusIcon = () => (
  <svg
    stroke="currentColor"
    fill="currentColor"
    strokeWidth="0"
    viewBox="0 0 256 256"
    height="12.7px"
    width="12.7px"
    xmlns="http://www.w3.org/2000/svg">
    <path d="M228,128a12,12,0,0,1-12,12H140v76a12,12,0,0,1-24,0V140H40a12,12,0,0,1,0-24h76V40a12,12,0,0,1,24,0v76h76A12,12,0,0,1,228,128Z" />
  </svg>
);

const BookmarkList: React.FC<BookmarkListProps> = ({
  bookmarks,
  onBookmarkSelect,
  onBookmarkEdit,
  onBookmarkDelete,
  onBookmarkReorder,
  onAddShortcut,
  isDarkMode = false,
}) => {
  const [draggedId, setDraggedId] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, id: number) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id.toString());
    e.currentTarget.classList.add('opacity-25');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    e.currentTarget.classList.remove('opacity-25');
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

  const handleEditRequest = (bookmark: Bookmark) => {
    onBookmarkEdit?.(bookmark);
  };

  return (
    <div className="px-2 pb-2">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-[#333333]'}`}>
          {t('chat_bookmarks_header')}
        </h3>
        {onAddShortcut && (
          <button
            type="button"
            onClick={onAddShortcut}
            title={t('chat_bookmarks_add')}
            aria-label={t('chat_bookmarks_add')}
            className="flex h-6 w-6 items-center justify-center text-[#626262] transition-colors duration-150 hover:text-[#333333]"
          >
            <PlusIcon />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {bookmarks.map(bookmark => (
          <div
            key={bookmark.id}
            draggable
            onDragStart={e => handleDragStart(e, bookmark.id)}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDrop={e => handleDrop(e, bookmark.id)}
            className={`group relative rounded-lg p-3 ${
              isDarkMode ? 'bg-slate-800 hover:bg-slate-700' : 'bg-white hover:bg-gray-50'
            } border ${isDarkMode ? 'border-slate-700' : 'border-gray-200'}`}>
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => onBookmarkSelect(bookmark.content)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onBookmarkSelect(bookmark.content);
                  }
                }}
                className="w-full text-left">
                <div
                  className={`truncate pr-10 text-sm font-medium ${
                    isDarkMode ? 'text-gray-200' : 'text-[#333333]'
                  }`}>
                  {bookmark.title}
                </div>
              </button>
            </div>

            <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-[5px] opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <button
                onClick={e => {
                  e.stopPropagation();
                  handleEditRequest(bookmark);
                }}
                className="p-1 text-[#626262] transition-colors hover:text-[#333333]"
                aria-label={t('chat_bookmarks_edit')}
                type="button"
              >
                <FaPen size={12.7} />
              </button>
              <button
                onClick={e => {
                  e.stopPropagation();
                  if (onBookmarkDelete) {
                    onBookmarkDelete(bookmark.id);
                  }
                }}
                className="p-1 text-[#626262] transition-colors hover:text-[#333333]"
                aria-label={t('chat_bookmarks_delete')}
                type="button"
              >
                <FaTrash size={12.7} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BookmarkList;
