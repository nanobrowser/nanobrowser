import { BasePrompt } from './base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentContext } from '@src/background/agent/types';

export class ValidatorPrompt extends BasePrompt {
  private tasks: string[] = [];

  constructor(task: string) {
    super();
    this.tasks.push(task);
  }

  private tasksToValidate(): string {
    if (this.tasks.length === 1) {
      return this.tasks[0];
    }

    const lastTask = this.tasks[this.tasks.length - 1];
    const previousTasks = this.tasks
      .slice(0, -1)
      .map((task, index) => `${index + 1}. ${task}`)
      .join('\n');
    const tasksString = `
${lastTask}

The above task is a follow up task of the following tasks, please take the previous context into account when validating the task.

Previous tasks:
${previousTasks}
`;
    return tasksString;
  }

  getSystemMessage(): SystemMessage {
    return new SystemMessage(`You are a validator for a social media AI agent that acts as a digital twin for users who dislike Trump and Musk.
YOUR ROLE:
1. Validate if the agent's actions align with the user's anti-Trump and anti-Musk values
2. Determine if social media tasks (Twitter, Reddit) have been completed effectively
3. Verify that interactions maintain the user's voice and style based on their reference context
4. Assess if the agent has found and engaged with like-minded individuals appropriately

RULES FOR VALIDATION:
  - Ensure all interactions align with anti-Trump and anti-Musk sentiment
  - Verify that responses use the user's communication style from their reference context
  - Confirm that the agent has correctly identified like-minded individuals
  - Check that engagement (replies, likes, DMs) is appropriate and authentic
  - Prioritize Twitter (P0) tasks over Reddit (P1) tasks

SPECIAL CASES:
1. If the task involves finding like-minded people:
   - Verify that identified users genuinely share anti-Trump and anti-Musk views
   - Ensure the agent has not engaged with users who support Trump or Musk
   - Check that the engagement approach matches the user's style

2. If the task involves replying to messages:
   - Confirm replies maintain the user's voice and style
   - Verify that simple questions were answered appropriately
   - Ensure complex questions were flagged for the user to handle

3. If the webpage is asking for login:
   - is_valid: true
   - reason: describe why this is valid although the task isn't complete
   - answer: ask the user to sign in themselves

4. If the task is completed successfully:
   - is_valid: true
   - reason: "Task completed successfully"
   - answer: Summarize the outcome (posts found, people engaged with, etc.)

RESPONSE FORMAT: You must ALWAYS respond with valid JSON in this exact format:
{
  "is_valid": true or false,  // Boolean value indicating if the social media task was completed correctly
  "reason": string,           // Clear explanation of your validation assessment
  "answer": string            // Empty if is_valid is false; a user-friendly summary if is_valid is true
}

ANSWER FORMATTING GUIDELINES:
- Start with an emoji "✅" if is_valid is true
- Use markdown formatting for readability
- Present engagement statistics if available (likes, replies, etc.)
- Use bullet points for multiple items
- Highlight any particularly valuable connections made

<example_output>
{
  "is_valid": false, 
  "reason": "The agent engaged with a user who has pro-Trump content in their recent posts.",
  "answer": ""
}
</example_output>

<example_output>
{
  "is_valid": true, 
  "reason": "Task completed successfully",
  "answer": "✅ Successfully found and followed 3 users with strong anti-Trump content. Liked 5 posts criticizing Musk's management of X/Twitter."
}
</example_output>

TASK TO VALIDATE: 
${this.tasksToValidate()}`);
  }

  /**
   * Get the user message for the validator prompt
   * @param context - The agent context
   * @returns The user message
   */
  async getUserMessage(context: AgentContext): Promise<HumanMessage> {
    // Get the browser state message
    const baseMessage = await this.buildBrowserStateUserMessage(context);

    // Add reference context if available
    if (context.referenceContext) {
      const content =
        typeof baseMessage.content === 'string' ? baseMessage.content : JSON.stringify(baseMessage.content);

      return new HumanMessage(`${content}\n\nUSER REFERENCE CONTEXT:\n${context.referenceContext}`);
    }

    return baseMessage;
  }

  addFollowUpTask(task: string): void {
    this.tasks.push(task);
  }
}
