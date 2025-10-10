/* eslint-disable react/prop-types */
import React from 'react';

// Import types from storage package
interface AccessibilityIssue {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  wcagReference: string;
  currentValue?: string;
  recommendation: string;
}

interface AccessibilityImprovement {
  attribute: string;
  suggestedValue: string;
  reasoning: string;
  priority: number;
}

interface ActionInfo {
  actionId: string;
  actionType: 'button' | 'link' | 'input' | 'select' | 'textarea' | 'custom-control';
  tagName: string;
  selector: string;
  outerHTML: string;
  accessibilityState: {
    hasAriaLabel: boolean;
    ariaLabel?: string;
    hasTextContent: boolean;
    textContent?: string;
    role?: string;
  };
  issues: AccessibilityIssue[];
  improvements: AccessibilityImprovement[];
  accessibilityScore: number;
  visionContext?: {
    visualDescription: string;
    suggestedAriaLabel: string;
    confidence: number;
  };
}

interface ActionAnalysisResult {
  pageUrl: string;
  analyzedAt: number;
  totalActionsFound: number;
  totalIssues: number;
  criticalIssues: number;
  averageAccessibilityScore: number;
  actions: ActionInfo[];
  summaryBySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
}

interface ActionAccessibilityAnalyzerProps {
  analysisResult: ActionAnalysisResult | null;
  onAnalyze: () => void;
  onClose: () => void;
  visible: boolean;
  isDarkMode?: boolean;
  isAnalyzing?: boolean;
  onApplyImprovement?: (action: any, improvement: any) => void;
  onApplyAllImprovements?: (action: any) => void;
  isApplying?: boolean;
}

