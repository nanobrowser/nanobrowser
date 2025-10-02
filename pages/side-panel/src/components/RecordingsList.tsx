import { FaTrash, FaCog, FaCheck, FaClock } from 'react-icons/fa';
import type { DemonstrationRecording } from '@extension/storage';

interface RecordingsListProps {
  recordings: DemonstrationRecording[];
  isDarkMode: boolean;
  onBuildMemory: (recordingId: string) => void;
  onDeleteRecording: (recordingId: string) => void;
}

const RecordingsList = ({ recordings, isDarkMode, onBuildMemory, onDeleteRecording }: RecordingsListProps) => {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  };

  const formatDuration = (start: number, end: number) => {
    const durationSec = Math.floor((end - start) / 1000);
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
  };

  if (recordings.length === 0) {
    return (
      <div
        className={`rounded-lg p-6 text-center ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-200'} border`}>
        <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
          No recordings yet. Start recording to capture demonstrations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
        📹 Recordings ({recordings.length})
      </h3>

      {recordings.map(recording => (
        <div
          key={recording.id}
          className={`rounded-lg border p-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-200'}`}>
          <div className="mb-2 flex items-start justify-between">
            <div className="flex-1">
              <h4 className={`font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{recording.title}</h4>
              {recording.description && (
                <p className={`mt-1 text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                  {recording.description}
                </p>
              )}
            </div>
            {recording.processed && (
              <span
                className={`ml-2 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${
                  isDarkMode ? 'bg-green-900 text-green-300' : 'bg-green-100 text-green-700'
                }`}>
                <FaCheck size={10} />
                Memory Built
              </span>
            )}
          </div>

          <div className={`mb-3 flex flex-wrap gap-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
            <span>{recording.steps.length} steps</span>
            <span>•</span>
            <span>{formatDuration(recording.startedAt, recording.completedAt)}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <FaClock size={10} />
              {formatDate(recording.completedAt)}
            </span>
          </div>

          {/* Show first few steps preview */}
          {recording.steps.length > 0 && (
            <details className={`mb-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              <summary className="cursor-pointer hover:underline">View steps</summary>
              <div className="mt-2 space-y-1 rounded bg-slate-900/20 p-2">
                {recording.steps.slice(0, 5).map((step, idx) => (
                  <div key={idx} className="font-mono">
                    {idx + 1}. {step.action}: {step.description}
                  </div>
                ))}
                {recording.steps.length > 5 && <div className="italic">... and {recording.steps.length - 5} more</div>}
              </div>
            </details>
          )}

          <div className="flex gap-2">
            {!recording.processed ? (
              <button
                onClick={() => onBuildMemory(recording.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isDarkMode ? 'bg-sky-600 text-white hover:bg-sky-700' : 'bg-sky-500 text-white hover:bg-sky-600'
                }`}>
                <FaCog size={12} />
                Build Memory
              </button>
            ) : (
              <div
                className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                  isDarkMode ? 'bg-slate-700 text-slate-400' : 'bg-slate-100 text-slate-600'
                }`}>
                <FaCheck size={12} />
                Memory Created
              </div>
            )}

            <button
              onClick={() => {
                if (confirm(`Delete recording "${recording.title}"?`)) {
                  onDeleteRecording(recording.id);
                }
              }}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${
                isDarkMode
                  ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
              aria-label="Delete recording">
              <FaTrash size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

export default RecordingsList;
