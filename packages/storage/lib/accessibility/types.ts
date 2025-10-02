export interface AccessibilityReport {
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

export interface AccessibilityReportStorage {
  getAccessibilityReport: (pageUrl: string) => Promise<AccessibilityReport | null>;
  saveAccessibilityReport: (report: AccessibilityReport) => Promise<void>;
  deleteAccessibilityReport: (pageUrl: string) => Promise<void>;
  deleteAllReports: () => Promise<void>;
}

/**
 * Semantic areas of a web page for DOM context classification
 */
export enum SemanticArea {
  MAIN_CONTENT = 'main-content',
  HEADER = 'header',
  NAVIGATION = 'navigation',
  SIDEBAR = 'sidebar',
  FOOTER = 'footer',
  ADVERTISEMENT = 'advertisement',
  UNKNOWN = 'unknown',
}

/**
 * DOM context information for an image element
 * Provides structural and semantic context about where the image appears on the page
 */
export interface DOMContextInfo {
  /** Whether the image is within main content area (article, main tags) */
  isInMainContent: boolean;
  /** Whether the image is visible in the initial viewport */
  isInViewport: boolean;
  /** Whether the image is associated with an interactive element (button, link) */
  isInteractive: boolean;
  /** Hierarchical context chain (e.g., "body > main > article > figure") */
  parentContext: string;
  /** Semantic area classification of the image location */
  semanticArea: SemanticArea;
  /** Depth level in the DOM tree (0 = root) */
  hierarchyLevel: number;
  /** Text content surrounding the image (up to 150 chars) */
  surroundingText: string;
}

/**
 * Vision model validation context for an image
 * Provides AI-based relevance assessment when vision model is enabled
 */
export interface VisionContextInfo {
  /** Relevance score from 0 (irrelevant) to 1 (highly relevant) */
  relevanceScore: number;
  /** Human-readable explanation of why the image is relevant or not */
  relevanceReason: string;
  /** Visual description of the image content from vision model */
  visualDescription: string;
  /** Final boolean decision: should this image be included in analysis */
  isRelevant: boolean;
}

/**
 * Enhanced image information with DOM and optional vision context
 * Extends basic image info with structural and AI-based relevance data
 */
export interface ContextualizedImageInfo {
  /** URL of the image */
  imageUrl: string;
  /** Current alt text from the HTML (may be empty) */
  currentAlt: string;
  /** CSS selector to locate the image element */
  selector: string;
  /** Whether heuristic analysis flagged this as main content */
  isMainContent: boolean;
  /** Heuristic importance score (size, position, keywords) */
  importanceScore: number;
  /** DOM structural context */
  domContext: DOMContextInfo;
  /** Vision model validation context (only present if vision enabled) */
  visionContext?: VisionContextInfo;
  /** Final hybrid score (calculated from importance + DOM + vision) */
  finalScore?: number;
}

/**
 * Quality levels for analysis metrics
 */
export type QualityLevel = 'high' | 'medium' | 'low';

/**
 * Metrics for tracking accessibility analysis quality and performance
 */
export interface AnalysisQualityMetrics {
  /** Total number of images initially extracted from page */
  originalImagesCount: number;
  /** Number of images after DOM context enrichment */
  contextualizedCount: number;
  /** Number of images after vision validation (if enabled) */
  validatedCount: number;
  /** Final number of top images selected for analysis */
  finalTopImages: number;
  /** Whether vision model was used for validation */
  visionEnabled: boolean;
  /** Estimated token count for the analysis */
  tokensEstimate: number;
  /** Total processing time in milliseconds */
  processingTime: number;
  /** Percentage of relevant images (validatedCount / originalImagesCount) */
  imageRelevanceRate: number;
  /** Overall quality assessment of the analysis */
  qualityLevel: QualityLevel;
}
