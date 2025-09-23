/* eslint-disable react/prop-types */
import React, { useState, useEffect } from 'react';
import { accessibilityStore, type AccessibilityReport } from '@extension/storage';

interface PageData {
  id: string;
  url: string;
  createdAt: number;
}

interface AccessibilityAnalyzerProps {
  currentPageData: PageData | null;
  onHandleStarBasicAnalysis: () => void;
  onClose: () => void;
  visible: boolean;
  isDarkMode?: boolean;
  isAnalyzing?: boolean;
}

const AccessibilityAnalyzer: React.FC<AccessibilityAnalyzerProps> = ({
  currentPageData,
  onHandleStarBasicAnalysis,
  onClose,
  visible,
  isDarkMode = false,
  isAnalyzing = false,
}) => {
  const [accessibilityReport, setAccessibilityReport] = useState<AccessibilityReport | null>(null);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  useEffect(() => {
    const loadExistingReport = async () => {
      if (currentPageData?.url) {
        const report = await accessibilityStore.getAccessibilityReport(currentPageData.url);
        setAccessibilityReport(report);
      }
    };
    loadExistingReport();
  }, [currentPageData?.url]);

  if (!visible || !currentPageData) return null;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Accessibility Analyzer
        </h2>
        <button
          onClick={onClose}
          className={`text-sm ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'}`}>
          ✕
        </button>
      </div>

      {/* Current Page URL */}
      <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 mb-4 backdrop-blur-sm`}>
        <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>Current Page</h3>
        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} break-all`}>{currentPageData.url}</p>
        <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          {formatDate(currentPageData.createdAt)}
        </p>
      </div>

      {/* Analysis Button */}
      <div className="mb-4">
        <button
          onClick={onHandleStarBasicAnalysis}
          disabled={isAnalyzing}
          className={`w-full p-3 rounded-lg transition-all ${
            isDarkMode
              ? 'bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white'
              : 'bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white'
          } disabled:cursor-not-allowed`}>
          {isAnalyzing ? 'Analyzing...' : 'Start Accessibility Analysis'}
        </button>
      </div>

      {/* Analysis Results */}
      {accessibilityReport && (
        <div className="space-y-4">
          {/* Summary Section */}
          <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
            <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              Page Summary
            </h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {accessibilityReport.pageSummary}
            </p>
          </div>

          {/* Images Section */}
          {accessibilityReport.imageAnalysis && accessibilityReport.imageAnalysis.length > 0 && (
            <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
              <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                Image Analysis ({accessibilityReport.imageAnalysis.length} images)
              </h3>
              <div className="space-y-3">
                {accessibilityReport.imageAnalysis.map((image, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg p-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                    <img
                      src={image.imageUrl}
                      alt={image.currentAlt || 'Image'}
                      className="mb-2 size-16 rounded object-cover"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <div className="space-y-2">
                      <div>
                        <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                          Current alt:
                        </span>
                        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                          {image.currentAlt || 'No alt text'}
                        </p>
                      </div>
                      {image.generatedAlt && (
                        <div>
                          <span className={`text-xs font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                            Generated alt:
                          </span>
                          <p className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                            {image.generatedAlt}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AccessibilityAnalyzer;
