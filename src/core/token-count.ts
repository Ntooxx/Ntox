import type { Message } from "../types/index.js";

export function countTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil((text.length / 4 + (text.match(/\S+/g) || []).length * 1.33) / 2);
}

export function countMessageTokens(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + countTokens(message.content), 0);
}
