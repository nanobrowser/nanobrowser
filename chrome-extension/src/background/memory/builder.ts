/**
 * Memory Builder - Converts demonstration recordings into procedural memories
 * Implements the "distillation" part of the BUILD phase in MEMP framework
 */

import { createLogger } from '../log';
import { proceduralMemoryStore, type ProceduralStep, type ProceduralMemory } from '@extension/storage';
import type { BuildMemoryParams, BuildMemoryResult, MemoryBuilder } from './types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';

const logger = createLogger('MemoryBuilder');

/**
 * Implements building procedural memory from demonstration recordings
 */
export class MemoryBuilderImpl implements MemoryBuilder {
  private llm?: BaseChatModel;

  constructor(llm?: BaseChatModel) {
    this.llm = llm;
  }

  async buildFromRecording(params: BuildMemoryParams): Promise<BuildMemoryResult> {
    logger.info(`Building procedural memory from recording: ${params.recordingId}`);

    // Load the recording
    const recording = await proceduralMemoryStore.getRecording(params.recordingId);
    if (!recording) {
      throw new Error(`Recording not found: ${params.recordingId}`);
    }

    if (recording.steps.length === 0) {
      throw new Error('Recording has no steps');
    }

    const warnings: string[] = [];

    // Step 1: Parameterize the steps (convert concrete values to parameters)
    logger.info('Step 1: Parameterizing steps');
    const { steps: parameterizedSteps, parameters } = this.parameterizeSteps(recording.steps);

    // Step 2: Generate abstract representation
    logger.info('Step 2: Generating abstract representation');
    const abstract = await this.generateAbstract(recording.steps, params.useLLM);

    // Step 3: Extract domains from URLs
    const domains = this.extractDomains(recording.steps);

    // Step 4: Combine tags
    const tags = [...(params.tags || []), ...(abstract.tags || [])];

    // Step 5: Create the procedural memory
    const memory = await proceduralMemoryStore.createMemory({
      title: params.title || recording.title,
      abstract: {
        ...abstract,
        domains,
        tags,
      },
      steps: parameterizedSteps,
      successCount: 0,
      failureCount: 0,
      confidence: 0.5, // Initial neutral confidence
      deprecated: false,
      source: 'human_demo',
      sourceSessionId: params.recordingId,
    });

    // Mark recording as processed
    await proceduralMemoryStore.updateRecording(params.recordingId, {
      processed: true,
      proceduralMemoryId: memory.id,
    });

    logger.info(`Created procedural memory: ${memory.id}`);

    return {
      memory,
      warnings,
    };
  }

  async generateAbstract(steps: ProceduralStep[], useLLM = false): Promise<ProceduralMemory['abstract']> {
    if (useLLM && this.llm) {
      return await this.generateAbstractWithLLM(steps);
    } else {
      return this.generateAbstractHeuristic(steps);
    }
  }

  /**
   * Generate abstract representation using heuristics (rule-based)
   */
  private generateAbstractHeuristic(steps: ProceduralStep[]): ProceduralMemory['abstract'] {
    // Extract high-level flow
    const flow: string[] = [];
    const seenDescriptions = new Set<string>();

    for (const step of steps) {
      // Simplify description for flow
      const flowItem = this.simplifyDescription(step.description);
      if (!seenDescriptions.has(flowItem)) {
        flow.push(flowItem);
        seenDescriptions.add(flowItem);
      }
    }

    // Identify parameters from common patterns
    const parameters: string[] = [];
    const parameterPatterns = [
      /title/i,
      /description/i,
      /name/i,
      /email/i,
      /assignee/i,
      /project/i,
      /milestone/i,
      /priority/i,
      /status/i,
      /label/i,
      /tag/i,
    ];

    for (const step of steps) {
      const desc = step.description.toLowerCase();
      for (const pattern of parameterPatterns) {
        if (pattern.test(desc)) {
          const match = desc.match(pattern);
          if (match && !parameters.includes(match[0])) {
            parameters.push(match[0]);
          }
        }
      }
    }

    // Extract goal from first and last steps
    const firstStep = steps[0];
    const lastStep = steps[steps.length - 1];
    const goal = this.inferGoal(firstStep, lastStep, steps);

    // Infer prerequisites
    const prerequisites = this.inferPrerequisites(steps);

    // Auto-generate tags
    const tags = this.autoGenerateTags(steps);

    return {
      goal,
      parameters: Array.from(new Set(parameters)), // Remove duplicates
      prerequisites,
      flow,
      domains: [], // Will be filled by caller
      tags,
    };
  }

