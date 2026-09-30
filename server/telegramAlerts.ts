import { readFile } from 'node:fs/promises';
import type { Collection } from 'mongodb';
import type { TelegramAlertDocument, TelegramAlertStateDocument, TelegramAuditDocument } from './database.js';

const REPEAT_INTERVAL_MS = 30 * 60_000;

interface TelegramUpdate {
  update_id: number;
  message?: { chat?: { id?: number; type?: string } };
}

export function privateChatId(update: TelegramUpdate): string | undefined {
  const chat = update.message?.chat;
  return chat?.type === 'private' && Number.isSafeInteger(chat.id) ? String(chat.id) : undefined;
}

export function alertShouldSend(failures: number, threshold: number, lastSentAt: Date | undefined, now: Date) {
  return failures >= threshold && (!lastSentAt || now.getTime() - lastSentAt.getTime() >= REPEAT_INTERVAL_MS);
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramAlertService {
  pollAdminClaim(): Promise<void>;
  failure(key: string, message: string, threshold?: number): Promise<void>;
  recovery(key: string, message: string): Promise<void>;
}

export async function createTelegramAlertService(
  tokenFile: string,
  alerts: Collection<TelegramAlertDocument>,
  states: Collection<TelegramAlertStateDocument>,
  audit: Collection<TelegramAuditDocument>,
): Promise<TelegramAlertService> {
  const token = (await readFile(tokenFile, 'utf8')).trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Telegram bot token file is invalid.');
  const now = new Date();
  await alerts.updateOne(
    { key: 'telegram-alerts' },
    { $setOnInsert: { key: 'telegram-alerts', updateOffset: 0, createdAt: now, updatedAt: now } },
    { upsert: true },
  );

  async function api<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as TelegramResponse<T>;
    if (!response.ok || !result.ok || result.result === undefined) {
      throw new Error(`Telegram ${method} failed: ${result.description || response.status}`);
    }
    return result.result;
  }

  async function send(chatId: string, text: string) {
    await api('sendMessage', { chat_id: chatId, text: text.slice(0, 4_000), disable_web_page_preview: true });
  }

  async function adminChatId() {
    return (await alerts.findOne({ key: 'telegram-alerts' }))?.adminChatId;
  }

  return {
    async pollAdminClaim() {
      const current = await alerts.findOne({ key: 'telegram-alerts' });
      const updates = await api<TelegramUpdate[]>('getUpdates', {
        offset: current?.updateOffset ?? 0,
        timeout: 0,
        allowed_updates: ['message'],
      });
      for (const update of updates) {
        const nextOffset = update.update_id + 1;
        await alerts.updateOne(
          { key: 'telegram-alerts' },
          { $max: { updateOffset: nextOffset }, $set: { updatedAt: new Date() } },
        );
        const chatId = privateChatId(update);
        if (!chatId) continue;
        const claimedAt = new Date();
        const claimed = await alerts.findOneAndUpdate(
          { key: 'telegram-alerts', adminChatId: { $exists: false } },
          { $set: { adminChatId: chatId, updatedAt: claimedAt } },
          { returnDocument: 'after' },
        );
        if (claimed?.adminChatId === chatId) {
          await audit.insertOne({ action: 'claim', chatId, createdAt: claimedAt });
          await send(chatId, 'Fare Share alerts are now assigned to this private chat.');
        } else if ((await adminChatId()) !== chatId) {
          await send(chatId, 'Fare Share alert administrator is already configured.');
        }
      }
    },

    async failure(key, message, threshold = 1) {
      const changedAt = new Date();
      const state = await states.findOneAndUpdate(
        { key },
        { $inc: { failures: 1 }, $set: { active: true, updatedAt: changedAt }, $setOnInsert: { key } },
        { upsert: true, returnDocument: 'after' },
      );
      if (!state || !alertShouldSend(state.failures, threshold, state.lastSentAt, changedAt)) return;
      const chatId = await adminChatId();
      if (!chatId) return;
      await send(chatId, `ALERT: ${message}`);
      await states.updateOne({ key }, { $set: { lastSentAt: changedAt, updatedAt: changedAt } });
    },

    async recovery(key, message) {
      const state = await states.findOne({ key });
      if (!state?.active) return;
      const recoveredAt = new Date();
      await states.updateOne(
        { key },
        { $set: { failures: 0, active: false, updatedAt: recoveredAt }, $unset: { lastSentAt: '' } },
      );
      const chatId = await adminChatId();
      if (chatId) await send(chatId, `RECOVERED: ${message}`);
    },
  };
}
