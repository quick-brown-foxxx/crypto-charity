from __future__ import annotations

import asyncio
import math
import os
import secrets
import string
import time
from collections.abc import AsyncIterator, Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, TypedDict
from urllib.parse import urlencode, urlparse

import httpx
import pytest
import pytest_asyncio

if TYPE_CHECKING:
    from telethon import TelegramClient
    from telethon.tl.custom.message import Message


STAGING_OPERATOR_BASE_URL = "https://staging.open-care.org"
DEFAULT_TG_E2E_TIMEOUT_SECONDS = 20.0
REQUIRED_ENV_NAMES = (
    "ALLOW_TG_E2E",
    "TELETHON_API_ID",
    "TELETHON_API_HASH",
    "TELETHON_SESSION_STRING",
    "TG_BOT_TOKEN",
    "OPERATOR_TOKEN",
)


class PendingRequestItem(TypedDict):
    opaque_id: str
    conversation_id: int
    internal_handle: str
    request_status: str
    created_at_utc: str
    updated_at_utc: str


class PendingRequestsResponse(TypedDict):
    items: list[PendingRequestItem]
    next_cursor: str | None


@dataclass(frozen=True, slots=True)
class TgE2EConfig:
    api_id: int
    api_hash: str
    session_string: str
    tg_bot_token: str
    operator_token: str
    operator_base_url: str
    bot_username: str | None
    timeout_seconds: float


def _env_value(name: str) -> str | None:
    value = os.environ.get(name)
    if value is None or value.strip() == "":
        return None
    return value.strip()


def _skip_reason_from_env() -> str | None:
    if _env_value("ALLOW_TG_E2E") != "true":
        return "Telegram E2E disabled; set ALLOW_TG_E2E=true for manual staging runs"

    missing = [name for name in REQUIRED_ENV_NAMES if _env_value(name) is None]
    if missing:
        names = ", ".join(missing)
        return f"Telegram E2E env is incomplete; missing required env names: {names}"

    api_id = _env_value("TELETHON_API_ID")
    if api_id is not None:
        try:
            int(api_id)
        except ValueError:
            return "Telegram E2E env is invalid; TELETHON_API_ID must be an integer"

    try:
        _timeout_seconds_from_env()
    except ValueError as exc:
        return f"Telegram E2E env is invalid; {exc}"

    operator_base_url = _env_value("TG_E2E_OPERATOR_BASE_URL") or STAGING_OPERATOR_BASE_URL
    parsed_operator_url = urlparse(operator_base_url)
    if parsed_operator_url.scheme != "https" or parsed_operator_url.hostname != "staging.open-care.org":
        return "Telegram E2E operator base URL must be https://staging.open-care.org"

    return None


def _fail_closed_reason_from_env() -> str | None:
    if _env_value("ALLOW_TG_E2E") != "true":
        return None

    return _skip_reason_from_env()


def _timeout_seconds_from_env() -> float:
    raw_timeout = _env_value("TG_E2E_TIMEOUT_SECONDS")
    if raw_timeout is None:
        return DEFAULT_TG_E2E_TIMEOUT_SECONDS

    try:
        timeout_seconds = float(raw_timeout)
    except ValueError as exc:
        raise ValueError("TG_E2E_TIMEOUT_SECONDS must be a finite positive number of seconds") from exc

    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise ValueError("TG_E2E_TIMEOUT_SECONDS must be a finite positive number of seconds")

    return timeout_seconds


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    reason = _skip_reason_from_env()
    if reason is None:
        return

    skip_marker = pytest.mark.skip(reason=reason)
    for item in items:
        item.add_marker(skip_marker)


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "tg_e2e: manual live Telegram staging E2E tests")
    fail_closed_reason = _fail_closed_reason_from_env()
    if fail_closed_reason is not None:
        pytest.exit(fail_closed_reason, returncode=2)


