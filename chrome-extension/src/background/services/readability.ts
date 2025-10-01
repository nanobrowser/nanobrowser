import { createLogger } from '../log';

const logger = createLogger('ReadabilityService');

export interface ArticleContent {
  title: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  byline: string | null;
  dir: string | null;
  siteName: string | null;
}

export interface ReadabilityResult {
  success: boolean;
  article?: ArticleContent;
  error?: string;
  processingTime: number;
  fallbackUsed: boolean;
}

export class ReadabilityService {
  /**
   * Extrai conteúdo da página usando Mozilla Readability via script injection
   */
  async extractContent(tabId: number): Promise<ReadabilityResult> {
    try {
      logger.info('Starting readability content extraction for tab:', tabId);

      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const startTime = Date.now();

          // Função de fallback quando Readability falha
          const fallbackExtraction = (): ArticleContent => {
            console.log('VIX: Using fallback content extraction');

            const title = document.title || document.querySelector('h1')?.textContent || 'Untitled';

            // Tentar encontrar conteúdo principal
            const contentSelectors = [
              'main',
              'article',
              '.content',
              '.post',
              '.entry',
              '[role="main"]',
              '.main-content',
              '#content',
            ];

            let contentElement: Element | null = null;
            for (const selector of contentSelectors) {
              contentElement = document.querySelector(selector);
              if (contentElement) break;
            }

            // Se não encontrar, usar body excluindo navegação
            if (!contentElement) {
              contentElement = document.body;
            }

            // Limpar elementos indesejados
            const unwantedSelectors = [
              'nav',
              'aside',
              'footer',
              'header',
              '.sidebar',
              '.menu',
              '.ad',
              '.ads',
              '.advertisement',
              '.banner',
            ];

            const clonedContent = contentElement.cloneNode(true) as Element;
            unwantedSelectors.forEach(selector => {
              const elements = clonedContent.querySelectorAll(selector);
              elements.forEach(el => el.remove());
            });

            const textContent = clonedContent.textContent || '';
            const content = clonedContent.innerHTML;

            return {
              title,
              content,
              textContent,
              length: textContent.length,
              excerpt: textContent.substring(0, 200) + '...',
              byline: extractByline(document),
              dir: document.documentElement.dir || null,
              siteName: extractSiteName(document),
            };
          };

          // Extrair byline (autor)
          const extractByline = (document: Document): string | null => {
            const bylineSelectors = [
              '.byline',
              '.author',
              '.writer',
              '.by-author',
              '[rel="author"]',
              '.post-author',
              '.article-author',
            ];

            for (const selector of bylineSelectors) {
              const element = document.querySelector(selector);
              if (element?.textContent?.trim()) {
                return element.textContent.trim();
              }
            }

            return null;
          };

          // Extrair nome do site
          const extractSiteName = (document: Document): string | null => {
            // Tentar meta property
            const siteName = document.querySelector('meta[property="og:site_name"]');
            if (siteName) {
              return siteName.getAttribute('content');
            }

            // Fallback para hostname
            return document.location?.hostname || null;
          };

          // Verificar se uma página é adequada para Readability
          const isReadabilityCandidate = (document: Document): boolean => {
            try {
              // Verificar se tem conteúdo suficiente
              const bodyText = document.body.textContent || '';
              const textLength = bodyText.trim().length;

              if (textLength < 100) {
                return false;
              }

              // Verificar estrutura semântica
              const structureChecks = ['article', 'main', 'h1', 'h2', 'p', '.post', '.entry', '.content'];

              let foundStructures = 0;
              for (const selector of structureChecks) {
                if (document.querySelector(selector)) {
                  foundStructures++;
                }
              }

              // Verificar densidade de texto vs elementos
              const allElements = document.querySelectorAll('*').length;
              const textDensity = textLength / Math.max(allElements, 1);
              const hasGoodDensity = textDensity > 5; // Pelo menos 5 caracteres por elemento

              return foundStructures >= 1 && hasGoodDensity;
            } catch (error) {
              console.warn('VIX: Error in readability candidate check:', error);
              return false;
            }
          };

          try {
            // Verificar se é candidato válido
            if (!isReadabilityCandidate(document)) {
              console.log('VIX: Not a good readability candidate, using fallback');
              const article = fallbackExtraction();
              return {
                success: true,
                article,
                processingTime: Date.now() - startTime,
                fallbackUsed: true,
              };
            }

            // Tentar usar Readability se estiver disponível na página
            // Como não podemos importar diretamente, usamos uma implementação simplificada
            // baseada nos princípios do Readability

            // Clonar documento para não modificar o original
            const clonedDoc = document.cloneNode(true) as Document;

            // Pré-processamento para melhorar resultados
            const problematicSelectors = [
              'script[src*="ads"]',
              'div[id*="ad"]',
              'div[class*="ad"]',
              '.popup',
              '.modal',
              '.overlay',
            ];

            problematicSelectors.forEach(selector => {
              try {
                const elements = clonedDoc.querySelectorAll(selector);
                elements.forEach(el => el.remove());
              } catch (error) {
                console.warn(`VIX: Error removing ${selector}:`, error);
              }
            });

            // Buscar o melhor candidato para conteúdo principal
            const candidates = [
              clonedDoc.querySelector('article'),
              clonedDoc.querySelector('main'),
              clonedDoc.querySelector('[role="main"]'),
              clonedDoc.querySelector('.post'),
              clonedDoc.querySelector('.entry'),
              clonedDoc.querySelector('.content'),
            ].filter(Boolean);

            let bestCandidate = candidates[0];
            if (!bestCandidate) {
              // Usar body como fallback
              bestCandidate = clonedDoc.body;
            }

            // Limpar conteúdo indesejado do candidato
            const unwantedInContent = [
              'nav',
              'aside',
              'footer',
              'header',
              '.sidebar',
              '.menu',
              '.ad',
              '.ads',
              '.advertisement',
              '.banner',
              '.comments',
              '.comment',
              '.related',
              '.share',
            ];

            const cleanCandidate = bestCandidate.cloneNode(true) as Element;
            unwantedInContent.forEach(selector => {
              const elements = cleanCandidate.querySelectorAll(selector);
              elements.forEach(el => el.remove());
            });

            const title = document.title || document.querySelector('h1')?.textContent || 'Untitled';
            const textContent = cleanCandidate.textContent || '';
            const content = cleanCandidate.innerHTML;

            // Validar se o resultado é bom
            if (textContent.length < 200) {
              console.log('VIX: Extracted content too short, using fallback');
              const article = fallbackExtraction();
              return {
                success: true,
                article,
                processingTime: Date.now() - startTime,
                fallbackUsed: true,
              };
            }

            const article: ArticleContent = {
              title,
              content,
              textContent,
              length: textContent.length,
              excerpt: textContent.substring(0, 200) + '...',
              byline: extractByline(document),
              dir: document.documentElement.dir || null,
              siteName: extractSiteName(document),
            };

            return {
              success: true,
              article,
              processingTime: Date.now() - startTime,
              fallbackUsed: false,
            };
          } catch (error) {
            console.warn('VIX: Readability parsing failed:', error);
            const article = fallbackExtraction();
            return {
              success: true,
              article,
              processingTime: Date.now() - startTime,
              fallbackUsed: true,
            };
          }
        },
      });

      const result = results[0]?.result;
      if (!result || !result.success) {
        throw new Error('Failed to extract content from page');
      }

      logger.info('Content extraction completed:', {
        textLength: result.article?.length || 0,
        fallbackUsed: result.fallbackUsed,
        processingTime: result.processingTime,
      });

      return result;
    } catch (error) {
      logger.error('Content extraction failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime: 0,
        fallbackUsed: false,
      };
    }
  }

  /**
   * Método simplificado para extrair apenas o texto
   */
  async extractTextContent(tabId: number): Promise<string> {
    const result = await this.extractContent(tabId);
    return result.article?.textContent || '';
  }
}
