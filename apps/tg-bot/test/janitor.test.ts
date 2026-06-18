import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createBotDb, botSchema } from '@open-care/vault-db';
import { eq } from 'drizzle-orm';
import { janitorExpiredCodeBlobs } from '../src/lib/janitor';

const { handles, conversations } = botSchema;

describe('janitorExpiredCodeBlobs', () => {
  let db: ReturnType<typeof createBotDb>;

  beforeEach(async () => {
    db = createBotDb(env.bot_db);
    // Delete conversations first (FK to handles), then handles
    await db.delete(conversations);
    await db.delete(handles);
  });

  /**
   * Insert a minimal handle row so the FK constraint on
   * conversations.opaque_id is satisfied.
   */
  async function insertHandle(opaqueId: string): Promise<void> {
    await db.insert(handles).values({
      opaque_id: opaqueId,
      handle: `janitor_h_${opaqueId.replace(/-/g, '_')}`,
      telegram_user_ref: `tg_ref_${opaqueId}`,
      telegram_chat_id_enc: `enc_chat_${opaqueId}`,
      telegram_chat_key_version: 1,
      first_seen_utc: '2026-01-01T00:00:00Z',
      last_seen_utc: '2026-01-01T00:00:00Z',
      is_active: 1,
    });
  }

  // ---------------------------------------------------------------------------
  // Test 1: Expired blob → cleared
  // ---------------------------------------------------------------------------

  it('clears expired blob and expiry, returns 1', async () => {
    await insertHandle('janitor-test-1');

    await db.insert(conversations).values({
      opaque_id: 'janitor-test-1',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: 'test-blob-data',
      encrypted_code_expires_at_utc: '2020-01-01T00:00:00Z',
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    const result = await janitorExpiredCodeBlobs(db);
    expect(result).toBe(1);

    const row = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-1'))
      .get();

    expect(row).toBeDefined();
    expect(row!.encrypted_code_ttl_blob).toBeNull();
    expect(row!.encrypted_code_expires_at_utc).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 2: Non-expired blob → left untouched
  // ---------------------------------------------------------------------------

  it('leaves non-expired blob untouched, returns 0', async () => {
    await insertHandle('janitor-test-2');

    await db.insert(conversations).values({
      opaque_id: 'janitor-test-2',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: 'test-blob-data',
      encrypted_code_expires_at_utc: '2099-01-01T00:00:00Z',
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    const result = await janitorExpiredCodeBlobs(db);
    expect(result).toBe(0);

    const row = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-2'))
      .get();

    expect(row).toBeDefined();
    expect(row!.encrypted_code_ttl_blob).toBe('test-blob-data');
    expect(row!.encrypted_code_expires_at_utc).toBe('2099-01-01T00:00:00Z');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Row with no blob → unchanged
  // ---------------------------------------------------------------------------

  it('leaves row with no blob unchanged, returns 0', async () => {
    await insertHandle('janitor-test-3');

    await db.insert(conversations).values({
      opaque_id: 'janitor-test-3',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: null,
      encrypted_code_expires_at_utc: null,
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    const result = await janitorExpiredCodeBlobs(db);
    expect(result).toBe(0);

    const row = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-3'))
      .get();

    expect(row).toBeDefined();
    expect(row!.encrypted_code_ttl_blob).toBeNull();
    expect(row!.encrypted_code_expires_at_utc).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Test 4: Multiple rows, mixed expired/non-expired → only expired cleared
  // ---------------------------------------------------------------------------

  it('clears only expired rows among mixed rows, returns 1', async () => {
    await insertHandle('janitor-test-4a');
    await insertHandle('janitor-test-4b');
    await insertHandle('janitor-test-4c');

    // Expired row
    await db.insert(conversations).values({
      opaque_id: 'janitor-test-4a',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: 'test-blob-data',
      encrypted_code_expires_at_utc: '2020-01-01T00:00:00Z',
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    // Non-expired row
    await db.insert(conversations).values({
      opaque_id: 'janitor-test-4b',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: 'test-blob-data',
      encrypted_code_expires_at_utc: '2099-01-01T00:00:00Z',
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    // No-blob row
    await db.insert(conversations).values({
      opaque_id: 'janitor-test-4c',
      kind: 'card_request',
      status: 'pending',
      encrypted_code_ttl_blob: null,
      encrypted_code_expires_at_utc: null,
      created_at_utc: '2026-01-01T00:00:00Z',
      updated_at_utc: '2026-01-01T00:00:00Z',
    });

    const result = await janitorExpiredCodeBlobs(db);
    expect(result).toBe(1);

    // Expired row should be cleared
    const rowA = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-4a'))
      .get();
    expect(rowA!.encrypted_code_ttl_blob).toBeNull();
    expect(rowA!.encrypted_code_expires_at_utc).toBeNull();

    // Non-expired row should be unchanged
    const rowB = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-4b'))
      .get();
    expect(rowB!.encrypted_code_ttl_blob).toBe('test-blob-data');
    expect(rowB!.encrypted_code_expires_at_utc).toBe('2099-01-01T00:00:00Z');

    // No-blob row should be unchanged
    const rowC = await db
      .select()
      .from(conversations)
      .where(eq(conversations.opaque_id, 'janitor-test-4c'))
      .get();
    expect(rowC!.encrypted_code_ttl_blob).toBeNull();
    expect(rowC!.encrypted_code_expires_at_utc).toBeNull();
  });
});
