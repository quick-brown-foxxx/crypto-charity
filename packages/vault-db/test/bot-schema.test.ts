import { describe, it, expect } from 'vitest';
import { handles, conversations } from '@open-care/vault-db/schema/bot-db';

// ---------------------------------------------------------------------------
// bot-db schema introspection tests
//
// These tests verify that the bot-db schema (handles + conversations tables)
// never stores plaintext PII. All chat routing uses encrypted columns and
// all user identity uses HMAC-derived references.
// ---------------------------------------------------------------------------

describe('bot-db schema', () => {
  // ---------------------------------------------------------------------------
  // Column name introspection via Drizzle table objects
  //
  // Drizzle's sqliteTable() uses Object.assign() to set column builders as
  // own enumerable properties on the returned table object, so Object.keys()
  // returns exactly the column names.
  // ---------------------------------------------------------------------------

  const handlesColumns = Object.keys(handles);
  const conversationsColumns = Object.keys(conversations);
  const allColumns = new Set([...handlesColumns, ...conversationsColumns]);

  // ---------------------------------------------------------------------------
  // Sanity: expected columns exist (catches accidental schema drift)
  // ---------------------------------------------------------------------------

  describe('handles table', () => {
    it('has expected columns', () => {
      expect(handlesColumns.sort()).toEqual([
        'first_seen_utc',
        'handle',
        'is_active',
        'last_seen_utc',
        'opaque_id',
        'telegram_chat_id_enc',
        'telegram_chat_key_version',
        'telegram_user_ref',
      ].sort());
    });
  });

  describe('conversations table', () => {
    it('has expected columns', () => {
      expect(conversationsColumns.sort()).toEqual([
        'created_at_utc',
        'delivery_code_hash',
        'delivery_code_last4',
        'encrypted_code_expires_at_utc',
        'encrypted_code_ttl_blob',
        'id',
        'kind',
        'opaque_id',
        'public_beneficiary_ref',
        'status',
        'updated_at_utc',
      ].sort());
    });
  });

  // ---------------------------------------------------------------------------
  // Plaintext PII prevention
  // ---------------------------------------------------------------------------

  describe('plaintext PII prevention', () => {
    it('no column named telegram_user_id (plaintext) exists in any bot-db table', () => {
      expect(allColumns.has('telegram_user_id')).toBe(false);
    });

    it('no column named telegram_chat_id (plaintext) exists in any bot-db table', () => {
      expect(allColumns.has('telegram_chat_id')).toBe(false);
    });

    it('no column named chat_id (plaintext standalone) exists in any bot-db table', () => {
      expect(allColumns.has('chat_id')).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Encrypted chat routing
  // ---------------------------------------------------------------------------

  describe('encrypted chat routing', () => {
    it('telegram_chat_id_enc exists in handles table', () => {
      expect(handlesColumns).toContain('telegram_chat_id_enc');
    });

    it('telegram_chat_id_enc is the only chat-route column across all bot-db tables', () => {
      // telegram_chat_key_version is a key version indicator, not a chat route
      const chatColumns = [...allColumns].filter(
        (c) => c.includes('chat') && c !== 'telegram_chat_key_version',
      );
      expect(chatColumns).toEqual(['telegram_chat_id_enc']);
    });
  });

  // ---------------------------------------------------------------------------
  // HMAC-derived user identity
  // ---------------------------------------------------------------------------

  describe('HMAC-derived user identity', () => {
    it('telegram_user_ref exists in handles table', () => {
      expect(handlesColumns).toContain('telegram_user_ref');
    });

    it('telegram_user_ref is the only user-identity column across all bot-db tables', () => {
      const userColumns = [...allColumns].filter((c) => c.includes('user'));
      expect(userColumns).toEqual(['telegram_user_ref']);
    });
  });
});
