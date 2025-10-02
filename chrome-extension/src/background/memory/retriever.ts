/**
 * Procedural Memory Retrieval Service
 * Implements the RETRIEVAL phase from the MemP paper
 *
 * Key features:
 * 1. Semantic matching of task descriptions with stored procedures
 * 2. Context verification (current webpage, parameters)
 * 3. Relevance scoring based on multiple factors
 */

import type { ProceduralMemory } from '@extension/storage/lib/memory/types';
import { proceduralMemoryStore } from '@extension/storage/lib/memory/procedural';
import { createLogger } from '@src/background/log';

const logger = createLogger('ProceduralMemoryRetriever');

export interface RetrievalContext {
  /** The task description to find procedures for */
  task: string;
  /** Current webpage URL (if available) */
  currentUrl?: string;
  /** Current page title (if available) */
  currentPageTitle?: string;
  /** Parameters available in the current context */
  availableParameters?: string[];
}

export interface RetrievalResult {
  /** The procedural memory that was retrieved */
  memory: ProceduralMemory;
  /** Relevance score (0-1) indicating how well this memory matches the context */
  relevanceScore: number;
  /** Explanation of why this memory was retrieved */
  reason: string;
}

export interface RetrievalOptions {
  /** Maximum number of procedures to retrieve */
  maxResults?: number;
  /** Minimum confidence score to consider (0-1) */
  minConfidence?: number;
  /** Minimum relevance score to include in results (0-1) */
  minRelevanceScore?: number;
  /** Whether to exclude deprecated procedures */
  excludeDeprecated?: boolean;
}

const DEFAULT_RETRIEVAL_OPTIONS: Required<RetrievalOptions> = {
  maxResults: 3,
  minConfidence: 0.3,
  minRelevanceScore: 0.4,
  excludeDeprecated: true,
};

/**
 * ProceduralMemoryRetriever handles finding relevant procedural memories
 * based on the current task and context
 */
export class ProceduralMemoryRetriever {
  private options: Required<RetrievalOptions>;

  constructor(options: RetrievalOptions = {}) {
    this.options = { ...DEFAULT_RETRIEVAL_OPTIONS, ...options };
  }

  /**
   * Retrieve relevant procedural memories for the given context
   *
   * This implements the semantic matching and context verification from MemP:
   * 1. Semantic matching: Compare task description with stored procedures
   * 2. Context verification: Check webpage domain, available parameters
   * 3. Ranking: Sort by relevance score
   *
   * @param context - The retrieval context containing task and environment info
   * @returns Array of retrieval results, sorted by relevance (highest first)
   */
  async retrieve(context: RetrievalContext): Promise<RetrievalResult[]> {
    logger.info('Retrieving procedural memories for task:', context.task);

    // Step 1: Get all non-deprecated memories with minimum confidence
    const allMemories = await proceduralMemoryStore.searchMemories({
      minConfidence: this.options.minConfidence,
      excludeDeprecated: this.options.excludeDeprecated,
    });

    if (allMemories.length === 0) {
      logger.info('No procedural memories found in storage');
      return [];
    }

    logger.info(`Found ${allMemories.length} candidate memories`);

    // Step 2: Calculate relevance score for each memory
    const scoredResults: RetrievalResult[] = [];

    for (const memory of allMemories) {
      const score = this.calculateRelevanceScore(memory, context);

      if (score >= this.options.minRelevanceScore) {
        scoredResults.push({
          memory,
          relevanceScore: score,
          reason: this.generateRetrievalReason(memory, context, score),
        });
      }
    }

    // Step 3: Sort by relevance score (descending) and limit results
    scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const topResults = scoredResults.slice(0, this.options.maxResults);

    logger.info(`Retrieved ${topResults.length} relevant memories`);
    topResults.forEach((result, idx) => {
      logger.debug(
        `  ${idx + 1}. "${result.memory.title}" (score: ${result.relevanceScore.toFixed(2)}, confidence: ${result.memory.confidence.toFixed(2)})`,
      );
    });

    return topResults;
  }

