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

  // Action accessibility methods
  getActionAnalysis: (pageUrl: string) => Promise<ActionAccessibilityAnalysisResult | null>;
  saveActionAnalysis: (result: ActionAccessibilityAnalysisResult) => Promise<void>;
  deleteActionAnalysis: (pageUrl: string) => Promise<void>;
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

// ========================================
// ACTION ACCESSIBILITY TYPES
// ========================================

/**
 * Types of interactive action elements
 * Used to classify elements for appropriate accessibility analysis
 */
export enum ActionType {
  /** Standard or custom button element */
  BUTTON = 'button',
  /** Hyperlink or anchor element */
  LINK = 'link',
  /** Input field (text, checkbox, radio, etc.) */
  INPUT = 'input',
  /** Select dropdown element */
  SELECT = 'select',
  /** Textarea element */
  TEXTAREA = 'textarea',
  /** Custom interactive control (div with role=button, etc.) */
  CUSTOM_CONTROL = 'custom-control',
}

/**
 * Severity levels for accessibility issues
 * Based on WCAG conformance levels and impact on users
 */
export enum AccessibilityIssueSeverity {
  /** Blocks access completely - WCAG Level A violation */
  CRITICAL = 'critical',
  /** Significantly impairs access - Important WCAG violation */
  HIGH = 'high',
  /** Moderate impact on accessibility - WCAG Level AA issue */
  MEDIUM = 'medium',
  /** Minor improvement recommended - WCAG Level AAA or best practice */
  LOW = 'low',
  /** Informational - no direct accessibility impact */
  INFO = 'info',
}

/**
 * Current accessibility state of an action element
 * Captures all ARIA attributes and relevant HTML properties
 */
export interface AccessibilityState {
  // Accessible name attributes
  /** Whether element has aria-label attribute */
  hasAriaLabel: boolean;
  /** Value of aria-label if present */
  ariaLabel?: string;
  /** Whether element has aria-labelledby attribute */
  hasAriaLabelledBy: boolean;
  /** Value of aria-labelledby if present */
  ariaLabelledBy?: string;
  /** Whether element has visible text content */
  hasTextContent: boolean;
  /** Visible text content if present */
  textContent?: string;
  /** Whether element has title attribute */
  hasTitle: boolean;
  /** Value of title if present */
  title?: string;
  /** Whether element has alt attribute (for image inputs) */
  hasAlt: boolean;
  /** Value of alt if present */
  alt?: string;

  // Description attributes
  /** Whether element has aria-describedby attribute */
  hasAriaDescribedBy: boolean;
  /** Value of aria-describedby if present */
  ariaDescribedBy?: string;

  // Role attributes
  /** Whether element has explicit role attribute */
  hasRole: boolean;
  /** Value of role if present */
  role?: string;

  // Dynamic state attributes
  /** aria-expanded state (for collapsible elements) */
  ariaExpanded?: string;
  /** aria-pressed state (for toggle buttons) */
  ariaPressed?: string;
  /** aria-checked state (for checkboxes/radios) */
  ariaChecked?: string;
  /** aria-selected state (for selectable items) */
  ariaSelected?: string;
  /** aria-disabled state */
  ariaDisabled?: string;
  /** aria-hidden state */
  ariaHidden?: string;

  // Additional context
  /** Whether element is disabled via HTML disabled attribute */
  isDisabled: boolean;
  /** Whether element is visible on the page */
  isVisible: boolean;
  /** Whether element can receive keyboard focus */
  isFocusable: boolean;
  /** Tab index value if present */
  tabIndex?: number;
}

/**
 * Identified accessibility issue with an action element
 * Includes severity, description, and WCAG reference
 */
export interface AccessibilityIssue {
  /** Unique type identifier for the issue */
  type: string;
  /** Severity level of the issue */
  severity: AccessibilityIssueSeverity;
  /** Human-readable description of the issue */
  description: string;
  /** WCAG guideline reference (e.g., "WCAG 2.1 - 4.1.2 Name, Role, Value") */
  wcagReference: string;
  /** Current value that caused the issue (if applicable) */
  currentValue?: string;
  /** Recommendation for fixing the issue */
  recommendation: string;
}

/**
 * Suggested improvement for an action element
 * Provides specific attribute changes with reasoning
 */
export interface AccessibilityImprovement {
  /** HTML/ARIA attribute to add or modify */
  attribute: string;
  /** Suggested value for the attribute */
  suggestedValue: string;
  /** Explanation of why this improvement is recommended */
  reasoning: string;
  /** Priority level (1-10, higher = more important) */
  priority: number;
}

/**
 * Vision AI context for action elements
 * Provides visual analysis and contextual understanding
 */
export interface ActionVisionContext {
  /** Visual description of the element (e.g., "Blue button with cart icon") */
  visualDescription: string;
  /** Text recognized visually within the element (OCR-like) */
  recognizedText: string;
  /** Icons or symbols identified in the element */
  recognizedIcons: string[];
  /** Inferred purpose based on visual context */
  contextualPurpose: string;
  /** AI-generated suggested aria-label */
  suggestedAriaLabel: string;
  /** Confidence score for the suggestion (0-1) */
  confidence: number;
}

/**
 * Complete contextualized information for an action element
 * Combines DOM data, accessibility state, issues, and suggestions
 */
export interface ContextualizedActionInfo {
  // Identification
  /** Unique identifier for this action element */
  actionId: string;
  /** Classified type of action */
  actionType: ActionType;
  /** HTML tag name */
  tagName: string;
  /** CSS selector to locate the element */
  selector: string;
  /** XPath to locate the element */
  xpath: string;

