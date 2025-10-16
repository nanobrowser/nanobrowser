/**
 * Security patterns for detecting and preventing common threats
 * These patterns are designed to be simple and effective
 */

import type { SecurityPattern } from './types';
import { ThreatType } from './types';

/**
 * Core security patterns for content sanitization
 */
export const SECURITY_PATTERNS: SecurityPattern[] = [
  // Task override attempts
  {
    pattern: /\b(ignore|forget|disregard)[\s\-_]*(previous|all|above)[\s\-_]*(instructions?|tasks?|commands?)\b/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to override previous instructions',
    replacement: '[BLOCKED_OVERRIDE_ATTEMPT]',
  },
  {
    pattern: /\b(your?|the)[\s\-_]*new[\s\-_]*(task|instruction|goal|objective)[\s\-_]*(is|are|:)/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to inject new task',
    replacement: '[BLOCKED_TASK_INJECTION]',
  },
  {
    pattern: /\b(now|instead|actually)[\s\-_]+(you must|you should|you will)[\s\-_]+/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Attempt to redirect agent behavior',
    replacement: '[BLOCKED_REDIRECT]',
  },
  {
    pattern: /\bultimate[-_ ]+task\b/gi,
    type: ThreatType.TASK_OVERRIDE,
    description: 'Reference to ultimate task',
    replacement: '',
  },

  // Prompt injection attempts - Tags and system references
  {
    pattern: /\bsystem[\s\-_]*(prompt|message|instruction)/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to system prompt',
    replacement: '[BLOCKED_SYSTEM_REFERENCE]',
  },
  {
    pattern: /\bnano[-_ ]+untrusted[-_ ]+content\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Attempt to fake untrusted content tags',
    replacement: '',
  },
  {
    pattern: /\bnano[-_ ]+user[-_ ]+request\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Attempt to fake user request tags',
    replacement: '',
  },
  {
    pattern: /\buntrusted[-_]+content\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to untrusted content',
    replacement: '',
  },
  {
    pattern: /\bnano[-_]+attached[-_]+files\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to attached files',
    replacement: '',
  },
  {
    pattern: /\buser[-_]+request\b/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Reference to user request',
    replacement: '',
  },

  // Suspicious XML/HTML tags
  {
    pattern: /<\/?[\s]*(?:instruction|command|system|task|override|ignore|plan|execute|request)[\s]*>/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Suspicious XML/HTML tags',
    replacement: '',
  },
  {
    pattern: /\]\]>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'XML injection attempt',
    replacement: '',
  },

  // Sensitive data patterns (basic)
  {
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g, // SSN pattern
    type: ThreatType.SENSITIVE_DATA,
    description: 'Potential SSN detected',
    replacement: '[REDACTED_SSN]',
  },
  {
    pattern: /\b(?:\d{4}[\s-]?){3}\d{4}\b/g, // Credit card pattern
    type: ThreatType.SENSITIVE_DATA,
    description: 'Potential credit card number',
    replacement: '[REDACTED_CC]',
  },
];

/**
 * Additional patterns that can be enabled for stricter security
 * These are kept separate to allow for configurable security levels
 */
export const STRICT_PATTERNS: SecurityPattern[] = [
  {
    pattern: /\b(password|pwd|passwd|api[\s_-]*key|secret|token)\s*[:=]\s*["']?[\w-]+["']?/gi,
    type: ThreatType.SENSITIVE_DATA,
    description: 'Credential detected',
    replacement: '[REDACTED_CREDENTIAL]',
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
    type: ThreatType.SENSITIVE_DATA,
    description: 'Email address detected',
    replacement: '[EMAIL]',
  },
  {
    pattern: /\b(bypass|circumvent|avoid|skip)[\s\-_]*(security|safety|filter|check)/gi,
    type: ThreatType.PROMPT_INJECTION,
    description: 'Security bypass attempt',
    replacement: '[BLOCKED_BYPASS]',
  },
];

/**
 * Get patterns based on security level
 * @param strict - Whether to include strict patterns
 * @returns Array of security patterns based on strictness level
 */
export function getPatterns(strict: boolean = false): SecurityPattern[] {
  return strict ? [...SECURITY_PATTERNS, ...STRICT_PATTERNS] : SECURITY_PATTERNS;
}

/**
 * Tags to preserve during sanitization (wrapped content tags)
 */
export const PRESERVED_TAGS = [
  'nano_untrusted_content',
  'nano_user_request',
  'nano_attached_files',
  'nano_file_content',
];

/**
 * Check if a tag should be preserved during sanitization
 * @param tag - The tag to check
 * @returns True if the tag should be preserved
 */
export function isPreserveTag(tag: string): boolean {
  const tagName = tag.replace(/<\/?|\s|>/g, '').toLowerCase();
  return PRESERVED_TAGS.includes(tagName);
}