  /**
   * Calculate how relevant a procedural memory is to the current context
   *
   * Scoring factors (following MemP principles):
   * - Goal similarity: Does the goal match the task? (40%)
   * - Domain match: Is the procedure for the current website? (30%)
   * - Memory confidence: Has this procedure succeeded before? (20%)
   * - Parameter availability: Are required parameters available? (10%)
   *
   * @param memory - The procedural memory to score
   * @param context - The current context
   * @returns Relevance score between 0 and 1
   */
  private calculateRelevanceScore(memory: ProceduralMemory, context: RetrievalContext): number {
    let score = 0;
    const weights = {
      goalSimilarity: 0.4,
      domainMatch: 0.3,
      confidence: 0.2,
      parameterMatch: 0.1,
    };

    // 1. Goal similarity (keyword matching)
    const goalScore = this.calculateTextSimilarity(context.task, memory.abstract.goal);
    score += goalScore * weights.goalSimilarity;

    // 2. Domain match
    if (context.currentUrl) {
      const domainScore = this.calculateDomainMatch(context.currentUrl, memory.abstract.domains);
      score += domainScore * weights.domainMatch;
    } else {
      // If no URL context, use partial weight
      score += 0.5 * weights.domainMatch;
    }

    // 3. Memory confidence (from success/failure history)
    score += memory.confidence * weights.confidence;

    // 4. Parameter availability
    if (context.availableParameters) {
      const paramScore = this.calculateParameterMatch(memory.abstract.parameters, context.availableParameters);
      score += paramScore * weights.parameterMatch;
    } else {
      // Neutral score if parameters not specified
      score += 0.5 * weights.parameterMatch;
    }

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Calculate text similarity using keyword overlap
   * This is a simple implementation; can be enhanced with embeddings later
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2); // Filter out short words

    const words1 = new Set(normalize(text1));
    const words2 = new Set(normalize(text2));

    if (words1.size === 0 || words2.size === 0) return 0;

    // Calculate Jaccard similarity
    const intersection = new Set([...words1].filter(word => words2.has(word)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
  }

  /**
   * Calculate domain match score
   * Returns 1.0 if current URL matches any domain in the procedure
   */
  private calculateDomainMatch(currentUrl: string, domains: string[]): number {
    try {
      const url = new URL(currentUrl);
      const currentDomain = url.hostname.toLowerCase();

      for (const domain of domains) {
        // Check if current domain matches or is a subdomain
        if (currentDomain === domain.toLowerCase() || currentDomain.endsWith('.' + domain.toLowerCase())) {
          return 1.0;
        }
      }
      return 0;
    } catch (error) {
      logger.warn('Failed to parse URL:', currentUrl);
      return 0;
    }
  }

  /**
   * Calculate parameter match score
   * Checks what percentage of required parameters are available
   */
  private calculateParameterMatch(requiredParams: string[], availableParams: string[]): number {
    if (requiredParams.length === 0) return 1.0;

    const availableSet = new Set(availableParams.map(p => p.toLowerCase()));
    const matchedParams = requiredParams.filter(param => availableSet.has(param.toLowerCase()));

    return matchedParams.length / requiredParams.length;
  }

  /**
   * Generate a human-readable explanation for why this memory was retrieved
   */
  private generateRetrievalReason(memory: ProceduralMemory, context: RetrievalContext, score: number): string {
    const reasons: string[] = [];

    // Check goal similarity
    const goalScore = this.calculateTextSimilarity(context.task, memory.abstract.goal);
    if (goalScore > 0.3) {
      reasons.push(`similar goal: "${memory.abstract.goal}"`);
    }

    // Check domain match
    if (context.currentUrl) {
      const domainScore = this.calculateDomainMatch(context.currentUrl, memory.abstract.domains);
      if (domainScore > 0) {
        reasons.push(`matches current domain (${memory.abstract.domains.join(', ')})`);
      }
    }

    // Check confidence
    if (memory.confidence > 0.7) {
      reasons.push(`high success rate (${(memory.confidence * 100).toFixed(0)}%)`);
    }

    if (reasons.length === 0) {
      return 'General relevance to task';
    }

    return reasons.join('; ');
  }

  /**
   * Verify if a procedure is applicable in the current context
   * This performs deeper context verification beyond just scoring
   */
  async verifyContext(
    memory: ProceduralMemory,
    context: RetrievalContext,
  ): Promise<{
    applicable: boolean;
    reason: string;
  }> {
    // Check prerequisites
    if (memory.abstract.prerequisites.length > 0) {
      // For now, we log prerequisites but don't enforce them
      // In a more advanced system, we could check if prerequisites are met
      logger.debug('Procedure prerequisites:', memory.abstract.prerequisites);
    }

    // Check if domain matches (strict check)
    if (context.currentUrl && memory.abstract.domains.length > 0) {
      const domainScore = this.calculateDomainMatch(context.currentUrl, memory.abstract.domains);
      if (domainScore === 0) {
        return {
          applicable: false,
          reason: `Current page (${context.currentUrl}) does not match required domains: ${memory.abstract.domains.join(', ')}`,
        };
      }
    }

    return {
      applicable: true,
      reason: 'Context verified successfully',
    };
  }
}

/**
 * Singleton instance for easy access
 */
export const proceduralMemoryRetriever = new ProceduralMemoryRetriever();