  // Content
  /** Inner HTML content (truncated for performance) */
  innerHTML: string;
  /** Outer HTML with attributes (for display) */
  outerHTML: string;

  // Accessibility analysis
  /** Current accessibility state */
  accessibilityState: AccessibilityState;
  /** DOM structural context (reusing existing type) */
  domContext: DOMContextInfo;
  /** Vision AI context (if available) */
  visionContext?: ActionVisionContext;

  // Analysis results
  /** List of identified accessibility issues */
  issues: AccessibilityIssue[];
  /** List of suggested improvements */
  improvements: AccessibilityImprovement[];
  /** Overall accessibility score (0-100) */
  accessibilityScore: number;
}

/**
 * Summary statistics by action type
 */
export interface ActionTypeSummary {
  /** Number of elements of this type */
  count: number;
  /** Average accessibility score for this type */
  averageScore: number;
  /** Number of issues found for this type */
  issuesCount: number;
}

/**
 * Complete result of action accessibility analysis
 * Includes all analyzed actions and summary statistics
 */
export interface ActionAccessibilityAnalysisResult {
  /** URL of the analyzed page */
  pageUrl: string;
  /** Timestamp of analysis */
  analyzedAt: number;
  /** Total number of action elements found */
  totalActionsFound: number;
  /** Total number of issues across all actions */
  totalIssues: number;
  /** Number of critical severity issues */
  criticalIssues: number;
  /** Average accessibility score across all actions */
  averageAccessibilityScore: number;

  /** All analyzed action elements */
  actions: ContextualizedActionInfo[];

  /** Summary statistics by action type */
  summaryByType: Record<ActionType, ActionTypeSummary>;
  /** Issue count by severity level */
  summaryBySeverity: Record<AccessibilityIssueSeverity, number>;
}

// ========================================
// DOM MODIFICATION SYSTEM TYPES
// ========================================

/**
 * Type of DOM modification to apply
 */
export enum DomModificationType {
  /** Apply alt text to regular <img> element */
  IMAGE_ALT = 'image_alt',
  /** Apply aria-label to background-image element */
  BACKGROUND_IMAGE_ALT = 'background_image_alt',
  /** Add or modify aria-label attribute */
  ARIA_LABEL = 'aria_label',
  /** Add or modify aria-describedby attribute */
  ARIA_DESCRIBEDBY = 'aria_describedby',
  /** Add or modify role attribute */
  ROLE = 'role',
  /** Add or modify tabindex attribute */
  TABINDEX = 'tabindex',
  /** Add or modify aria-disabled attribute */
  ARIA_DISABLED = 'aria_disabled',
}

/**
 * Single DOM modification instruction
 * Represents one atomic change to be applied to the DOM
 */
export interface DomModification {
  /** Unique modification ID for tracking and undo */
  modificationId: string;

  /** Type of modification being performed */
  type: DomModificationType;

  /** CSS selector to target element */
  selector: string;

  /** XPath alternative for precise selection */
  xpath?: string;

  /** Attribute name to modify */
  attribute: string;

  /** New value to set (with 'visible-ai: ' prefix for labels) */
  newValue: string;

  /** Original value before modification (for undo) */
  originalValue?: string;

  /** Whether this modification was successfully applied */
  applied: boolean;

  /** Timestamp when applied (milliseconds) */
  appliedAt?: number;

  /** Error message if application failed */
  error?: string;
}

/**
 * Batch of modifications for a page
 * Groups multiple modifications into a single undoable unit
 */
export interface DomModificationBatch {
  /** Page URL where modifications apply */
  pageUrl: string;

  /** Timestamp of batch creation */
  createdAt: number;

  /** All modifications in this batch */
  modifications: DomModification[];

  /** Number of successfully applied modifications */
  successCount: number;

  /** Number of failed modifications */
  failureCount: number;

  /** Whether batch can be undone */
  canUndo: boolean;
}

/**
 * Image alt text application request
 * Request to apply generated alt text to an image element
 */
export interface ImageAltApplication {
  /** Image URL for reference */
  imageUrl: string;

  /** CSS selector to locate image */
  selector: string;

  /** Generated alt text to apply */
  altText: string;

  /** Whether this is a background-image element */
  isBackground: boolean;
}

/**
 * Action ARIA improvement application request
 * Request to apply ARIA improvements to an action element
 */
export interface ActionAriaApplication {
  /** Action element ID from analysis */
  actionId: string;

  /** CSS selector to locate element */
  selector: string;

  /** XPath for precise selection */
  xpath: string;

  /** Improvements to apply (subset of all suggestions) */
  improvements: AccessibilityImprovement[];
}

/**
 * Complete application request from side panel
 * Combines image and action improvements into single request
 */
export interface AccessibilityApplicationRequest {
  /** Page URL where to apply improvements */
  pageUrl: string;

  /** Tab ID for the page */
  tabId: number;

  /** Image improvements to apply (optional) */
  imageImprovements?: ImageAltApplication[];

  /** Action improvements to apply (optional) */
  actionImprovements?: ActionAriaApplication[];
}

/**
 * Result of application operation
 * Reports success/failure and provides modification details
 */
export interface AccessibilityApplicationResult {
  /** Whether application was successful */
  success: boolean;

  /** Modification batch created */
  batch: DomModificationBatch;

  /** User-friendly summary message */
  message: string;

  /** Detailed error if failed */
  error?: string;
}
