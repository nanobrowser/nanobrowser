import { useState, useEffect } from 'react';
import { FaCircle, FaPause, FaPlay, FaStop } from 'react-icons/fa';

interface RecordingControlProps {
  isDarkMode: boolean;
  onStartRecording: (title: string, description?: string) => void;
  onStopRecording: () => void;
  onPauseRecording: () => void;
  onResumeRecording: () => void;
  isRecording: boolean;
  isPaused: boolean;
  recordingDuration: number;
}

const RecordingControl = ({
  isDarkMode,
  onStartRecording,
  onStopRecording,
  onPauseRecording,
  onResumeRecording,
  isRecording,
  isPaused,
  recordingDuration,
}: RecordingControlProps) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Format duration as MM:SS
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleStart = () => {
    if (!title.trim()) {
      alert('Please enter a title for the recording');
      return;
    }
    onStartRecording(title.trim(), description.trim() || undefined);
  };

  return (
    <div
      className={`rounded-lg p-4 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-200'} border shadow-sm`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className={`text-lg font-semibold ${isDarkMode ? 'text-sky-300' : 'text-sky-700'}`}>
          {isRecording ? '🔴 Recording' : '📹 Demonstration Recording'}
        </h3>
        {isRecording && (
          <div className={`flex items-center gap-2 ${isDarkMode ? 'text-sky-400' : 'text-sky-600'}`}>
            {!isPaused && <FaCircle className="animate-pulse text-red-500" size={8} />}
            <span className="font-mono text-sm">{formatDuration(recordingDuration)}</span>
          </div>
        )}
      </div>

      {!isRecording ? (
        // Setup form
        <div className="space-y-3">
          <div>
            <label
              htmlFor="recording-title"
              className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Title *
            </label>
            <input
              id="recording-title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g., Create Linear Issue"
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                isDarkMode
                  ? 'border-slate-600 bg-slate-700 text-white placeholder-slate-400 focus:ring-sky-500'
                  : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-sky-400'
              }`}
            />
          </div>

          <div>
            <label
              htmlFor="recording-description"
              className={`mb-1 block text-sm font-medium ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Description (optional)
            </label>
            <textarea
              id="recording-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What will this demonstration show?"
              rows={2}
              className={`w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                isDarkMode
                  ? 'border-slate-600 bg-slate-700 text-white placeholder-slate-400 focus:ring-sky-500'
                  : 'border-slate-300 bg-white text-slate-900 placeholder-slate-400 focus:ring-sky-400'
              }`}
            />
          </div>

          <button
            onClick={handleStart}
            disabled={!title.trim()}
            className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
              !title.trim()
                ? 'cursor-not-allowed bg-slate-400 text-slate-200'
                : isDarkMode
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-red-500 text-white hover:bg-red-600'
            }`}>
            <FaCircle size={12} />
            Start Recording
          </button>

          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
            💡 Tip: After starting, perform your actions in the browser. The system will record your navigation and
            interactions.
          </p>
        </div>
      ) : (
        // Recording controls
        <div className="space-y-3">
          <div
            className={`rounded-md p-3 ${isDarkMode ? 'bg-slate-900 border-slate-700' : 'bg-sky-50 border-sky-200'} border`}>
            <p className={`text-sm font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{title}</p>
            {description && (
              <p className={`mt-1 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{description}</p>
            )}
          </div>

          <div className="flex gap-2">
            {!isPaused ? (
              <button
                onClick={onPauseRecording}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                    : 'bg-yellow-500 text-white hover:bg-yellow-600'
                }`}>
                <FaPause size={12} />
                Pause
              </button>
            ) : (
              <button
                onClick={onResumeRecording}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                  isDarkMode
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-green-500 text-white hover:bg-green-600'
                }`}>
                <FaPlay size={12} />
                Resume
              </button>
            )}

            <button
              onClick={onStopRecording}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                isDarkMode ? 'bg-red-700 text-white hover:bg-red-800' : 'bg-red-600 text-white hover:bg-red-700'
              }`}>
              <FaStop size={12} />
              Stop & Save
            </button>
          </div>

          <p className={`text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
            {isPaused ? '⏸️ Recording paused' : '⏺️ Recording in progress - perform your actions now'}
          </p>
        </div>
      )}
    </div>
  );
};

export default RecordingControl;
