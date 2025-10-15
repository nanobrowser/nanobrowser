import { createLogger } from '../log';
import { ragSettingsStore } from '@extension/storage';

const logger = createLogger('RAGService');

export interface RAGResponse {
  success: boolean;
  content?: string;
  error?: string;
}

export class RAGService {
  /**
   * Perform RAG retrieval for a given query
   */
  static async retrieve(query: string): Promise<RAGResponse> {
    try {
      const ragSettings = await ragSettingsStore.getSettings();

      if (!ragSettings.enabled || !ragSettings.endpoint) {
        logger.info('RAG is disabled or no endpoint configured');
        return { success: false, error: 'RAG not configured' };
      }

      logger.info('Performing RAG retrieval for query:', query);

      const url = new URL(ragSettings.endpoint);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authentication header if configured
      if (ragSettings.apiKey && ragSettings.apiKeyHeaderName) {
        headers[ragSettings.apiKeyHeaderName] = ragSettings.apiKey;
      }

      let requestOptions: RequestInit;

      if (ragSettings.method === 'GET') {
        // For GET requests, add query as URL parameter
        if (ragSettings.queryParamName) {
          url.searchParams.set(ragSettings.queryParamName, query);
        }

        requestOptions = {
          method: 'GET',
          headers,
        };
      } else {
        // For POST requests, add query in request body
        const body: Record<string, string> = {};
        if (ragSettings.queryParamName) {
          body[ragSettings.queryParamName] = query;
        }

        requestOptions = {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        };
      }

      logger.info('Making RAG request to:', url.toString());
      logger.info('Request method:', ragSettings.method);
      logger.info('Request headers:', Object.keys(headers));

      const response = await fetch(url.toString(), requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('RAG request failed:', response.status, errorText);
        return {
          success: false,
          error: `RAG request failed: ${response.status} ${response.statusText}`,
        };
      }

      const responseText = await response.text();
      logger.info('RAG response received, length:', responseText.length);

      // Try to parse as JSON first, then fall back to plain text
      let content: string;
      try {
        const jsonResponse = JSON.parse(responseText);
        // Look for common response fields that might contain the RAG content
        content =
          jsonResponse.content ||
          jsonResponse.result ||
          jsonResponse.text ||
          jsonResponse.answer ||
          jsonResponse.response ||
          JSON.stringify(jsonResponse);
      } catch {
        // If not JSON, use the raw text
        content = responseText;
      }

      return { success: true, content };
    } catch (error) {
      logger.error('RAG retrieval error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown RAG error',
      };
    }
  }

  /**
   * Augment a task with RAG-retrieved content
   */
  static async augmentTask(originalTask: string): Promise<string> {
    const ragResponse = await this.retrieve(originalTask);

    if (!ragResponse.success || !ragResponse.content) {
      logger.info('No RAG content retrieved, using original task');
      return originalTask;
    }

    // Augment the task with RAG content
    const augmentedTask = `${originalTask}

**Additional Context (Retrieved from Knowledge Base):**
${ragResponse.content}

**Instructions:** Use the above retrieved context to enhance your understanding and provide more accurate, informed responses. If the context is relevant, incorporate it into your analysis and actions.`;

    logger.info(
      'Task augmented with RAG content, original length:',
      originalTask.length,
      'augmented length:',
      augmentedTask.length,
    );
    return augmentedTask;
  }
}
