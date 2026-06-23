#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "telethon>=1.36.0",
# ]
# ///

"""One-time Telethon session string generator.

Authenticates a Telegram test account and prints a StringSession that
can be reused in E2E test scripts without interactive login.

Run this once per test account. Store the resulting session string as
TELETHON_SESSION_STRING in .dev.vars (local) or GitHub Actions secrets
(staging CI).

Prerequisites:
  - A Telegram account dedicated to E2E testing (not your personal one).
  - api_id and api_hash from https://my.telegram.org/apps (see
    docs/ops/secrets-inventory.md § "E2E test account secrets").

Usage:
    uv run --script test/e2e-tg/get_session_string_draft.py

The script will prompt for:
    1. API ID (integer)
    2. API Hash (hex string)
    3. Phone number (linked to the test account)
    4. Login code (sent by Telegram to the test account)
    5. 2FA password (if the test account has two-factor auth enabled)

After successful authentication, it prints the session string and exits.
"""

from __future__ import annotations

import sys

from telethon.sync import TelegramClient
from telethon.sessions import StringSession


# =============================================================================
# Business Logic
# =============================================================================


def generate_session_string(api_id: int, api_hash: str) -> str:
    """Authenticate with Telegram and return a StringSession.

    Telethon's ``client.start()`` handles the interactive login flow:
    phone number prompt → code prompt → optional 2FA password prompt.
    Re-raises KeyboardInterrupt so the caller can exit cleanly.
    """
    with TelegramClient(StringSession(), api_id, api_hash) as client:
        client.start()
        return client.session.save()


# =============================================================================
# CLI Interface
# =============================================================================


def main() -> None:
    try:
        api_id = int(input("Enter API ID: "))
    except ValueError:
        print("Error: API ID must be an integer.", file=sys.stderr)
        sys.exit(1)

    api_hash = input("Enter API Hash: ").strip()
    if not api_hash:
        print("Error: API Hash must not be empty.", file=sys.stderr)
        sys.exit(1)

    try:
        session_string = generate_session_string(api_id, api_hash)
    except KeyboardInterrupt:
        sys.exit(130)

    print()
    print("=== SAVE THIS AS TELETHON_SESSION_STRING ===")
    print(session_string)
    print("==============================================")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)