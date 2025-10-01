import { createLogger } from '../log';
import { createChatModel } from '../agent/helper';
import { agentModelStore, llmProviderStore, AgentNameEnum } from '@extension/storage';
import type BrowserContext from '../browser/context';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ReadabilityService } from './readability';
import { t } from '@extension/i18n';

const logger = createLogger('AccessibilityService');

export interface ImageInfo {
  imageUrl: string;
  currentAlt: string;
  selector?: string;
  isMainContent?: boolean;
  importanceScore?: number;
}

export interface AccessibilityAnalysisResult {
  pageSummary: string;
  imageAnalysis: Array<{
    imageUrl: string;
    currentAlt: string;
    generatedAlt?: string;
  }>;
}

export class AccessibilityService {
  private browserContext: BrowserContext;
  private readabilityService: ReadabilityService;

  constructor(browserContext: BrowserContext) {
    this.browserContext = browserContext;
    this.readabilityService = new ReadabilityService();
  }

  /**
   * Extract images from a web page
   */
  async extractImages(tabId: number): Promise<ImageInfo[]> {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Define the isMainContentImage function inside the injected script
          const isMainContentImage = (img: HTMLImageElement): boolean => {
            const src = img.src.toLowerCase();
            const alt = img.alt.toLowerCase();
            const className = img.className.toLowerCase();
            const parent = img.parentElement;

            // Skip very small images (likely icons or decorative)
            if (img.naturalWidth < 32 || img.naturalHeight < 32) {
              return false;
            }

            // Skip tracking pixels and tiny analytics images
            if (img.naturalWidth === 1 || img.naturalHeight === 1) {
              return false;
            }

            // Strong indicators of main content images
            const contentKeywords = [
              'entry-image',
              'post-image',
              'article-image',
              'content-image',
              'singular-image',
              'featured-image',
              'hero-image',
              'main-image',
            ];

            const hasContentKeywords = contentKeywords.some(keyword => className.includes(keyword));

            if (hasContentKeywords) {
              return true;
            }

            // Skip obvious advertisement images
            const adKeywords = ['banner', 'sponsor', 'promo', 'advertisement', '_ad_'];
            const hasStrictAdKeywords = adKeywords.some(
              keyword => src.includes(keyword) || className.includes(keyword),
            );

            if (hasStrictAdKeywords) {
              return false;
            }

            // Skip navigation areas but be more specific
            if (parent) {
              const parentClasses = parent.className.toLowerCase();
              const navKeywords = ['navigation', 'navbar', 'header-nav', 'footer-nav'];
              const isInStrictNavArea = navKeywords.some(keyword => parentClasses.includes(keyword));

              if (isInStrictNavArea) {
                return false;
              }
            }

            // Skip avatars and profile images (usually small and circular)
            if (className.includes('avatar') || className.includes('profile')) {
              return false;
            }

            // Skip logos unless they're large (might be article logos)
            if (className.includes('logo') && (img.naturalWidth < 200 || img.naturalHeight < 100)) {
              return false;
            }

            // Images with meaningful alt text are likely main content
            if (alt && alt.length > 10) {
              return true;
            }

            // Medium to large images are more likely to be main content
            if (img.naturalWidth > 150 && img.naturalHeight > 100) {
              return true;
            }

            // If image is reasonably sized but no other indicators, default to true
            // This is more inclusive for content images
            if (img.naturalWidth > 100 && img.naturalHeight > 75) {
              return true;
            }

            return false;
          };

          const images = Array.from(document.querySelectorAll('img')).map((img, index) => {
            // Generate a unique selector for each image
            const selector = img.id
              ? `#${img.id}`
              : img.className
                ? `.${img.className.split(' ')[0]}`
                : `img:nth-child(${index + 1})`;

            // Determine if image is likely main content
            const isMainContent = isMainContentImage(img);

            // Calculate image importance score for ranking
            let importanceScore = 0;

            // Size score (larger images are more important)
            const area = img.naturalWidth * img.naturalHeight;
            if (area > 500000)
              importanceScore += 100; // Very large (e.g., 1000x500+)
            else if (area > 200000)
              importanceScore += 80; // Large (e.g., 600x400+)
            else if (area > 50000)
              importanceScore += 60; // Medium (e.g., 300x200+)
            else if (area > 10000)
              importanceScore += 30; // Small but reasonable
            else importanceScore += 5; // Very small

            // Content keywords bonus
            const className = img.className.toLowerCase();
            const contentKeywords = [
              'entry-image',
              'post-image',
              'article-image',
              'content-image',
              'singular-image',
              'featured-image',
              'hero-image',
              'main-image',
            ];
            if (contentKeywords.some(keyword => className.includes(keyword))) {
              importanceScore += 50;
            }

            // Alt text quality bonus
            const alt = img.alt || '';
            if (alt.length > 20) importanceScore += 30;
            else if (alt.length > 10) importanceScore += 20;
            else if (alt.length > 0) importanceScore += 10;

            // Position bonus (images higher on the page are more important)
            const rect = img.getBoundingClientRect();
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const absoluteTop = rect.top + scrollTop;
            if (absoluteTop < 1000)
              importanceScore += 40; // Above the fold
            else if (absoluteTop < 2000)
              importanceScore += 20; // Near top
            else if (absoluteTop < 4000) importanceScore += 10; // Still fairly high

            // Penalize obvious non-content images
            const src = img.src.toLowerCase();
            const adKeywords = ['banner', 'sponsor', 'promo', 'advertisement', '_ad_', 'logo'];
            if (adKeywords.some(keyword => src.includes(keyword) || className.includes(keyword))) {
              importanceScore -= 50;
            }

            // Avatar/profile penalty
            if (className.includes('avatar') || className.includes('profile')) {
              importanceScore -= 30;
            }

            return {
              imageUrl: img.src,
              currentAlt: img.alt || '',
              selector,
              isMainContent,
              importanceScore,
            };
          });

          // Sort by importance score (highest first) and limit to 15 images
          const sortedImages = images.sort((a, b) => b.importanceScore - a.importanceScore).slice(0, 15);

          return sortedImages;
        },
      });

      return results[0]?.result || [];
    } catch (error) {
      logger.error('Failed to extract images:', error);
      return [];
    }
  }

  /**
   * Perform accessibility analysis using direct LLM call
   */
  async analyzeAccessibility(tabId: number, url: string): Promise<AccessibilityAnalysisResult> {
    try {
      logger.info('Starting accessibility analysis for tab:', tabId);

      // Extract page content using our ReadabilityService
      const readabilityResult = await this.readabilityService.extractContent(tabId);

      if (!readabilityResult.success || !readabilityResult.article) {
        throw new Error('Failed to extract page content: ' + (readabilityResult.error || 'Unknown error'));
      }

      const readabilityContent = readabilityResult.article;

      // Extract images from the page
      const images = await this.extractImages(tabId);

      // Filter to only main content images
      const mainContentImages = images.filter(img => img.isMainContent);

      logger.info('Extracted images:', images.length, 'main content images:', mainContentImages.length);

      // Set up the LLM - use Navigator model configuration
      const providers = await llmProviderStore.getAllProviders();
      // if no providers, need to display the options page
      if (Object.keys(providers).length === 0) {
        throw new Error(t('bg_setup_noApiKeys'));
      }

      // Clean up any legacy validator settings for backward compatibility
      await agentModelStore.cleanupLegacyValidatorSettings();

      const agentModels = await agentModelStore.getAllAgentModels();
      // verify if every provider used in the agent models exists in the providers
      for (const agentModel of Object.values(agentModels)) {
        if (!providers[agentModel.provider]) {
          throw new Error(t('bg_setup_noProvider', [agentModel.provider]));
        }
      }

      const navigatorModel = agentModels[AgentNameEnum.Navigator];
      if (!navigatorModel) {
        throw new Error(t('bg_setup_noNavigatorModel'));
      }

      const navigatorProviderConfig = providers[navigatorModel.provider];
      if (!navigatorProviderConfig) {
        throw new Error(`Provider ${navigatorModel.provider} not found`);
      }

      const chatModel = createChatModel(navigatorProviderConfig, navigatorModel);

      // Create system and user messages
      const systemMessage = new SystemMessage(`You are an accessibility expert. Your task is to:
1. Generate a clear, concise summary of the web page content for users with visual impairments
2. Create improved alt text for images that are meaningful content (not decorative or advertisements)

Focus on making content accessible and understandable. Be concise but informative.

Return your response as JSON with this exact structure:
{
  "pageSummary": "Clear summary of the page's main content and purpose",
  "imageAnalysis": [
    {
      "imageUrl": "url of the image",
      "currentAlt": "current alt text",
      "generatedAlt": "improved alt text description"
    }
  ]
}`);

      const userPrompt = this.buildAnalysisPrompt({
        title: readabilityContent.title,
        content: readabilityContent.textContent,
        url,
        images: mainContentImages,
        siteName: readabilityContent.siteName || undefined,
        byline: readabilityContent.byline || undefined,
      });

      const userMessage = new HumanMessage(userPrompt);

      // Call the LLM directly
      const response = await chatModel.invoke([systemMessage, userMessage]);

      // Parse the response
      let analysisResult: AccessibilityAnalysisResult;
      try {
        const responseText = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        // Extract JSON from the response if it's wrapped in markdown or other text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
        analysisResult = JSON.parse(jsonStr);
      } catch (parseError) {
        logger.error('Failed to parse LLM response:', parseError);
        throw new Error('Failed to parse accessibility analysis response');
      }

      logger.info('Accessibility analysis completed successfully');
      return analysisResult;
    } catch (error) {
      logger.error('Accessibility analysis failed:', error);
      throw error;
    }
  }

  private buildAnalysisPrompt(context: {
    title: string;
    content: string;
    url: string;
    images: ImageInfo[];
    siteName?: string;
    byline?: string;
  }): string {
    return `
Please analyze this web page for accessibility improvements:

PAGE DETAILS:
- Title: ${context.title}
- URL: ${context.url}
- Site: ${context.siteName || 'Unknown'}

MAIN CONTENT:
${context.content.substring(0, 4000)} ${context.content.length > 4000 ? '...' : ''}

IMAGES TO ANALYZE (${context.images.length} images):
${context.images
  .map(
    (img, index) => `
${index + 1}. Image URL: ${img.imageUrl}
   Current Alt: "${img.currentAlt}"
`,
  )
  .join('')}

Task:
1. Create a concise summary of the page's main purpose and content (focus on what users need to know)
2. Generate improved alt text for each image listed above that:
   - Describes what's in the image
   - Explains its relevance to the content
   - Is concise but informative (50-125 characters)
   - At the begginning of the alt text ALWAYS add "Generated by VisibleAI:

Return only the JSON response as specified in the system message.
`;
  }
}