@pytest.fixture(scope="session")
def tg_e2e_config() -> TgE2EConfig:
    reason = _skip_reason_from_env()
    if reason is not None:
        pytest.skip(reason)

    api_id_value = _env_value("TELETHON_API_ID")
    api_hash = _env_value("TELETHON_API_HASH")
    session_string = _env_value("TELETHON_SESSION_STRING")
    tg_bot_token = _env_value("TG_BOT_TOKEN")
    operator_token = _env_value("OPERATOR_TOKEN")
    if (
        api_id_value is None
        or api_hash is None
        or session_string is None
        or tg_bot_token is None
        or operator_token is None
    ):
        pytest.fail("Telegram E2E env became incomplete during fixture setup", pytrace=False)
    assert api_id_value is not None
    assert api_hash is not None
    assert session_string is not None
    assert tg_bot_token is not None
    assert operator_token is not None

    return TgE2EConfig(
        api_id=int(api_id_value),
        api_hash=api_hash,
        session_string=session_string,
        tg_bot_token=tg_bot_token,
        operator_token=operator_token,
        operator_base_url=_env_value("TG_E2E_OPERATOR_BASE_URL") or STAGING_OPERATOR_BASE_URL,
        bot_username=_env_value("TG_E2E_BOT_USERNAME"),
        timeout_seconds=_timeout_seconds_from_env(),
    )


@pytest_asyncio.fixture(autouse=True)
async def rate_limit_between_cases() -> AsyncIterator[None]:
    yield
    if _skip_reason_from_env() is None:
        await asyncio.sleep(1)


@pytest_asyncio.fixture(scope="session")
async def http_client(tg_e2e_config: TgE2EConfig) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(timeout=tg_e2e_config.timeout_seconds) as client:
        yield client


@pytest_asyncio.fixture(scope="session")
async def telegram_client(tg_e2e_config: TgE2EConfig) -> AsyncIterator[TelegramClient]:
    from telethon import TelegramClient
    from telethon.sessions import StringSession

    client = TelegramClient(
        StringSession(tg_e2e_config.session_string),
        tg_e2e_config.api_id,
        tg_e2e_config.api_hash,
        sequential_updates=True,
    )
    try:
        await client.connect()
    except (OSError, ConnectionError):
        pytest.fail("Could not connect Telethon client to Telegram for staging E2E", pytrace=False)

    try:
        is_authorized = await client.is_user_authorized()
    except (OSError, ConnectionError):
        await client.disconnect()
        pytest.fail("Could not verify Telethon session authorization", pytrace=False)

    if not is_authorized:
        await client.disconnect()
        pytest.fail("Telethon session is not authorized; regenerate TELETHON_SESSION_STRING", pytrace=False)

    yield client
    await client.disconnect()


@pytest_asyncio.fixture(scope="session")
async def staging_bot_username(
    tg_e2e_config: TgE2EConfig,
    http_client: httpx.AsyncClient,
) -> str:
    if tg_e2e_config.bot_username is not None:
        return tg_e2e_config.bot_username.removeprefix("@")

    try:
        response = await http_client.get(f"https://api.telegram.org/bot{tg_e2e_config.tg_bot_token}/getMe")
    except httpx.HTTPError:
        pytest.fail("Could not reach Telegram Bot API getMe for staging bot resolution", pytrace=False)

    if response.status_code != 200:
        pytest.fail(
            f"Telegram Bot API getMe failed with HTTP {response.status_code}; check staging TG_BOT_TOKEN",
            pytrace=False,
        )

    raw_body: object = response.json()
    body = require_mapping(raw_body, "Telegram Bot API getMe response")
    result = body.get("result")
    result_map = require_mapping(result, "Telegram Bot API getMe result")
    username = result_map.get("username")
    if not isinstance(username, str) or username == "":
        pytest.fail("Telegram Bot API getMe did not return a bot username", pytrace=False)

    return username


@pytest.fixture
def unique_handle() -> str:
    alphabet = string.ascii_lowercase + string.digits
    suffix = "".join(secrets.choice(alphabet) for _ in range(6))
    timestamp = base36_timestamp()
    return f"e2e_{timestamp}_{suffix}"


def base36_timestamp() -> str:
    value = int(time.time())
    alphabet = string.digits + string.ascii_lowercase
    chars: list[str] = []
    while value > 0:
        value, remainder = divmod(value, 36)
        chars.append(alphabet[remainder])
    return "".join(reversed(chars)) or "0"


def make_test_code() -> str:
    middle = secrets.token_hex(4).upper()
    last4 = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(4))
    return f"OC-E2E-{middle}-{last4}"


