import { createLogger } from '../log';
import { createChatModel } from '../agent/helper';
import { agentModelStore, llmProviderStore, AgentNameEnum } from '@extension/storage';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { ContextualizedImageInfo, VisionContextInfo } from '@extension/storage/lib/accessibility/types';
import type BrowserContext from '../browser/context';

const logger = createLogger('VisionContextValidator');

/**
 * Constants for vision validation
 */
const MAX_IMAGES_PER_VALIDATION = 5;
const VISION_VALIDATION_TIMEOUT_MS = 30000;
const MIN_RELEVANCE_SCORE = 0.5;

/**
 * Sanitizes a URL for logging by removing query parameters and hash
 */
function sanitizeUrlForLogging(url: string): string {
  try {
    const urlObj = new URL(url);
    return `${urlObj.origin}${urlObj.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/**
 * Service responsible for validating image relevance using vision models
 *
 * This service uses vision-capable LLMs to:
 * 1. Analyze screenshots of images in context
 * 2. Determine if images are relevant to main content
 * 3. Provide visual descriptions and relevance reasoning
 * 4. Filter out decorative, advertisement, and navigation images
 */
export class VisionContextValidator {
  private browserContext: BrowserContext;

  constructor(browserContext: BrowserContext) {
    this.browserContext = browserContext;
  }

  /**
   * Validates images using vision model analysis
   *
   * @param tabId - Chrome tab ID where the images are located
   * @param url - Page URL for context
   * @param pageTitle - Page title for context
   * @param pageContent - Main text content of the page
   * @param images - Array of contextualized images to validate
   * @returns Promise resolving to images enriched with vision context
   *
   * @example
   * const validator = new VisionContextValidator(browserContext);
   * const validatedImages = await validator.validateImageContext(
   *   tabId,
   *   'https://example.com',
   *   'Article Title',
   *   'Article content...',
   *   contextualizedImages
   * );
   */
  async validateImageContext(
    tabId: number,
    url: string,
    pageTitle: string,
    pageContent: string,
    images: ContextualizedImageInfo[],
  ): Promise<ContextualizedImageInfo[]> {
    try {
      logger.info('Starting vision validation', {
        tabId,
        url: sanitizeUrlForLogging(url),
        imageCount: images.length,
      });

      // Check if vision model is available
      const hasVisionCapability = await this.checkVisionCapability();
      if (!hasVisionCapability) {
        logger.info('Vision model not available, skipping vision validation');
        return images;
      }

      // Get page screenshot for visual context
      const page = await this.browserContext.getCurrentPage();
      const screenshot = await page.takeScreenshot(false);

      if (!screenshot) {
        logger.warning('Failed to capture screenshot, skipping vision validation');
        return images;
      }

      // Validate images in batches to avoid overwhelming the model
      const validatedImages: ContextualizedImageInfo[] = [];

      for (let i = 0; i < images.length; i += MAX_IMAGES_PER_VALIDATION) {
        const batch = images.slice(i, i + MAX_IMAGES_PER_VALIDATION);
        const batchResults = await this.validateImageBatch(screenshot, url, pageTitle, pageContent, batch);
        validatedImages.push(...batchResults);
      }

      logger.info('Vision validation completed', {
        validatedCount: validatedImages.length,
        relevantCount: validatedImages.filter(img => img.visionContext?.isRelevant).length,
      });

      return validatedImages;
    } catch (error) {
      logger.error('Vision validation failed, returning images without vision context:', error);
      // Graceful degradation: return original images without vision context
      return images;
    }
  }

  /**
   * Validates a batch of images using the vision model
   *
   * @param screenshot - Base64-encoded JPEG screenshot of the page
   * @param url - Page URL
   * @param pageTitle - Page title
   * @param pageContent - Main page content
   * @param images - Batch of images to validate
   * @returns Promise resolving to images with vision context added
   */
  private async validateImageBatch(
    screenshot: string,
    url: string,
    pageTitle: string,
    pageContent: string,
    images: ContextualizedImageInfo[],
  ): Promise<ContextualizedImageInfo[]> {
    try {
      // Create vision-capable chat model
      const chatModel = await this.createVisionModel();

      // Build validation prompt
      const { systemMessage, userMessage } = this.buildVisionValidationPrompt(
        screenshot,
        url,
        pageTitle,
        pageContent,
        images,
      );

      // Call the vision model with timeout
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Vision validation timeout')), VISION_VALIDATION_TIMEOUT_MS),
      );

      const responsePromise = chatModel.invoke([systemMessage, userMessage]);
      const response = await Promise.race([responsePromise, timeoutPromise]);

      // Parse the vision model response
      const visionResults = this.parseVisionResponse(response);

      // Apply vision scores to images
      return this.applyVisionScores(images, visionResults);
    } catch (error) {
      logger.error('Failed to validate image batch:', error);
      // Return images without vision context on error
      return images;
    }
  }

  /**
   * Builds the prompt messages for vision validation
   *
   * @param screenshot - Base64-encoded screenshot
   * @param url - Page URL
   * @param pageTitle - Page title
   * @param pageContent - Page content
   * @param images - Images to validate
   * @returns System and user messages for the vision model
   */
  private buildVisionValidationPrompt(
    screenshot: string,
    url: string,
    pageTitle: string,
    pageContent: string,
    images: ContextualizedImageInfo[],
  ): { systemMessage: SystemMessage; userMessage: HumanMessage } {
    const systemMessage =
      new SystemMessage(`You are an AI assistant specialized in image relevance analysis for web accessibility.

Your task is to analyze images on a web page and determine which ones are relevant to the main content.

RELEVANT images include:
- Images that illustrate the main article/content
- Diagrams, charts, infographics related to the content
- Product images in e-commerce contexts
- Photos that support the narrative or information
- Screenshots or examples referenced in the content

IRRELEVANT images include:
- Logos and branding elements (unless the article is about that brand)
- Navigation icons and buttons
- Advertisement banners and promotional images
- Social media icons and widgets
- Author avatars and profile pictures
- Decorative background images
- Tracking pixels or tiny images

For each image, provide:
1. relevanceScore (0.0 to 1.0) - How relevant the image is to main content
2. relevanceReason - Brief explanation of why it's relevant or not
3. visualDescription - What you see in the image
4. isRelevant - Boolean decision (true if relevanceScore >= ${MIN_RELEVANCE_SCORE})

Return your response as a JSON array with this structure:
[
  {
    "imageUrl": "url of the image",
    "relevanceScore": 0.85,
    "relevanceReason": "Product image central to the article",
    "visualDescription": "A laptop computer on a desk",
    "isRelevant": true
  }
]`);

    const promptText = `Please analyze the following images from this web page:

PAGE CONTEXT:
- URL: ${sanitizeUrlForLogging(url)}
- Title: ${pageTitle}
- Content Summary: ${pageContent.substring(0, 500)}${pageContent.length > 500 ? '...' : ''}

IMAGES TO ANALYZE (${images.length} images):
${images
  .map(
    (img, index) => `
${index + 1}. Image URL: ${sanitizeUrlForLogging(img.imageUrl)}
   Current Alt: "${img.currentAlt}"
   DOM Context: ${img.domContext.semanticArea} (${img.domContext.isInMainContent ? 'main content' : 'not main content'})
   Surrounding Text: ${img.domContext.surroundingText || 'none'}
   Importance Score: ${img.importanceScore}
`,
  )
  .join('')}

Analyze the screenshot to identify these images and determine their relevance to the main content.
Return ONLY the JSON array as specified.`;

    const userMessage = new HumanMessage({
      content: [
        { type: 'text', text: promptText },
        {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${screenshot}` },
        },
      ],
    });

    return { systemMessage, userMessage };
  }

  /**
   * Creates a vision-capable chat model using Navigator model configuration
   *
   * @returns Promise resolving to configured chat model
   * @throws Error if no providers or Navigator model not configured
   */
  private async createVisionModel() {
    const providers = await llmProviderStore.getAllProviders();
    if (Object.keys(providers).length === 0) {
      throw new Error('No LLM providers configured');
    }

    await agentModelStore.cleanupLegacyValidatorSettings();

    const agentModels = await agentModelStore.getAllAgentModels();
    const navigatorModel = agentModels[AgentNameEnum.Navigator];

    if (!navigatorModel) {
      throw new Error('Navigator model not configured');
    }

    const providerConfig = providers[navigatorModel.provider];
    if (!providerConfig) {
      throw new Error(`Provider ${navigatorModel.provider} not found`);
    }

    return createChatModel(providerConfig, navigatorModel);
  }

  /**
   * Parses the vision model response into structured vision context
   *
   * @param response - Raw response from the vision model
   * @returns Array of vision validation results
   * @throws Error if response cannot be parsed
   */
  private parseVisionResponse(response: unknown): VisionContextInfo[] {
    try {
      // Extract content from LangChain message
      const content =
        typeof response === 'object' && response !== null && 'content' in response ? response.content : response;

      const responseText = typeof content === 'string' ? content : JSON.stringify(content);

      // Extract JSON array from the response (may be wrapped in markdown)
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : responseText;

      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      // Validate and normalize the parsed results
      return parsed.map(item => ({
        relevanceScore: typeof item.relevanceScore === 'number' ? item.relevanceScore : 0,
        relevanceReason: typeof item.relevanceReason === 'string' ? item.relevanceReason : 'Unknown',
        visualDescription: typeof item.visualDescription === 'string' ? item.visualDescription : '',
        isRelevant: typeof item.isRelevant === 'boolean' ? item.isRelevant : item.relevanceScore >= MIN_RELEVANCE_SCORE,
      }));
    } catch (error) {
      logger.error('Failed to parse vision response:', error);
      throw new Error('Failed to parse vision model response');
    }
  }

  /**
   * Applies vision scores to the original images
   *
   * @param images - Original contextualized images
   * @param visionResults - Vision validation results from the model
   * @returns Images enriched with vision context
   */
  private applyVisionScores(
    images: ContextualizedImageInfo[],
    visionResults: VisionContextInfo[],
  ): ContextualizedImageInfo[] {
    // Match vision results to images by index
    return images.map((image, index) => {
      const visionContext = visionResults[index];

      if (!visionContext) {
        // No vision result for this image - mark as not validated
        logger.warning('No vision result for image:', sanitizeUrlForLogging(image.imageUrl));
        return image;
      }

      return {
        ...image,
        visionContext,
      };
    });
  }

  /**
   * Checks if a vision-capable model is available
   *
   * @returns Promise resolving to true if vision capability is available
   */
  private async checkVisionCapability(): Promise<boolean> {
    try {
      const agentModels = await agentModelStore.getAllAgentModels();
      const navigatorModel = agentModels[AgentNameEnum.Navigator];

      if (!navigatorModel) {
        return false;
      }

      // Check if the model supports vision
      // Vision-capable models typically include: GPT-4 Vision, Claude 3+, Gemini Pro Vision
      const visionCapableModels = [
        'gpt-4-vision',
        'gpt-4o',
        'claude-3',
        'claude-sonnet',
        'claude-opus',
        'gemini-pro-vision',
        'gemini-1.5',
        'gemini-2.0',
      ];

      const modelName = navigatorModel.modelName.toLowerCase();
      return visionCapableModels.some(capable => modelName.includes(capable));
    } catch (error) {
      logger.error('Failed to check vision capability:', error);
      return false;
    }
  }
}