  /**
   * Generate abstract representation using LLM
   */
  private async generateAbstractWithLLM(steps: ProceduralStep[]): Promise<ProceduralMemory['abstract']> {
    if (!this.llm) {
      throw new Error('LLM not provided');
    }

    const systemPrompt = `You are an expert at analyzing web automation sequences and creating high-level abstractions.
Your task is to analyze a sequence of user actions and generate:
1. A clear goal statement
2. Required parameters that can be substituted
3. Prerequisites needed before starting
4. A high-level flow description
5. Relevant tags for categorization

Return your response as a JSON object with these keys: goal, parameters (array), prerequisites (array), flow (array), tags (array).`;

    const stepsDescription = steps
      .map((step, i) => `${i + 1}. ${step.action}: ${step.description} (at ${step.url})`)
      .join('\n');

    const humanPrompt = `Analyze this sequence of web actions and create an abstract representation:

${stepsDescription}

Return ONLY a valid JSON object with the structure: {"goal": "...", "parameters": [...], "prerequisites": [...], "flow": [...], "tags": [...]}`;

    try {
      const messages = [new SystemMessage(systemPrompt), new HumanMessage(humanPrompt)];

      const response = await this.llm.invoke(messages);
      const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        goal: string;
        parameters: string[];
        prerequisites: string[];
        flow: string[];
        tags: string[];
      };

      return {
        goal: parsed.goal,
        parameters: parsed.parameters || [],
        prerequisites: parsed.prerequisites || [],
        flow: parsed.flow || [],
        domains: [],
        tags: parsed.tags || [],
      };
    } catch (error) {
      logger.error('Failed to generate abstract with LLM, falling back to heuristics:', error);
      return this.generateAbstractHeuristic(steps);
    }
  }

  parameterizeSteps(steps: ProceduralStep[]): {
    steps: ProceduralStep[];
    parameters: Record<string, string>;
  } {
    // This is a simplified version - in a full implementation, you'd want to:
    // 1. Identify concrete values (names, emails, specific text)
    // 2. Replace them with parameter placeholders like {title}, {assignee}
    // 3. Track the mapping of parameter names to example values

    const parameters: Record<string, string> = {};

    // For now, we'll keep steps as-is but identify potential parameters
    const parameterizedSteps = steps.map(step => ({ ...step }));

    // Identify text input values as parameters
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.action === 'input_text' && step.parameters.text) {
        const text = String(step.parameters.text);
        // Try to infer parameter name from element or description
        const paramName = this.inferParameterName(step.description, step.element?.attributes);
        if (paramName && !parameters[paramName]) {
          parameters[paramName] = text;
        }
      }
    }

    return { steps: parameterizedSteps, parameters };
  }

  /**
   * Helper: Simplify step description for flow
   */
  private simplifyDescription(description: string): string {
    // Remove specific values and keep action
    return description
      .replace(/:\s*.*$/, '') // Remove everything after ":"
      .replace(/\s+\d+/g, '') // Remove numbers
      .trim();
  }

  /**
   * Helper: Infer goal from steps
   */
  private inferGoal(firstStep: ProceduralStep, lastStep: ProceduralStep, allSteps: ProceduralStep[]): string {
    // Look for domain name
    const domain = new URL(firstStep.url).hostname.replace('www.', '').split('.')[0];

    // Look for action verbs
    const descriptions = allSteps.map(s => s.description.toLowerCase()).join(' ');

    if (descriptions.includes('create') || descriptions.includes('new')) {
      if (descriptions.includes('issue')) return `Create issue in ${domain}`;
      if (descriptions.includes('task')) return `Create task in ${domain}`;
      if (descriptions.includes('project')) return `Create project in ${domain}`;
      return `Create item in ${domain}`;
    }

    if (descriptions.includes('edit') || descriptions.includes('update')) {
      return `Edit item in ${domain}`;
    }

    if (descriptions.includes('search') || descriptions.includes('find')) {
      return `Search in ${domain}`;
    }

    // Default
    return `Perform task in ${domain}`;
  }

  /**
   * Helper: Infer prerequisites from steps
   */
  private inferPrerequisites(steps: ProceduralStep[]): string[] {
    const prerequisites: string[] = [];
    const firstUrl = steps[0].url;
    const domain = new URL(firstUrl).hostname;

    prerequisites.push(`User must be logged into ${domain}`);
    prerequisites.push(`Browser must have access to ${domain}`);

    return prerequisites;
  }

  /**
   * Helper: Auto-generate tags from steps
   */
  private autoGenerateTags(steps: ProceduralStep[]): string[] {
    const tags = new Set<string>();
    const descriptions = steps.map(s => s.description.toLowerCase()).join(' ');

    // Domain-based tags
    const url = new URL(steps[0].url);
    if (url.hostname.includes('linear')) tags.add('project_management');
    if (url.hostname.includes('github')) tags.add('code_repository');
    if (url.hostname.includes('jira')) tags.add('issue_tracking');
    if (url.hostname.includes('notion')) tags.add('documentation');

    // Action-based tags
    if (descriptions.includes('issue')) tags.add('issue_tracking');
    if (descriptions.includes('task')) tags.add('task_management');
    if (descriptions.includes('create')) tags.add('creation');
    if (descriptions.includes('edit')) tags.add('modification');
    if (descriptions.includes('search')) tags.add('search');
    if (descriptions.includes('form')) tags.add('form_filling');

    return Array.from(tags);
  }

  /**
   * Helper: Extract domains from step URLs
   */
  private extractDomains(steps: ProceduralStep[]): string[] {
    const domains = new Set<string>();
    for (const step of steps) {
      try {
        const url = new URL(step.url);
        domains.add(url.hostname);
      } catch {
        // Invalid URL, skip
      }
    }
    return Array.from(domains);
  }

  /**
   * Helper: Infer parameter name from description and element
   */
  private inferParameterName(description: string, attributes?: Record<string, string>): string {
    const desc = description.toLowerCase();

    // Check element attributes
    if (attributes) {
      if (attributes.name) return attributes.name;
      if (attributes.id) return attributes.id;
      if (attributes['aria-label']) {
        return attributes['aria-label'].toLowerCase().replace(/\s+/g, '_');
      }
    }

    // Check description
    if (desc.includes('title')) return 'title';
    if (desc.includes('description')) return 'description';
    if (desc.includes('name')) return 'name';
    if (desc.includes('email')) return 'email';
    if (desc.includes('assignee')) return 'assignee';
    if (desc.includes('project')) return 'project';
    if (desc.includes('milestone')) return 'milestone';

    return 'value';
  }
}

/**
 * Create a memory builder instance
 */
export function createMemoryBuilder(llm?: BaseChatModel): MemoryBuilder {
  return new MemoryBuilderImpl(llm);
}