async def send_bot_command(
    telegram_client: TelegramClient,
    staging_bot_username: str,
    command: str,
) -> Message:
    config = _config_from_env_for_helpers()
    async with telegram_client.conversation(
        staging_bot_username,
        timeout=config.timeout_seconds,
        exclusive=False,
    ) as conversation:
        sent = await conversation.send_message(command)
        try:
            return await conversation.get_response(sent)
        except TimeoutError:
            pytest.fail("Timed out waiting for a staging bot response", pytrace=False)


async def send_bot_command_allowing_no_response(
    telegram_client: TelegramClient,
    staging_bot_username: str,
    command: str,
    timeout_seconds: float | None = None,
) -> Message | None:
    config = _config_from_env_for_helpers()
    conversation_timeout_seconds = timeout_seconds if timeout_seconds is not None else config.timeout_seconds
    async with telegram_client.conversation(
        staging_bot_username,
        timeout=conversation_timeout_seconds,
        exclusive=False,
    ) as conversation:
        sent = await conversation.send_message(command)
        try:
            return await conversation.get_response(sent)
        except TimeoutError:
            return None


async def create_pending_card_request(
    telegram_client: TelegramClient,
    staging_bot_username: str,
    handle: str,
) -> PendingRequestItem:
    start_response = await send_bot_command(telegram_client, staging_bot_username, f"/start {handle}")
    assert_message_contains(start_response, f"@{handle}", "registration response did not include the requested handle")

    card_response = await send_bot_command(telegram_client, staging_bot_username, "/card")
    assert_message_contains(card_response, "request has been sent", "card response did not acknowledge the request")

    return await wait_for_pending_request(handle)


async def wait_for_pending_request(handle: str, timeout_seconds: float | None = None) -> PendingRequestItem:
    config = _config_from_env_for_helpers()
    wait_timeout_seconds = timeout_seconds if timeout_seconds is not None else config.timeout_seconds
    deadline = time.monotonic() + wait_timeout_seconds
    while time.monotonic() < deadline:
        response = await fetch_all_pending_requests()
        item = find_latest_pending_for_handle(response["items"], handle)
        if item is not None:
            return item
        await asyncio.sleep(1)
    pytest.fail("Timed out waiting for the card request to appear in the operator pending list", pytrace=False)


