import type { Agent } from "../core/agent.js";

export interface GatewayMessage {
  text: string;
  chatId: string;
  userId: string;
  username: string;
}

export interface GatewayChannel {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  notifyTyping(chatId: string): Promise<void>;
}

export interface SessionStore {
  get(chatId: string): Agent | undefined;
  set(chatId: string, agent: Agent): void;
  delete(chatId: string): void;
  touch(chatId: string): void;
  getLastActivity(chatId: string): number;
  getActiveChats(): string[];
}
