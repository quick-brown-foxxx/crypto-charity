-- Seed data for bot-db (local development)
-- Generated for Slice 1.4

-- Sample handles (3 Telegram users)
INSERT OR IGNORE INTO handles (opaque_id, handle, telegram_user_ref, telegram_chat_id_enc, telegram_chat_key_version, first_seen_utc, last_seen_utc, is_active) VALUES
  ('opq_a1b2c3d4e5f6g7h8', 'alice_care', 'tg-ref-alice-001', 'enc-chat-alice-001-a1b2c3d4e5f6', 1, '2026-06-14T10:00:00Z', '2026-06-16T10:00:00Z', 1);

INSERT OR IGNORE INTO handles (opaque_id, handle, telegram_user_ref, telegram_chat_id_enc, telegram_chat_key_version, first_seen_utc, last_seen_utc, is_active) VALUES
  ('opq_i9j0k1l2m3n4o5p6', 'bob_helper', 'tg-ref-bob-002', 'enc-chat-bob-002-i9j0k1l2m3n4', 1, '2026-06-14T11:00:00Z', '2026-06-15T14:00:00Z', 1);

INSERT OR IGNORE INTO handles (opaque_id, handle, telegram_user_ref, telegram_chat_id_enc, telegram_chat_key_version, first_seen_utc, last_seen_utc, is_active) VALUES
  ('opq_q7r8s9t0u1v2w3x4', 'carol_giver', 'tg-ref-carol-003', 'enc-chat-carol-003-q7r8s9t0u1v2', 1, '2026-06-15T08:00:00Z', '2026-06-16T09:00:00Z', 1);

-- Sample conversations (4 conversations across different states)

-- Conversation 1: alice's delivered card_request
-- NOTE: public_beneficiary_ref set to NULL because the GLOB CHECK constraint
-- is too complex for local D1 SQLite. The schema constraint works on Cloudflare D1.
INSERT OR IGNORE INTO conversations (opaque_id, kind, status, public_beneficiary_ref, delivery_code_hash, delivery_code_last4, encrypted_code_ttl_blob, encrypted_code_expires_at_utc, created_at_utc, updated_at_utc) VALUES
  ('opq_a1b2c3d4e5f6g7h8', 'card_request', 'delivered', NULL, 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2', '1234', 'dGhpcyBpcyBhIGZha2UgZW5jcnlwdGVkIGNvZGUgYmxvYg==', '2026-06-16T10:00:00Z', '2026-06-15T09:00:00Z', '2026-06-15T09:30:00Z');

-- Conversation 2: bob's pending card_request (no beneficiary ref yet)
INSERT OR IGNORE INTO conversations (opaque_id, kind, status, public_beneficiary_ref, delivery_code_hash, delivery_code_last4, encrypted_code_ttl_blob, encrypted_code_expires_at_utc, created_at_utc, updated_at_utc) VALUES
  ('opq_i9j0k1l2m3n4o5p6', 'card_request', 'pending', NULL, NULL, NULL, NULL, NULL, '2026-06-15T14:00:00Z', '2026-06-15T14:00:00Z');

-- Conversation 3: alice's operator_reply (delivered)
INSERT OR IGNORE INTO conversations (opaque_id, kind, status, public_beneficiary_ref, delivery_code_hash, delivery_code_last4, encrypted_code_ttl_blob, encrypted_code_expires_at_utc, created_at_utc, updated_at_utc) VALUES
  ('opq_a1b2c3d4e5f6g7h8', 'operator_reply', 'delivered', NULL, NULL, NULL, NULL, NULL, '2026-06-16T10:00:00Z', '2026-06-16T10:05:00Z');

-- Conversation 4: carol's in_flight card_request
-- NOTE: public_beneficiary_ref set to NULL (same GLOB constraint issue as above)
INSERT OR IGNORE INTO conversations (opaque_id, kind, status, public_beneficiary_ref, delivery_code_hash, delivery_code_last4, encrypted_code_ttl_blob, encrypted_code_expires_at_utc, created_at_utc, updated_at_utc) VALUES
  ('opq_q7r8s9t0u1v2w3x4', 'card_request', 'in_flight', NULL, 'f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e6d7c8b9a0f1e2', '5678', 'YW5vdGhlciBmYWtlIGVuY3J5cHRlZCBjb2RlIGJsb2I=', '2026-06-17T12:00:00Z', '2026-06-16T09:00:00Z', '2026-06-16T09:15:00Z');

-- Seed data summary:
--   3 handles: alice_care, bob_helper, carol_giver (all active)
--   4 conversations: 3 card_request (delivered, pending, in_flight), 1 operator_reply (delivered)
