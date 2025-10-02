import { createLogger } from '../log';
import { createChatModel } from '../agent/helper';
import { agentModelStore, llmProviderStore, AgentNameEnum, generalSettingsStore } from '@extension/storage';
import type BrowserContext from '../browser/context';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ReadabilityService } from './readability';
import { DOMContextEnricher } from './domContextEnricher';
import { VisionContextValidator } from './visionContextValidator';
import { HybridImageScorer } from './hybridImageScorer';
import { t } from '@extension/i18n';
import type { ContextualizedImageInfo, AnalysisQualityMetrics } from '@extension/storage/lib/accessibility/types';
import { SemanticArea } from '@extension/storage/lib/accessibility/types';

const logger = createLogger('AccessibilityService');

/**
 * Basic image information from initial extraction (before DOM enrichment)
 */
interface BasicImageInfo {
  imageUrl: string;
  currentAlt: string;
  selector: string;
  isMainContent: boolean;
  importanceScore: number;
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
   * Extract images from a web page with basic heuristic scoring
   */
  async extractImages(tabId: number): Promise<BasicImageInfo[]> {
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
   * Runs the enhanced accessibility pipeline with DOM and vision context
   *
   * @param tabId - Chrome tab ID
   * @param url - Page URL
   * @param images - Basic extracted images
   * @param pageContent - Page text content for vision context
   * @param pageTitle - Page title for vision context
   * @returns Enhanced images with DOM and vision context, plus quality metrics
   */
  private async runEnhancedPipeline(
    tabId: number,
    url: string,
    images: BasicImageInfo[],
    pageContent: string,
    pageTitle: string,
    useVision: boolean,
  ): Promise<{ images: ContextualizedImageInfo[]; metrics: AnalysisQualityMetrics }> {
    const startTime = Date.now();

    try {
      logger.info('Starting enhanced accessibility pipeline');

      // Step 1: Enrich with DOM context
      const domEnricher = new DOMContextEnricher();
      const contextualizedImages = await domEnricher.enrichImagesWithDOMContext(tabId, url, images);

      // Step 2: Validate with vision (only if enabled)
      let validatedImages = contextualizedImages;
      if (useVision) {
        const visionValidator = new VisionContextValidator(this.browserContext);
        validatedImages = await visionValidator.validateImageContext(
          tabId,
          url,
          pageTitle,
          pageContent,
          contextualizedImages,
        );
      } else {
        logger.info('Vision validation skipped (useVision=false)');
      }

      // Step 3: Apply hybrid scoring and select top images
      const scorer = new HybridImageScorer();
      const topImages = scorer.selectTopImages(validatedImages, 8);

      // Calculate metrics
      const processingTime = Date.now() - startTime;
      const visionEnabledCount = validatedImages.filter(img => img.visionContext).length;
      const relevantCount = validatedImages.filter(img => img.visionContext?.isRelevant).length;

      const metrics: AnalysisQualityMetrics = {
        originalImagesCount: images.length,
        contextualizedCount: contextualizedImages.length,
        validatedCount: visionEnabledCount,
        finalTopImages: topImages.length,
        visionEnabled: visionEnabledCount > 0,
        tokensEstimate: this.estimateTokens(pageContent, topImages),
        processingTime,
        imageRelevanceRate: visionEnabledCount > 0 ? relevantCount / visionEnabledCount : 1.0,
        qualityLevel: this.determineQualityLevel(visionEnabledCount, topImages.length),
      };

      logger.info('Enhanced pipeline completed', metrics);

      return { images: topImages, metrics };
    } catch (error) {
      logger.error('Enhanced pipeline failed, falling back to basic images:', error);

      // Graceful fallback: convert basic images to ContextualizedImageInfo format
      const fallbackImages: ContextualizedImageInfo[] = images.slice(0, 8).map(img => ({
        imageUrl: img.imageUrl,
        currentAlt: img.currentAlt,
        selector: img.selector || '',
        isMainContent: img.isMainContent || false,
        importanceScore: img.importanceScore || 0,
        domContext: {
          isInMainContent: img.isMainContent || false,
          isInViewport: false,
          isInteractive: false,
          parentContext: '',
          semanticArea: SemanticArea.UNKNOWN,
          hierarchyLevel: 0,
          surroundingText: '',
        },
      }));

      const metrics: AnalysisQualityMetrics = {
        originalImagesCount: images.length,
        contextualizedCount: 0,
        validatedCount: 0,
        finalTopImages: fallbackImages.length,
        visionEnabled: false,
        tokensEstimate: this.estimateTokens(pageContent, fallbackImages),
        processingTime: Date.now() - startTime,
        imageRelevanceRate: 0,
        qualityLevel: 'low',
      };

      return { images: fallbackImages, metrics };
    }
  }

  /**
   * Estimates token count for the analysis
   */
  private estimateTokens(content: string, images: ContextualizedImageInfo[]): number {
    const contentTokens = Math.ceil(content.length / 4);
    const imageTokens = images.length * 50;
    return contentTokens + imageTokens;
  }

  /**
   * Determines quality level based on vision validation and image count
   */
  private determineQualityLevel(visionValidatedCount: number, finalImageCount: number): 'high' | 'medium' | 'low' {
    if (visionValidatedCount > 0 && finalImageCount >= 5) return 'high';
    if (finalImageCount >= 3) return 'medium';
    return 'low';
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

      // Get useVision setting
      const generalSettings = await generalSettingsStore.getSettings();
      const useVision = generalSettings.useVision;

      logger.info('Starting accessibility analysis with useVision:', useVision);

      // Extract images from the page
      const images = await this.extractImages(tabId);

      // Run enhanced pipeline with DOM and vision context
      const { images: enhancedImages, metrics } = await this.runEnhancedPipeline(
        tabId,
        url,
        images,
        readabilityContent.textContent,
        readabilityContent.title,
        useVision,
      );

      logger.info('Enhanced images:', enhancedImages.length, 'metrics:', metrics);

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

      // Use enhanced prompt with DOM and vision context
      const userPrompt = this.buildEnhancedAnalysisPrompt({
        title: readabilityContent.title,
        content: readabilityContent.textContent,
        url,
        images: enhancedImages,
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

  /**
   * Groups images by their semantic area
   */
  private groupImagesBySemanticArea(images: ContextualizedImageInfo[]): Map<SemanticArea, ContextualizedImageInfo[]> {
    const grouped = new Map<SemanticArea, ContextualizedImageInfo[]>();

    for (const image of images) {
      const area = image.domContext.semanticArea;
      if (!grouped.has(area)) {
        grouped.set(area, []);
      }
      grouped.get(area)!.push(image);
    }

    return grouped;
  }

  /**
   * Builds structural context summary for the page
   */
  private buildStructuralContext(images: ContextualizedImageInfo[]): string {
    const grouped = this.groupImagesBySemanticArea(images);
    const areas: string[] = [];

    for (const [area, imgs] of grouped.entries()) {
      areas.push(`- ${area}: ${imgs.length} image(s)`);
    }

    return areas.join('\n');
  }

  /**
   * Infers page type based on image distribution and content
   */
  private inferPageType(images: ContextualizedImageInfo[]): string {
    const mainContentImages = images.filter(img => img.domContext.isInMainContent);
    const totalImages = images.length;

    if (totalImages === 0) return 'Text-only Article';
    if (mainContentImages.length >= 5) return 'Product/Gallery Page';
    if (mainContentImages.length >= 2) return 'Illustrated Article';
    return 'Mixed Content Page';
  }

  /**
   * Formats images with full DOM and vision context
   */
  private formatImagesWithContext(images: ContextualizedImageInfo[]): string {
    return images
      .map((img, index) => {
        const parts = [
          `${index + 1}. Image URL: ${img.imageUrl}`,
          `   Current Alt: "${img.currentAlt}"`,
          `   Location: ${img.domContext.semanticArea}${img.domContext.isInMainContent ? ' (main content)' : ''}`,
          `   Hierarchy Level: ${img.domContext.hierarchyLevel}`,
        ];

        if (img.domContext.surroundingText) {
          parts.push(`   Surrounding Text: "${img.domContext.surroundingText}"`);
        }

        if (img.visionContext) {
          parts.push(`   Visual Description: "${img.visionContext.visualDescription}"`);
          parts.push(
            `   Relevance: ${img.visionContext.isRelevant ? 'Relevant' : 'Not relevant'} (${(img.visionContext.relevanceScore * 100).toFixed(0)}%)`,
          );
          parts.push(`   Reason: ${img.visionContext.relevanceReason}`);
        }

        if (img.finalScore !== undefined) {
          parts.push(`   Final Score: ${img.finalScore}`);
        }

        return parts.join('\n');
      })
      .join('\n\n');
  }

  /**
   * Builds enhanced analysis prompt with DOM and vision context
   */
  private buildEnhancedAnalysisPrompt(context: {
    title: string;
    content: string;
    url: string;
    images: ContextualizedImageInfo[];
    siteName?: string;
    byline?: string;
  }): string {
    const pageType = this.inferPageType(context.images);
    const structuralContext = this.buildStructuralContext(context.images);
    const mainContentImages = context.images.filter(img => img.domContext.isInMainContent);
    const otherImages = context.images.filter(img => !img.domContext.isInMainContent);

    return `
Please analyze this web page for accessibility improvements:

# PAGE INFORMATION
- Title: ${context.title}
- URL: ${context.url}
- Site: ${context.siteName || 'Unknown'}
${context.byline ? `- Author: ${context.byline}` : ''}
- Inferred Page Type: ${pageType}

# MAIN CONTENT
${context.content.substring(0, 4000)}${context.content.length > 4000 ? '...' : ''}

# STRUCTURAL CONTEXT
Image distribution by semantic area:
${structuralContext}

# IMAGES FOR ACCESSIBILITY ANALYSIS

## Main Content Images (${mainContentImages.length} images)
${mainContentImages.length > 0 ? this.formatImagesWithContext(mainContentImages) : 'No main content images detected'}

${otherImages.length > 0 ? `## Other Relevant Images (${otherImages.length} images)\n${this.formatImagesWithContext(otherImages)}` : ''}

# YOUR TASK
1. **PAGE SUMMARY** (200-300 words): Create a comprehensive, accessible summary of the page's main content and purpose for users with visual impairments.

2. **IMAGE ALT TEXT**: Generate improved alt text for each image above that:
   - Describes what's in the image accurately
   - Explains its relevance to the surrounding content
   - Is concise but informative (50-150 characters)
   - Begins with "Generated by VisibleAI: "
   - Takes into account the visual description and context provided

3. **ACCESSIBILITY INSIGHTS**: Note any patterns or issues in the current accessibility state.

Return only the JSON response as specified in the system message.
`;
  }

  /**
   * Legacy analysis prompt builder (kept for reference)
   * @deprecated Use buildEnhancedAnalysisPrompt instead
   */
  private buildAnalysisPrompt(context: {
    title: string;
    content: string;
    url: string;
    images: BasicImageInfo[];
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