const ActionAccessibilityAnalyzer: React.FC<ActionAccessibilityAnalyzerProps> = ({
  analysisResult,
  onAnalyze,
  onClose,
  visible,
  isDarkMode = false,
  isAnalyzing = false,
  onApplyImprovement,
  onApplyAllImprovements,
  isApplying = false,
}) => {
  const [expandedActions, setExpandedActions] = React.useState<Set<string>>(new Set());

  const toggleExpanded = (actionId: string) => {
    setExpandedActions(prev => {
      const next = new Set(prev);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return isDarkMode ? 'text-red-400' : 'text-red-600';
      case 'high':
        return isDarkMode ? 'text-orange-400' : 'text-orange-600';
      case 'medium':
        return isDarkMode ? 'text-yellow-400' : 'text-yellow-600';
      case 'low':
        return isDarkMode ? 'text-blue-400' : 'text-blue-600';
      case 'info':
        return isDarkMode ? 'text-gray-400' : 'text-gray-600';
      default:
        return isDarkMode ? 'text-gray-400' : 'text-gray-600';
    }
  };

  const getSeverityBadge = (severity: string) => {
    const baseClasses = 'rounded px-2 py-0.5 text-xs font-medium';
    switch (severity) {
      case 'critical':
        return `${baseClasses} ${isDarkMode ? 'bg-red-900/50 text-red-300' : 'bg-red-100 text-red-800'}`;
      case 'high':
        return `${baseClasses} ${isDarkMode ? 'bg-orange-900/50 text-orange-300' : 'bg-orange-100 text-orange-800'}`;
      case 'medium':
        return `${baseClasses} ${isDarkMode ? 'bg-yellow-900/50 text-yellow-300' : 'bg-yellow-100 text-yellow-800'}`;
      case 'low':
        return `${baseClasses} ${isDarkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-800'}`;
      case 'info':
        return `${baseClasses} ${isDarkMode ? 'bg-gray-900/50 text-gray-300' : 'bg-gray-100 text-gray-800'}`;
      default:
        return `${baseClasses} ${isDarkMode ? 'bg-gray-900/50 text-gray-300' : 'bg-gray-100 text-gray-800'}`;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return isDarkMode ? 'text-green-400' : 'text-green-600';
    if (score >= 70) return isDarkMode ? 'text-yellow-400' : 'text-yellow-600';
    if (score >= 50) return isDarkMode ? 'text-orange-400' : 'text-orange-600';
    return isDarkMode ? 'text-red-400' : 'text-red-600';
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!visible) return null;

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className={`text-lg font-semibold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>
          Action Accessibility Analysis
        </h2>
        <button
          onClick={onClose}
          className={`text-sm ${isDarkMode ? 'text-gray-400 hover:text-gray-200' : 'text-gray-600 hover:text-gray-800'}`}>
          ✕
        </button>
      </div>

      {/* Analyze Button */}
      <div className="mb-4">
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className={`w-full rounded-lg p-3 transition-all ${
            isDarkMode
              ? 'bg-purple-600 text-white hover:bg-purple-500 disabled:bg-purple-800'
              : 'bg-purple-500 text-white hover:bg-purple-600 disabled:bg-purple-300'
          } disabled:cursor-not-allowed`}>
          {isAnalyzing ? 'Analyzing Actions...' : 'Analyze Interactive Elements'}
        </button>
      </div>

      {/* Analysis Summary */}
      {analysisResult && (
        <>
          <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} mb-4 p-4 backdrop-blur-sm`}>
            <h3 className={`mb-3 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
              Analysis Summary
            </h3>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Total Actions:</span>
                <span className={isDarkMode ? 'text-gray-200' : 'text-gray-900'}>
                  {analysisResult.totalActionsFound}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Total Issues:</span>
                <span className={getSeverityColor(analysisResult.totalIssues > 0 ? 'critical' : 'info')}>
                  {analysisResult.totalIssues}
                </span>
              </div>
              <div className="flex justify-between">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Critical Issues:</span>
                <span className={getSeverityColor('critical')}>{analysisResult.criticalIssues}</span>
              </div>
              <div className="flex justify-between">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Average Score:</span>
                <span className={getScoreColor(analysisResult.averageAccessibilityScore)}>
                  {analysisResult.averageAccessibilityScore.toFixed(0)}/100
                </span>
              </div>
              <div className="flex justify-between">
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Analyzed:</span>
                <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                  {formatDate(analysisResult.analyzedAt)}
                </span>
              </div>
            </div>

            {/* Issues by Severity */}
            {analysisResult.totalIssues > 0 && (
              <div className="mt-4">
                <h4 className={`mb-2 text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
                  Issues by Severity
                </h4>
                <div className="flex flex-wrap gap-2">
                  {analysisResult.summaryBySeverity.critical > 0 && (
                    <span className={getSeverityBadge('critical')}>
                      Critical: {analysisResult.summaryBySeverity.critical}
                    </span>
                  )}
                  {analysisResult.summaryBySeverity.high > 0 && (
                    <span className={getSeverityBadge('high')}>High: {analysisResult.summaryBySeverity.high}</span>
                  )}
                  {analysisResult.summaryBySeverity.medium > 0 && (
                    <span className={getSeverityBadge('medium')}>
                      Medium: {analysisResult.summaryBySeverity.medium}
                    </span>
                  )}
                  {analysisResult.summaryBySeverity.low > 0 && (
                    <span className={getSeverityBadge('low')}>Low: {analysisResult.summaryBySeverity.low}</span>
                  )}
                  {analysisResult.summaryBySeverity.info > 0 && (
                    <span className={getSeverityBadge('info')}>Info: {analysisResult.summaryBySeverity.info}</span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Action Elements List */}
          {analysisResult.actions.length > 0 && (
            <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-4 backdrop-blur-sm`}>
              <h3 className={`mb-3 text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-900'}`}>
                Interactive Elements ({analysisResult.actions.length})
              </h3>
              <div className="space-y-3">
                {analysisResult.actions
                  .sort((a, b) => a.accessibilityScore - b.accessibilityScore)
                  .map(action => {
                    const isExpanded = expandedActions.has(action.actionId);
                    return (
                      <div
                        key={action.actionId}
                        className={`rounded-lg border p-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
                        {/* Action Header */}
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                {action.tagName.toUpperCase()} ({action.actionType})
                              </span>
                              <span className={`text-xs ${getScoreColor(action.accessibilityScore)}`}>
                                Score: {action.accessibilityScore}
                              </span>
                            </div>
                            <code className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                              {action.selector}
                            </code>
                          </div>
                          <button
                            onClick={() => toggleExpanded(action.actionId)}
                            className={`text-xs ${isDarkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'}`}>
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        </div>

                        {/* Current State */}
                        <div className={`mb-2 rounded p-2 ${isDarkMode ? 'bg-slate-900/50' : 'bg-gray-100'}`}>
                          <div className="text-xs">
                            <span className={`font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                              Current:
                            </span>
                            {action.accessibilityState.ariaLabel ? (
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                {' '}
                                aria-label="{action.accessibilityState.ariaLabel}"
                              </span>
                            ) : action.accessibilityState.textContent ? (
                              <span className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                {' '}
                                text="{action.accessibilityState.textContent}"
                              </span>
                            ) : (
                              <span className={getSeverityColor('critical')}> No accessible name</span>
                            )}
                          </div>
                        </div>

                        {/* Issues Summary */}
                        {action.issues.length > 0 && (
                          <div className="mb-2">
                            <div className="flex flex-wrap gap-1">
                              {action.issues.map((issue, idx) => (
                                <span key={idx} className={getSeverityBadge(issue.severity)}>
                                  {issue.severity.toUpperCase()}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Top Improvement */}
                        {action.improvements.length > 0 && (
                          <div className={`rounded p-2 ${isDarkMode ? 'bg-green-900/20' : 'bg-green-50'}`}>
                            <div className="text-xs">
                              <span className={`font-medium ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
                                Suggested:
                              </span>
                              <span className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                                {' '}
                                {action.improvements[0].attribute}="{action.improvements[0].suggestedValue}"
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="mt-3 space-y-3 border-t pt-3 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}">
                            {/* Vision Context */}
                            {action.visionContext && (
                              <div>
                                <h4
                                  className={`mb-1 text-xs font-medium ${isDarkMode ? 'text-purple-400' : 'text-purple-600'}`}>
                                  AI Vision Analysis (confidence: {(action.visionContext.confidence * 100).toFixed(0)}%)
                                </h4>
                                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {action.visionContext.visualDescription}
                                </p>
                              </div>
                            )}

                            {/* Issues Details */}
                            {action.issues.length > 0 && (
                              <div>
                                <h4
                                  className={`mb-1 text-xs font-medium ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                                  Issues ({action.issues.length})
                                </h4>
                                <div className="space-y-2">
                                  {action.issues.map((issue, idx) => (
                                    <div
                                      key={idx}
                                      className={`rounded p-2 text-xs ${isDarkMode ? 'bg-slate-900/50' : 'bg-gray-100'}`}>
                                      <div className={`font-medium ${getSeverityColor(issue.severity)}`}>
                                        {issue.type}
                                      </div>
                                      <div className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                                        {issue.description}
                                      </div>
                                      <div className={`mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                        {issue.wcagReference}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* All Improvements */}
                            {action.improvements.length > 0 && (
                              <div>
                                <h4
                                  className={`mb-1 text-xs font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                                  Improvements ({action.improvements.length})
                                </h4>
                                <div className="space-y-2">
                                  {action.improvements.map((improvement, idx) => (
                                    <div
                                      key={idx}
                                      className={`rounded p-2 text-xs ${isDarkMode ? 'bg-slate-900/50' : 'bg-gray-100'}`}>
                                      <div
                                        className={`font-medium ${isDarkMode ? 'text-green-400' : 'text-green-700'}`}>
                                        {improvement.attribute}
                                      </div>
                                      <div className={`font-mono ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                        "{improvement.suggestedValue}"
                                      </div>
                                      <div className={`mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        {improvement.reasoning}
                                      </div>
                                      <div className={`mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
                                        Priority: {improvement.priority}/10
                                      </div>
                                      {onApplyImprovement && (
                                        <button
                                          onClick={() => onApplyImprovement(action, improvement)}
                                          disabled={isApplying}
                                          className={`mt-2 w-full rounded px-2 py-1 text-xs font-medium transition-colors ${
                                            isDarkMode
                                              ? 'bg-green-600 text-white hover:bg-green-500 disabled:bg-green-800'
                                              : 'bg-green-500 text-white hover:bg-green-600 disabled:bg-green-300'
                                          } disabled:cursor-not-allowed disabled:opacity-50`}>
                                          {isApplying ? 'Applying...' : 'Apply'}
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                                {onApplyAllImprovements && action.improvements.length > 0 && (
                                  <button
                                    onClick={() => onApplyAllImprovements(action)}
                                    disabled={isApplying}
                                    className={`mt-2 w-full rounded px-3 py-2 text-xs font-medium transition-colors ${
                                      isDarkMode
                                        ? 'bg-green-600 text-white hover:bg-green-500 disabled:bg-green-800'
                                        : 'bg-green-500 text-white hover:bg-green-600 disabled:bg-green-300'
                                    } disabled:cursor-not-allowed disabled:opacity-50`}>
                                    {isApplying
                                      ? 'Applying...'
                                      : `Apply All Improvements (${action.improvements.length})`}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* HTML Preview */}
                            <div>
                              <h4
                                className={`mb-1 text-xs font-medium ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                HTML
                              </h4>
                              <pre
                                className={`overflow-x-auto rounded p-2 text-xs ${isDarkMode ? 'bg-slate-900 text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
                                {action.outerHTML}
                              </pre>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </>
      )}

      {/* No Results */}
      {!analysisResult && !isAnalyzing && (
        <div className={`rounded-lg ${isDarkMode ? 'bg-slate-800' : 'bg-white/50'} p-8 text-center backdrop-blur-sm`}>
          <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Click "Analyze Interactive Elements" to start the accessibility analysis
          </p>
        </div>
      )}
    </div>
  );
};

export default ActionAccessibilityAnalyzer;
