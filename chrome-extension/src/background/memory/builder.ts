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
    // Extract high-level flow with semantic information
    const flow: string[] = [];
    const seenActions = new Set<string>();

    for (const step of steps) {
      // Create semantic flow item from step
      const flowItem = this.extractSemanticAction(step);

      // Avoid duplicate consecutive actions
      if (flowItem && !seenActions.has(flowItem)) {
        flow.push(flowItem);
        seenActions.add(flowItem);
      }
    }

    // Extract parameters from semantic data
    const parameters = this.extractParameters(steps);
    console.log('parameters from extractParameters', parameters);

    // Extract goal from semantic flow
    const goal = this.inferGoalFromSemantics(steps);

    // Infer prerequisites
    const prerequisites = this.inferPrerequisites(steps);

    // Auto-generate tags from semantic information
    const tags = this.autoGenerateTagsFromSemantics(steps);

    return {
      goal,
      parameters: Array.from(new Set(parameters)),
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

  /**
   * Extract semantic action from step
   */
  private extractSemanticAction(step: ProceduralStep): string {
    // Use semantic metadata if available
    const semantic = (step.element as any)?.semantic;

    if (semantic?.label) {
      switch (semantic.role) {
        case 'button':
          return `Click "${semantic.label}"`;
        case 'input':
          return `Enter ${semantic.fieldLabel || semantic.label}`;
        case 'link':
          return `Navigate via "${semantic.label}"`;
        default:
          return semantic.label;
      }
    }

    // Fallback to description simplification
    return this.simplifyDescription(step.description);
  }

  /**
   * Extract parameters from steps using semantic information
   */
  private extractParameters(steps: ProceduralStep[]): string[] {
    const parameters: string[] = [];
    const parameterSet = new Set<string>();

    for (const step of steps) {
      // Check for input actions with semantic field names
      if (step.action === 'input' || step.action === 'input_text') {
        const semantic = (step.element as any)?.semantic;
        const fieldName = semantic?.fieldName || semantic?.fieldLabel;

        if (fieldName) {
          const paramName = this.normalizeParameterName(fieldName);
          if (paramName && !parameterSet.has(paramName)) {
            parameters.push(paramName);
            parameterSet.add(paramName);
          }
        } else {
          // Fallback to description-based extraction
          const desc = step.description.toLowerCase();
          const match = desc.match(/enter (?:text |")?(.+?)(?:"|in| field)/i);
          if (match && match[1]) {
            const paramName = this.normalizeParameterName(match[1]);
            if (!parameterSet.has(paramName)) {
              parameters.push(paramName);
              parameterSet.add(paramName);
            }
          }
        }
      }
    }

    return parameters;
  }

  /**
   * Normalize parameter name (e.g., "Issue Title" -> "title")
   */
  private normalizeParameterName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^(issue|task|item)\s+/i, '') // Remove prefixes
      .replace(/\s+field$/i, '') // Remove "field" suffix
      .replace(/\s+/g, '_') // Replace spaces with underscores
      .trim();
  }

  /**
   * Infer goal from semantic information
   */
  private inferGoalFromSemantics(steps: ProceduralStep[]): string {
    if (steps.length === 0) return 'Perform task';

    const domain = new URL(steps[0].url).hostname.replace('www.', '').split('.')[0];

    // Look for create/submit actions
    const hasCreate = steps.some(s => {
      const semantic = (s.element as any)?.semantic;
      return s.description.toLowerCase().includes('create') || semantic?.label?.toLowerCase().includes('create');
    });

    const hasSubmit = steps.some(s => {
      const semantic = (s.element as any)?.semantic;
      return s.action === 'submit' || semantic?.label?.toLowerCase().includes('submit');
    });

    // Look for what's being created
    const descriptions = steps.map(s => s.description.toLowerCase()).join(' ');

    if (hasCreate || hasSubmit) {
      if (descriptions.includes('issue')) return `Create issue in ${domain}`;
      if (descriptions.includes('task')) return `Create task in ${domain}`;
      if (descriptions.includes('project')) return `Create project in ${domain}`;
      if (descriptions.includes('ticket')) return `Create ticket in ${domain}`;
      return `Create item in ${domain}`;
    }

    if (descriptions.includes('edit') || descriptions.includes('update')) {
      return `Edit item in ${domain}`;
    }

    if (descriptions.includes('search') || descriptions.includes('find')) {
      return `Search in ${domain}`;
    }

    return `Perform workflow in ${domain}`;
  }

  /**
   * Auto-generate tags from semantic information
   */
  private autoGenerateTagsFromSemantics(steps: ProceduralStep[]): string[] {
    const tags = new Set<string>();

    // Domain-based tags
    const url = new URL(steps[0].url);
    if (url.hostname.includes('linear')) tags.add('project_management');
    if (url.hostname.includes('github')) tags.add('code_repository');
    if (url.hostname.includes('jira')) tags.add('issue_tracking');
    if (url.hostname.includes('notion')) tags.add('documentation');

    // Action-based tags from semantic labels
    for (const step of steps) {
      const semantic = (step.element as any)?.semantic;
      const label = semantic?.label?.toLowerCase() || '';
      const desc = step.description.toLowerCase();
      const combined = label + ' ' + desc;

      if (combined.includes('issue')) tags.add('issue_tracking');
      if (combined.includes('task')) tags.add('task_management');
      if (combined.includes('create')) tags.add('creation');
      if (combined.includes('edit') || combined.includes('update')) tags.add('modification');
      if (combined.includes('search')) tags.add('search');
      if (combined.includes('form') || combined.includes('submit')) tags.add('form_filling');

      // Field-specific tags
      if (combined.includes('assignee') || combined.includes('assign')) tags.add('assignment');
      if (combined.includes('priority')) tags.add('prioritization');
      if (combined.includes('status')) tags.add('status_management');
      if (combined.includes('milestone') || combined.includes('deadline')) tags.add('planning');
    }

    return Array.from(tags);
  }
}

/**
 * Create a memory builder instance
 */
export function createMemoryBuilder(llm?: BaseChatModel): MemoryBuilder {
  return new MemoryBuilderImpl(llm);
}
