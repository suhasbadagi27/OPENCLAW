import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config';
import { Signal, Classification, ClassificationSchema } from '../types';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const CLASSIFIER_PROMPT = `You are an intelligent assistant that classifies incoming signals for a personal assistant system.

Analyze the signal and return a JSON object with these fields:
- intent: one of [meeting_invite, meeting_update, meeting_cancel, question, approval, action_item, status_update, general]
- urgency: one of [high, medium, low]
- has_meeting: boolean — is this related to a meeting or calendar event?
- meeting_id: string or null — if a meeting ID is referenced
- summary: brief 1-sentence summary of what this signal is about
- requires_response: boolean — does this need a reply from the user?

Return ONLY valid JSON, no explanation.`;

/** Agent 2 — AI Classifier
 *
 * Uses Claude to detect intent, urgency, and meeting relevance.
 */
export class AIClassifierAgent {
  readonly name = 'AIClassifier';

  async handle(signal: Signal): Promise<Classification> {
    const userMessage = `Source: ${signal.source}
Type: ${signal.type}
Content: ${signal.raw_text}
Timestamp: ${signal.timestamp}
${signal.metadata ? `Metadata: ${JSON.stringify(signal.metadata)}` : ''}`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: CLASSIFIER_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('[AIClassifier] Unexpected response type from Claude');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.text);
    } catch {
      // Try to extract JSON from markdown code blocks
      const match = content.text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
      if (match) {
        parsed = JSON.parse(match[1]);
      } else {
        throw new Error(`[AIClassifier] Failed to parse Claude output: ${content.text}`);
      }
    }

    const classification = ClassificationSchema.parse(parsed);
    console.log(
      `[AIClassifier] Intent: ${classification.intent} | Urgency: ${classification.urgency} | Meeting: ${classification.has_meeting}`
    );
    return classification;
  }
}

export const aiClassifier = new AIClassifierAgent();
