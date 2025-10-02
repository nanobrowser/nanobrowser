import { useState, useEffect, useCallback, useRef } from 'react';
import type { DemonstrationRecording, ProceduralMemory } from '@extension/storage';
import RecordingControl from './RecordingControl';
import RecordingsList from './RecordingsList';
import MemoriesList from './MemoriesList';

interface MemoryPanelProps {
  isDarkMode: boolean;
  portRef: React.MutableRefObject<chrome.runtime.Port | null>;
}

const MemoryPanel = ({ isDarkMode, portRef }: MemoryPanelProps) => {
  const [recordings, setRecordings] = useState<DemonstrationRecording[]>([]);
  const [memories, setMemories] = useState<ProceduralMemory[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const recordingTimerRef = useRef<number | null>(null);

  // Load initial data
  const loadData = useCallback(() => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({ type: 'get_recordings' });
      portRef.current.postMessage({ type: 'get_memories' });
    } catch (error) {
      console.error('Failed to load memory data:', error);
    }
  }, [portRef]);

  // Load data on mount
  useEffect(() => {
    setIsLoading(true);
    loadData();
    // Set timeout to stop loading state even if no response
    const timeout = setTimeout(() => setIsLoading(false), 2000);
    return () => clearTimeout(timeout);
  }, [loadData]);

  // Handle messages from background
  useEffect(() => {
    if (!portRef.current) return;

    const handleMessage = (msg: unknown) => {
      const message = msg as { type: string; [key: string]: unknown };

      switch (message.type) {
        case 'recording_started':
          setIsRecording(true);
          setIsPaused(false);
          setRecordingDuration(0);
          // Start timer
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
          }
          recordingTimerRef.current = window.setInterval(() => {
            setRecordingDuration(prev => prev + 1);
          }, 1000);
          break;

        case 'recording_stopped':
          setIsRecording(false);
          setIsPaused(false);
          setRecordingDuration(0);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          // Reload recordings list
          setTimeout(() => loadData(), 500);
          break;

        case 'recording_paused':
          setIsPaused(true);
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          break;

        case 'recording_resumed':
          setIsPaused(false);
          // Restart timer
          recordingTimerRef.current = window.setInterval(() => {
            setRecordingDuration(prev => prev + 1);
          }, 1000);
          break;

        case 'memory_built':
          // Reload both recordings and memories
          setTimeout(() => loadData(), 500);
          break;

        case 'recordings_list':
          setRecordings((message.recordings as DemonstrationRecording[]) || []);
          setIsLoading(false);
          break;

        case 'memories_list':
          setMemories((message.memories as ProceduralMemory[]) || []);
          setIsLoading(false);
          break;

        case 'recording_deleted':
          setRecordings(prev => prev.filter(r => r.id !== message.recordingId));
          break;

        case 'memory_deleted':
          setMemories(prev => prev.filter(m => m.id !== message.memoryId));
          break;

        case 'error':
          console.error('Memory panel error:', message.error);
          alert(`Error: ${message.error}`);
          setIsRecording(false);
          setIsPaused(false);
          break;
      }
    };

    portRef.current.onMessage.addListener(handleMessage);

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [portRef, loadData]);

  const handleStartRecording = (title: string, description?: string) => {
    if (!portRef.current) {
      alert('Connection to background service not established');
      return;
    }

    try {
      portRef.current.postMessage({
        type: 'start_recording',
        title,
        description,
      });
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Failed to start recording. Please try again.');
    }
  };

  const handleStopRecording = () => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({ type: 'stop_recording' });
    } catch (error) {
      console.error('Failed to stop recording:', error);
    }
  };

  const handlePauseRecording = () => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({ type: 'pause_recording' });
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  };

  const handleResumeRecording = () => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({ type: 'resume_recording' });
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  };

  const handleBuildMemory = (recordingId: string) => {
    if (!portRef.current) return;

    const recording = recordings.find(r => r.id === recordingId);
    if (!recording) return;

    try {
      portRef.current.postMessage({
        type: 'build_memory',
        recordingId,
        title: recording.title,
        useLLM: false, // Can be made configurable
      });

      // Show loading feedback
      alert('Building procedural memory... This may take a moment.');
    } catch (error) {
      console.error('Failed to build memory:', error);
      alert('Failed to build memory. Please try again.');
    }
  };

  const handleDeleteRecording = (recordingId: string) => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({
        type: 'delete_recording',
        recordingId,
      });
    } catch (error) {
      console.error('Failed to delete recording:', error);
    }
  };

  const handleDeleteMemory = (memoryId: string) => {
    if (!portRef.current) return;

    try {
      portRef.current.postMessage({
        type: 'delete_memory',
        memoryId,
      });
    } catch (error) {
      console.error('Failed to delete memory:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div
            className={`mx-auto mb-4 size-8 animate-spin rounded-full border-2 ${
              isDarkMode ? 'border-sky-400 border-t-transparent' : 'border-sky-500 border-t-transparent'
            }`}></div>
          <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Loading memory data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {/* Recording Control */}
        <RecordingControl
          isDarkMode={isDarkMode}
          onStartRecording={handleStartRecording}
          onStopRecording={handleStopRecording}
          onPauseRecording={handlePauseRecording}
          onResumeRecording={handleResumeRecording}
          isRecording={isRecording}
          isPaused={isPaused}
          recordingDuration={recordingDuration}
        />

        {/* Recordings List */}
        <RecordingsList
          recordings={recordings}
          isDarkMode={isDarkMode}
          onBuildMemory={handleBuildMemory}
          onDeleteRecording={handleDeleteRecording}
        />

        {/* Memories List */}
        <MemoriesList memories={memories} isDarkMode={isDarkMode} onDeleteMemory={handleDeleteMemory} />

        {/* Help text */}
        {recordings.length === 0 && memories.length === 0 && (
          <div
            className={`rounded-lg border p-4 ${isDarkMode ? 'border-sky-800 bg-sky-900/20' : 'border-sky-200 bg-sky-50'}`}>
            <h4 className={`mb-2 font-semibold ${isDarkMode ? 'text-sky-300' : 'text-sky-700'}`}>
              💡 How to use Procedural Memory
            </h4>
            <ol className={`space-y-2 text-sm ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              <li>1. Enter a title and start recording</li>
              <li>2. Perform your actions in the browser (navigate pages, switch tabs, etc.)</li>
              <li>3. Stop the recording when done</li>
              <li>4. Click "Build Memory" to create a reusable procedural memory</li>
              <li>5. The agent can later retrieve and use these memories for similar tasks</li>
            </ol>
            <p className={`mt-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              Note: Currently captures navigation and tab switches. Full DOM interaction recording coming soon!
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemoryPanel;
