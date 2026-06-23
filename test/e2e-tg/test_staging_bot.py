from __future__ import annotations

import pytest

from conftest import (
    assert_full_code_absent,
    assert_message_contains,
    assert_message_has_full_code,
    assert_no_plaintext_identifiers,
    assert_only_safe_code_fields,
    assert_request_no_longer_pending,
    close_pending_request_with_test_code,
    create_pending_card_request,
    deliver_code_to_pending_request,
    fetch_all_pending_requests,
    fetch_pending_requests_raw,
    make_test_code,
    message_text,
    parse_pending_requests,
    send_bot_command,
    send_bot_command_allowing_no_response,
    wait_for_pending_request,
)


pytestmark = pytest.mark.tg_e2e


@pytest.mark.asyncio
async def test_start_registration_succeeds_with_welcome_reply(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: /start <handle> registers the staging test user.
      Given the Telethon test user opens a conversation with the staging bot
      When the user sends /start with a unique handle
      Then the bot confirms registration and invites the user to request a card
    """
    response = await send_bot_command(telegram_client, staging_bot_username, f"/start {unique_handle}")

    assert_message_contains(response, f"@{unique_handle}", "registration response did not include the handle")
    assert_message_contains(response, "/card", "registration response did not mention /card")


@pytest.mark.asyncio
async def test_card_creates_pending_request_visible_to_operator(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: /card creates an operator-visible pending request.
      Given the Telethon test user is registered with the staging bot
      When the user sends /card
      Then /tg/internal/pending-requests exposes a redacted pending item for that handle
    """
    pending_request = await create_pending_card_request(telegram_client, staging_bot_username, unique_handle)
    try:
        assert pending_request["internal_handle"] == unique_handle
        assert pending_request["request_status"] == "pending"
    finally:
        await close_pending_request_with_test_code(telegram_client, staging_bot_username, pending_request)


@pytest.mark.asyncio
async def test_operator_send_code_delivers_message_to_test_user(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: /tg/internal/send-code delivers a gift-card message.
      Given a pending card request from the Telethon test user
      When the operator staging endpoint sends a generated test gift-card code
      Then the test user receives the delivery message in Telegram
    """
    pending_request = await create_pending_card_request(telegram_client, staging_bot_username, unique_handle)
    test_code = make_test_code()

    delivered_message = await deliver_code_to_pending_request(
        telegram_client,
        staging_bot_username,
        pending_request,
        test_code,
    )

    assert_message_has_full_code(delivered_message, test_code)


@pytest.mark.asyncio
async def test_bot_responses_do_not_contain_plaintext_telegram_ids(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: Bot replies do not leak Telegram identifiers.
      Given the Telethon test user's Telegram ID is known to the test harness
      When the user registers, requests a card, and asks for help
      Then no bot response contains the plaintext Telegram user/chat identifier
    """
    me = await telegram_client.get_me()
    user_id = getattr(me, "id", None)
    if not isinstance(user_id, int):
        pytest.fail("Telethon did not expose a numeric test user id", pytrace=False)

    start_response = await send_bot_command(telegram_client, staging_bot_username, f"/start {unique_handle}")
    card_response = await send_bot_command(telegram_client, staging_bot_username, "/card")
    pending_request = await wait_for_pending_request(unique_handle)
    request_needs_cleanup = True

    def mark_request_closed() -> None:
        nonlocal request_needs_cleanup
        request_needs_cleanup = False

    try:
        help_response = await send_bot_command(telegram_client, staging_bot_username, "/help")
        test_code = make_test_code()
        delivered_message = await deliver_code_to_pending_request(
            telegram_client,
            staging_bot_username,
            pending_request,
            test_code,
            on_delivery_accepted=mark_request_closed,
        )
        assert_message_has_full_code(delivered_message, test_code)

        assert_no_plaintext_identifiers(
            [
                message_text(start_response),
                message_text(card_response),
                message_text(help_response),
                message_text(delivered_message),
            ],
            [str(user_id)],
        )
    finally:
        if request_needs_cleanup:
            await close_pending_request_with_test_code(telegram_client, staging_bot_username, pending_request)


@pytest.mark.asyncio
async def test_pending_requests_stays_code_free_after_delivery_and_excludes_delivered_row(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: Pending-requests surface stays code-free after delivery.
      Given a pending card request from the Telethon test user
      When the operator staging endpoint delivers a generated test gift-card code
      Then the delivery message contains the code for the user
      And the delivered conversation is not exposed on pending-requests
      And the remaining pending-requests surface has no full code values or code-named fields

    Note: delivered rows are excluded from /tg/internal/pending-requests by
    contract, so this test proves that endpoint stays code-free after delivery;
    it does not inspect delivered-row hash or last4 retention directly.
    """
    pending_request = await create_pending_card_request(telegram_client, staging_bot_username, unique_handle)
    test_code = make_test_code()

    delivered_message = await deliver_code_to_pending_request(
        telegram_client,
        staging_bot_username,
        pending_request,
        test_code,
    )

    assert_message_has_full_code(delivered_message, test_code)

    raw_pending_response = await fetch_pending_requests_raw()
    parsed_pending_response = parse_pending_requests(raw_pending_response)
    assert_request_no_longer_pending(parsed_pending_response["items"], pending_request)
    assert_full_code_absent(raw_pending_response, test_code)
    assert_only_safe_code_fields(raw_pending_response)


@pytest.mark.asyncio
async def test_duplicate_start_and_invalid_commands_are_graceful(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: Duplicate registration and invalid commands are graceful.
      Given the Telethon test user is already registered with a handle
      When the user repeats /start with the same handle
      And sends an invalid handle and an unknown command
      Then the bot returns safe guidance or ignores the unknown command without leaking identifiers
    """
    first_response = await send_bot_command(telegram_client, staging_bot_username, f"/start {unique_handle}")
    duplicate_response = await send_bot_command(telegram_client, staging_bot_username, f"/start {unique_handle}")
    invalid_handle_response = await send_bot_command(telegram_client, staging_bot_username, "/start benpub_invalid")
    unknown_command_response = await send_bot_command_allowing_no_response(
        telegram_client,
        staging_bot_username,
        "/not_a_real_open_care_command",
    )

    assert_message_contains(first_response, f"@{unique_handle}", "initial registration did not succeed")
    assert_message_contains(duplicate_response, "Re-registered", "duplicate registration was not acknowledged")
    assert_message_contains(invalid_handle_response, "Invalid handle", "invalid handle did not receive guidance")

    me = await telegram_client.get_me()
    user_id = getattr(me, "id", None)
    if not isinstance(user_id, int):
        pytest.fail("Telethon did not expose a numeric test user id", pytrace=False)

    response_texts = [
        message_text(first_response),
        message_text(duplicate_response),
        message_text(invalid_handle_response),
    ]
    if unknown_command_response is not None:
        response_texts.append(message_text(unknown_command_response))

    assert_no_plaintext_identifiers(response_texts, [str(user_id)])


@pytest.mark.asyncio
async def test_pending_requests_contract_stays_redacted(
    telegram_client,
    staging_bot_username: str,
    unique_handle: str,
) -> None:
    """
    Scenario: Pending requests expose only the operator-safe contract.
      Given a pending card request from the staging bot
      When the operator pending-requests endpoint is read
      Then the matching item contains only redacted action fields
    """
    pending_request = await create_pending_card_request(telegram_client, staging_bot_username, unique_handle)
    try:
        pending_response = await fetch_all_pending_requests()
        matching_items = [
            item
            for item in pending_response["items"]
            if item["conversation_id"] == pending_request["conversation_id"]
        ]

        if len(matching_items) != 1:
            pytest.fail("Could not find exactly one matching pending request in the operator response", pytrace=False)

        assert set(matching_items[0].keys()) == {
            "opaque_id",
            "conversation_id",
            "internal_handle",
            "request_status",
            "created_at_utc",
            "updated_at_utc",
        }
    finally:
        await close_pending_request_with_test_code(telegram_client, staging_bot_username, pending_request)
