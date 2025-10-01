/* eslint-disable react/prop-types */
import React from 'react';
interface PageData {
  id: string;
  pageUrl: string;
  pageSummary: string;
  imageAnalysis?: {
    imageUrl: string;
    currentAlt: string;
    generatedAlt?: string;
  }[];
  createdAt: number;
  updatedAt: number;
}

interface AccessibilityAnalyzerProps {
  currentPageData: PageData | null;
  onHandleStarBasicAnalysis: () => void;
  onClose: () => void;
  visible: boolean;
  isDarkMode?: boolean;
  isAnalyzing?: boolean;
  // accessibilityResult?: string | null;
}

const AccessibilityAnalyzer: React.FC<AccessibilityAnalyzerProps> = ({
  currentPageData,
  onHandleStarBasicAnalysis,
  onClose,
  visible,
  isDarkMode = false,
  isAnalyzing = false,
}) => {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (!visible || !currentPageData) return null;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-center justify-between">
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
      <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} mb-4 p-4 backdrop-blur-sm`}>
        <h3 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>Current Page</h3>
        <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'} break-all`}>
          {currentPageData.pageUrl}
        </p>
        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          created at: {formatDate(currentPageData.createdAt)}
        </p>
        <p className={`mt-1 text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          update at: {formatDate(currentPageData.updatedAt)}
        </p>
      </div>

      {/* Analysis Button */}
      <div className="mb-4">
        <button
          onClick={onHandleStarBasicAnalysis}
          disabled={isAnalyzing}
          className={`w-full rounded-lg p-3 transition-all ${
            isDarkMode
              ? 'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-blue-800'
              : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-blue-300'
          } disabled:cursor-not-allowed`}>
          {isAnalyzing ? 'Analyzing...' : 'Start Accessibility Analysis'}
        </button>
      </div>

      {/* Live Analysis Result */}
      {currentPageData.pageSummary && (
        <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} mb-4 p-4 backdrop-blur-sm`}>
          <h3 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            VisibleAi Summary
          </h3>
          <div
            className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} whitespace-pre-wrap leading-relaxed`}>
            {currentPageData.pageSummary || 'No summary available.'}
          </div>
        </div>
      )}
      {currentPageData.imageAnalysis && currentPageData.imageAnalysis.length > 0 && (
        <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
          <h3 className={`mb-3 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
            Image Analysis ({currentPageData.imageAnalysis.length} images)
          </h3>
          <div className="space-y-3">
            {currentPageData.imageAnalysis.map((image, index) => (
              <div
                key={index}
                className={`rounded-lg border p-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* {accessibilityReport && (
        <div className="space-y-4">
        
          <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
            <h3 className={`mb-2 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              Page Summary
            </h3>
            <p className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              {accessibilityReport.pageSummary}
            </p>
          </div>

          {accessibilityReport.imageAnalysis && accessibilityReport.imageAnalysis.length > 0 && (
            <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
              <h3 className={`mb-3 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                Image Analysis ({accessibilityReport.imageAnalysis.length} images)
              </h3>
              <div className="space-y-3">
                {accessibilityReport.imageAnalysis.map((image, index) => (
                  <div
                    key={index}
                    className={`rounded-lg border p-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
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
      )} */}
    </div>
  );
};

export default AccessibilityAnalyzer;
