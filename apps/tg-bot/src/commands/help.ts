/**
 * /help command handler.
 *
 * Returns a help text listing all available bot commands.
 */
export function handleHelp(): string {
  return [
    'Available commands:',
    '/start <handle> — Register with a handle',
    '/start — Show registration instructions',
    '/whoami — Show your current registration',
    '/card — Request a gift card',
    '/help — Show this help message',
  ].join('\n');
}
