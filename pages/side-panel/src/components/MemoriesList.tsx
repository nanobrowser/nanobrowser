import { useState } from 'react';
import { FaTrash, FaChevronDown, FaChevronRight, FaClock, FaTags } from 'react-icons/fa';
import type { ProceduralMemory } from '@extension/storage';

interface MemoriesListProps {
  memories: ProceduralMemory[];
  isDarkMode: boolean;
  onDeleteMemory: (memoryId: string) => void;
}

const MemoriesList = ({ memories, isDarkMode, onDeleteMemory }: MemoriesListProps) => {
  const [expandedMemories, setExpandedMemories] = useState<Set<string>>(new Set());

  const toggleExpanded = (memoryId: string) => {
    setExpandedMemories(prev => {
      const next = new Set(prev);
      if (next.has(memoryId)) {
        next.delete(memoryId);
      } else {
        next.add(memoryId);
      }
      return next;
    });
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffDays < 1) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.7) return isDarkMode ? 'text-green-400' : 'text-green-600';
    if (confidence >= 0.4) return isDarkMode ? 'text-yellow-400' : 'text-yellow-600';
    return isDarkMode ? 'text-red-400' : 'text-red-600';
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.7) return 'High';
    if (confidence >= 0.4) return 'Medium';
    return 'Low';
  };

  if (memories.length === 0) {
    return (
      <div
        className={`rounded-lg p-6 text-center ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-200'} border`}>
        <p className={`text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
          No procedural memories yet. Build memories from your recordings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
        🧠 Procedural Memories ({memories.length})
      </h3>

      {memories.map(memory => {
        const isExpanded = expandedMemories.has(memory.id);

        return (
          <div
            key={memory.id}
            className={`rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-sky-200'}`}>
            {/* Header - Always visible */}
            <div className="p-4">
              <div className="mb-2 flex items-start justify-between">
                <div className="flex-1">
                  <h4 className={`font-medium ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{memory.title}</h4>
                  <p className={`mt-1 text-sm ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                    {memory.abstract.goal}
                  </p>
                </div>

                {memory.deprecated && (
                  <span
                    className={`ml-2 rounded-full px-2 py-1 text-xs font-medium ${
                      isDarkMode ? 'bg-red-900 text-red-300' : 'bg-red-100 text-red-700'
                    }`}>
                    Deprecated
                  </span>
                )}
              </div>

              {/* Metadata */}
              <div className={`mb-3 flex flex-wrap gap-3 text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                <span>{memory.steps.length} steps</span>
                <span>•</span>
                <span className={getConfidenceColor(memory.confidence)}>
                  {(memory.confidence * 100).toFixed(0)}% {getConfidenceLabel(memory.confidence)}
                </span>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <FaClock size={10} />
                  {formatDate(memory.updatedAt)}
                </span>
              </div>

              {/* Domains */}
              {memory.abstract.domains.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {memory.abstract.domains.map(domain => (
                    <span
                      key={domain}
                      className={`rounded-full px-2 py-1 text-xs ${
                        isDarkMode ? 'bg-blue-900/30 text-blue-300' : 'bg-blue-100 text-blue-700'
                      }`}>
                      {domain}
                    </span>
                  ))}
                </div>
              )}

              {/* Tags */}
              {memory.abstract.tags.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  <FaTags size={10} className={isDarkMode ? 'text-slate-500' : 'text-slate-400'} />
                  {memory.abstract.tags.slice(0, 3).map(tag => (
                    <span
                      key={tag}
                      className={`rounded px-2 py-0.5 text-xs ${
                        isDarkMode ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-700'
                      }`}>
                      {tag}
                    </span>
                  ))}
                  {memory.abstract.tags.length > 3 && (
                    <span className={`text-xs ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                      +{memory.abstract.tags.length - 3}
                    </span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => toggleExpanded(memory.id)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isDarkMode
                      ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}>
                  {isExpanded ? <FaChevronDown size={12} /> : <FaChevronRight size={12} />}
                  {isExpanded ? 'Hide' : 'View'} Details
                </button>

                <button
                  onClick={() => {
                    if (confirm(`Delete memory "${memory.title}"?`)) {
                      onDeleteMemory(memory.id);
                    }
                  }}
                  className={`rounded-md px-3 py-2 text-sm transition-colors ${
                    isDarkMode
                      ? 'bg-red-900/30 text-red-400 hover:bg-red-900/50'
                      : 'bg-red-50 text-red-600 hover:bg-red-100'
                  }`}
                  aria-label="Delete memory">
                  <FaTrash size={12} />
                </button>
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div
                className={`border-t p-4 ${isDarkMode ? 'border-slate-700 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
                {/* Abstract */}
                <div className="mb-4">
                  <h5 className={`mb-2 text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    Abstract
                  </h5>

                  {/* Parameters */}
                  {memory.abstract.parameters.length > 0 && (
                    <div className="mb-2">
                      <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Parameters:
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {memory.abstract.parameters.map(param => (
                          <code
                            key={param}
                            className={`rounded px-2 py-0.5 text-xs ${
                              isDarkMode ? 'bg-slate-800 text-sky-400' : 'bg-slate-200 text-sky-600'
                            }`}>
                            {'{'}
                            {param}
                            {'}'}
                          </code>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Prerequisites */}
                  {memory.abstract.prerequisites.length > 0 && (
                    <div className="mb-2">
                      <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        Prerequisites:
                      </p>
                      <ul
                        className={`mt-1 list-inside list-disc text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        {memory.abstract.prerequisites.map((prereq, idx) => (
                          <li key={idx}>{prereq}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Flow */}
                  {memory.abstract.flow.length > 0 && (
                    <div>
                      <p className={`text-xs font-medium ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        High-level flow:
                      </p>
                      <ol
                        className={`mt-1 list-inside list-decimal text-xs ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
                        {memory.abstract.flow.map((step, idx) => (
                          <li key={idx}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>

                {/* Steps */}
                <div>
                  <h5 className={`mb-2 text-sm font-semibold ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                    Steps ({memory.steps.length})
                  </h5>
                  <div className="space-y-1 text-xs">
                    {memory.steps.slice(0, 5).map((step, idx) => (
                      <div
                        key={idx}
                        className={`rounded p-2 font-mono ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                        <span className={isDarkMode ? 'text-slate-500' : 'text-slate-400'}>{idx + 1}.</span>{' '}
                        <span className={isDarkMode ? 'text-sky-400' : 'text-sky-600'}>{step.action}</span>
                        {' → '}
                        <span className={isDarkMode ? 'text-slate-300' : 'text-slate-700'}>{step.description}</span>
                      </div>
                    ))}
                    {memory.steps.length > 5 && (
                      <p className={`italic ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                        ... and {memory.steps.length - 5} more steps
                      </p>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className={`mt-4 rounded-md p-2 text-xs ${isDarkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                  <div className="flex justify-between">
                    <span className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>Success count:</span>
                    <span className={isDarkMode ? 'text-green-400' : 'text-green-600'}>{memory.successCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>Failure count:</span>
                    <span className={isDarkMode ? 'text-red-400' : 'text-red-600'}>{memory.failureCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={isDarkMode ? 'text-slate-400' : 'text-slate-600'}>Source:</span>
                    <span className={isDarkMode ? 'text-slate-300' : 'text-slate-700'}>
                      {memory.source === 'human_demo' ? '👤 Human Demo' : memory.source}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default MemoriesList;