async def fetch_all_pending_requests(max_pages: int = 20) -> PendingRequestsResponse:
    items: list[PendingRequestItem] = []
    cursor: str | None = None

    for _ in range(max_pages):
        page = await fetch_pending_requests(cursor=cursor)
        items.extend(page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            return {"items": items, "next_cursor": None}

    return {"items": items, "next_cursor": cursor}


async def fetch_pending_requests(cursor: str | None = None) -> PendingRequestsResponse:
    raw_response = await fetch_pending_requests_raw(cursor=cursor)
    return parse_pending_requests(raw_response)


async def fetch_pending_requests_raw(cursor: str | None = None) -> object:
    config = _config_from_env_for_helpers()
    query = urlencode({"limit": "100", **({"cursor": cursor} if cursor is not None else {})})
    async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
        try:
            response = await client.get(
                f"{config.operator_base_url}/tg/internal/pending-requests?{query}",
                headers={"Authorization": f"Bearer {config.operator_token}"},
            )
        except httpx.HTTPError:
            pytest.fail("Could not reach staging operator pending-requests endpoint", pytrace=False)

    if response.status_code in {401, 403}:
        pytest.fail("Staging operator rejected OPERATOR_TOKEN for pending-requests", pytrace=False)
    if response.status_code != 200:
        pytest.fail(
            f"Staging operator pending-requests returned HTTP {response.status_code}",
            pytrace=False,
        )
    return response.json()


async def send_code_to_pending_request(pending_request: PendingRequestItem, code: str) -> None:
    config = _config_from_env_for_helpers()
    payload: dict[str, str | int] = {
        "opaque_id": pending_request["opaque_id"],
        "conversation_id": pending_request["conversation_id"],
        "code": code,
    }
    # public_beneficiary_ref is intentionally omitted. It is optional, and staging
    # has a known non-null ref delivery bug; these E2E tests only need the current
    # null/omitted-ref contract to close generated pending requests safely.
    async with httpx.AsyncClient(timeout=config.timeout_seconds) as client:
        try:
            response = await client.post(
                f"{config.operator_base_url}/tg/internal/send-code",
                headers={"Authorization": f"Bearer {config.operator_token}"},
                json=payload,
            )
        except httpx.HTTPError:
            pytest.fail("Could not reach staging operator send-code endpoint", pytrace=False)

    if response.status_code in {401, 403}:
        pytest.fail("Staging operator rejected OPERATOR_TOKEN for send-code", pytrace=False)
    if response.status_code != 200:
        safe_error = safe_error_code(response)
        pytest.fail(
            f"Staging operator send-code returned HTTP {response.status_code}{safe_error}",
            pytrace=False,
        )

    body = require_mapping(response.json(), "send-code response")
    delivered_at = body.get("delivered_at_utc")
    if not isinstance(delivered_at, str) or delivered_at == "":
        pytest.fail("send-code response did not include delivered_at_utc", pytrace=False)


def _config_from_env_for_helpers() -> TgE2EConfig:
    reason = _skip_reason_from_env()
    if reason is not None:
        pytest.skip(reason)

    api_id_value = _env_value("TELETHON_API_ID")
    api_hash = _env_value("TELETHON_API_HASH")
    session_string = _env_value("TELETHON_SESSION_STRING")
    tg_bot_token = _env_value("TG_BOT_TOKEN")
    operator_token = _env_value("OPERATOR_TOKEN")
    if (
        api_id_value is None
        or api_hash is None
        or session_string is None
        or tg_bot_token is None
        or operator_token is None
    ):
        pytest.skip("Telegram E2E env became incomplete during helper setup")
    return TgE2EConfig(
        api_id=int(api_id_value),
        api_hash=api_hash,
        session_string=session_string,
        tg_bot_token=tg_bot_token,
        operator_token=operator_token,
        operator_base_url=_env_value("TG_E2E_OPERATOR_BASE_URL") or STAGING_OPERATOR_BASE_URL,
        bot_username=_env_value("TG_E2E_BOT_USERNAME"),
        timeout_seconds=_timeout_seconds_from_env(),
    )


async def deliver_code_to_pending_request(
    telegram_client: TelegramClient,
    staging_bot_username: str,
    pending_request: PendingRequestItem,
    code: str,
    on_delivery_accepted: Callable[[], None] | None = None,
) -> Message:
    config = _config_from_env_for_helpers()
    async with telegram_client.conversation(
        staging_bot_username,
        timeout=config.timeout_seconds,
        exclusive=False,
    ) as conversation:
        await send_code_to_pending_request(pending_request, code)
        if on_delivery_accepted is not None:
            on_delivery_accepted()
        try:
            return await conversation.get_response()
        except TimeoutError:
            pytest.fail("Timed out waiting for the staging bot delivery message", pytrace=False)


async def close_pending_request_with_test_code(
    telegram_client: TelegramClient,
    staging_bot_username: str,
    pending_request: PendingRequestItem,
) -> None:
    cleanup_code = make_test_code()
    delivered_message = await deliver_code_to_pending_request(
        telegram_client,
        staging_bot_username,
        pending_request,
        cleanup_code,
    )
    assert_message_has_full_code(delivered_message, cleanup_code)


def parse_pending_requests(raw_response: object) -> PendingRequestsResponse:
    body = require_mapping(raw_response, "pending-requests response")
    raw_items = body.get("items")
    if not isinstance(raw_items, list):
        pytest.fail("pending-requests response items field was not a list", pytrace=False)

    items: list[PendingRequestItem] = []
    for raw_item in raw_items:
        item_map = require_mapping(raw_item, "pending-requests item")
        items.append(parse_pending_item(item_map))

    raw_cursor = body.get("next_cursor")
    if raw_cursor is not None and not isinstance(raw_cursor, str):
        pytest.fail("pending-requests next_cursor field was not null or string", pytrace=False)

    return {"items": items, "next_cursor": raw_cursor}


def parse_pending_item(item_map: Mapping[str, object]) -> PendingRequestItem:
    opaque_id = item_map.get("opaque_id")
    conversation_id = item_map.get("conversation_id")
    internal_handle = item_map.get("internal_handle")
    request_status = item_map.get("request_status")
    created_at_utc = item_map.get("created_at_utc")
    updated_at_utc = item_map.get("updated_at_utc")

    if not isinstance(opaque_id, str) or opaque_id == "":
        pytest.fail("pending-requests item had an invalid opaque_id", pytrace=False)
    if not isinstance(conversation_id, int) or conversation_id < 1:
        pytest.fail("pending-requests item had an invalid conversation_id", pytrace=False)
    if not isinstance(internal_handle, str) or internal_handle == "":
        pytest.fail("pending-requests item had an invalid internal_handle", pytrace=False)
    if request_status not in {"pending", "in_flight", "failed"}:
        pytest.fail("pending-requests item had an invalid request_status", pytrace=False)
    if not isinstance(created_at_utc, str) or created_at_utc == "":
        pytest.fail("pending-requests item had an invalid created_at_utc", pytrace=False)
    if not isinstance(updated_at_utc, str) or updated_at_utc == "":
        pytest.fail("pending-requests item had an invalid updated_at_utc", pytrace=False)

    return {
        "opaque_id": opaque_id,
        "conversation_id": conversation_id,
        "internal_handle": internal_handle,
        "request_status": request_status,
        "created_at_utc": created_at_utc,
        "updated_at_utc": updated_at_utc,
    }


def require_mapping(value: object, label: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        pytest.fail(f"{label} was not a JSON object", pytrace=False)
    return value


def find_latest_pending_for_handle(
    items: Iterable[PendingRequestItem],
    handle: str,
) -> PendingRequestItem | None:
    matching = [item for item in items if item["internal_handle"] == handle]
    if not matching:
        return None
    return max(matching, key=lambda item: item["conversation_id"])


def assert_request_no_longer_pending(items: Iterable[PendingRequestItem], pending_request: PendingRequestItem) -> None:
    if any(item["conversation_id"] == pending_request["conversation_id"] for item in items):
        pytest.fail("Delivered conversation still appeared in pending-requests", pytrace=False)


def message_text(message: Message) -> str:
    text = getattr(message, "text", None)
    if not isinstance(text, str):
        pytest.fail("Bot response did not contain text", pytrace=False)
    return text


def assert_message_contains(message: Message, expected_substring: str, failure_message: str) -> None:
    text = message_text(message)
    if expected_substring not in text:
        pytest.fail(failure_message, pytrace=False)


def assert_message_has_full_code(message: Message, code: str) -> None:
    text = message_text(message)
    if code not in text:
        pytest.fail("Delivery message did not include the generated test gift-card code", pytrace=False)


def assert_no_plaintext_identifiers(texts: Iterable[str], identifiers: Iterable[str]) -> None:
    for text in texts:
        for identifier in identifiers:
            if identifier != "" and identifier in text:
                pytest.fail("Bot response leaked a plaintext Telegram identifier", pytrace=False)


def assert_full_code_absent(value: object, code: str) -> None:
    if contains_string_value(value, code):
        pytest.fail("Operator pending-requests response exposed a full gift-card code", pytrace=False)


def assert_only_safe_code_fields(value: object) -> None:
    unsafe_fields = unsafe_code_fields(value)
    if unsafe_fields:
        pytest.fail("Operator pending-requests response exposed unsafe code-retention fields", pytrace=False)


def contains_string_value(value: object, needle: str) -> bool:
    if isinstance(value, str):
        return needle in value
    if isinstance(value, Mapping):
        return any(contains_string_value(nested, needle) for nested in value.values())
    if isinstance(value, list):
        return any(contains_string_value(nested, needle) for nested in value)
    return False


def unsafe_code_fields(value: object) -> set[str]:
    fields: set[str] = set()
    if isinstance(value, Mapping):
        for key, nested in value.items():
            if isinstance(key, str) and "code" in key.lower():
                fields.add(key)
            fields.update(unsafe_code_fields(nested))
    elif isinstance(value, list):
        for nested in value:
            fields.update(unsafe_code_fields(nested))
    return fields


def safe_error_code(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    error = body.get("error")
    if not isinstance(error, dict):
        return ""
    code = error.get("code")
    if not isinstance(code, str):
        return ""
    return f" ({code})"
