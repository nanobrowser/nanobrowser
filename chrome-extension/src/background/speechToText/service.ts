import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage } from '@langchain/core/messages';
import { createLogger } from '../log';
import { ProviderConfig } from '@extension/storage';

const logger = createLogger('SpeechToText');

export class SpeechToTextService {
  private llm: ChatGoogleGenerativeAI;

  constructor(providerConfig: ProviderConfig) {
    this.llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.0-flash',
      apiKey: providerConfig.apiKey,
    });
  }

  async transcribeAudio(base64Audio: string): Promise<string> {
    try {
      logger.info('Starting audio transcription...');

      // Create transcription message with audio data
      const transcriptionMessage = new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Transcribe this audio. Return only the transcribed text without any additional formatting or explanations.',
          },
          {
            type: 'media',
            data: base64Audio,
            mimeType: 'audio/webm',
          },
        ],
      });

      // Get transcription from Gemini
      const transcriptionResponse = await this.llm.invoke([transcriptionMessage]);

      const transcribedText = transcriptionResponse.content.toString().trim();
      logger.info('Audio transcription completed:', transcribedText);

      return transcribedText;
    } catch (error) {
      logger.error('Failed to transcribe audio:', error);
      throw new Error(`Speech transcription failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
