import { Result, ok, err } from '@open-care/vault-core';

/**
 * Parsed Telegram Update with only the fields we need.
 *
 * A full Telegram Update has many more fields; we extract only
 * the subset relevant to command handling.
 *
 * All optional fields use `| undefined` rather than `?` to satisfy
 * `exactOptionalPropertyTypes: true`.
 */
export interface ParsedUpdate {
  update_id: number;
  message: {
    message_id: number;
    from: { id: number; first_name: string | undefined } | undefined;
    chat: { id: number } | undefined;
    text: string | undefined;
  } | undefined;
}

/**
 * Send a text message via the Telegram Bot API.
 *
 * Calls `POST https://api.telegram.org/bot<TOKEN>/sendMessage` with
 * a JSON body containing `chat_id` and `text`.
 *
 * @param botToken - The bot token from `TG_BOT_TOKEN`
 * @param chatId - The target chat ID (decrypted from storage)
 * @param text - The message text to send
 * @returns A Result with the parsed response JSON on success, or an
 *   error string on failure.
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: number | string,
  text: string,
): Promise<Result<unknown, string>> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      const body = await response.text();
      return err(
        `Telegram API returned ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const data: unknown = await response.json();
    return ok(data);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown fetch error';
    return err(`Failed to send Telegram message: ${message}`);
  }
}

/**
 * Parse a Telegram Update from the webhook request body.
 *
 * Validates the minimal structure required for command handling:
 * the body must be an object with a numeric `update_id` and an
 * optional `message` object.
 *
 * @param body - The parsed JSON body from the webhook request
 * @returns A ParsedUpdate if the body matches the expected shape,
 *   or `null` if it does not.
 */
export function parseUpdate(body: unknown): ParsedUpdate | null {
  if (body === null || typeof body !== 'object') {
    return null;
  }

  const obj = body as Record<string, unknown>;

  const updateId = obj['update_id'];
  if (typeof updateId !== 'number') {
    return null;
  }

  const message = obj['message'];
  if (message === undefined || message === null || typeof message !== 'object') {
    // Updates without a message (e.g. callback queries) are valid
    // but we don't process them.
    return { update_id: updateId, message: undefined };
  }

  const msg = message as Record<string, unknown>;
  const messageId = msg['message_id'];
  if (typeof messageId !== 'number') {
    return null;
  }

  const from = msg['from'];
  let parsedFrom: { id: number; first_name: string | undefined } | undefined;
  if (from !== undefined && from !== null && typeof from === 'object') {
    const f = from as Record<string, unknown>;
    if (typeof f['id'] === 'number') {
      parsedFrom = {
        id: f['id'],
        first_name: typeof f['first_name'] === 'string' ? f['first_name'] : undefined,
      };
    }
  }

  const chat = msg['chat'];
  let parsedChat: { id: number } | undefined;
  if (chat !== undefined && chat !== null && typeof chat === 'object') {
    const c = chat as Record<string, unknown>;
    if (typeof c['id'] === 'number') {
      parsedChat = { id: c['id'] };
    }
  }

  const text = msg['text'];
  const parsedText: string | undefined =
    typeof text === 'string' ? text : undefined;

  return {
    update_id: updateId,
    message: {
      message_id: messageId,
      from: parsedFrom,
      chat: parsedChat,
      text: parsedText,
    },
  };
}

/**
 * Extract a command and its argument from message text.
 *
 * Telegram commands start with `/` followed by a command name
 * (lowercase letters and underscores). An optional argument may
 * follow after a space.
 *
 * Examples:
 * - `"/start alice_care"` → `{ command: "start", arg: "alice_care" }`
 * - `"/start"` → `{ command: "start", arg: "" }`
 * - `"hello"` → `null` (not a command)
 * - `"/Start"` → `{ command: "start", arg: "" }` (case-insensitive)
 *
 * @param text - The message text to parse
 * @returns The parsed command and argument, or `null` if the text
 *   does not start with a command.
 */
export function extractCommand(
  text: string,
): { command: string; arg: string } | null {
  // Commands start with '/' followed by a bot username or command name.
  // We accept: /command, /command@botname, /command arg
  const match = /^\/([a-zA-Z0-9_]+)(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/.exec(text);
  if (!match) {
    return null;
  }

  const commandName = match[1];
  const arg = match[2];
  if (commandName === undefined) {
    return null;
  }

  return {
    command: commandName.toLowerCase(),
    arg: arg ?? '',
  };
}
