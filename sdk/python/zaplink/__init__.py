"""
ZapLink Python SDK.

Official client library for the ZapLink WhatsApp API Gateway.

Example usage::

    from zaplink import ZapLinkClient

    client = ZapLinkClient(
        base_url="http://localhost:2785",
        api_key="owa_k1_…",
    )

    # Sessions are addressed by the UUID that create() returns, not by name.
    session = client.sessions.create({"name": "my-session"})
    client.sessions.start(session["id"])
    # Link the account before sending: scan sessions.get_qr_code (or use sessions.request_pairing_code for a number with no linked session),
    # then wait for status "ready". An unlinked session answers the send with 409.
    result = client.messages.send_text(session["id"], {
        "chatId": "628123456789@c.us",
        "text": "Hello from the ZapLink Python SDK!",
    })
    print(result["messageId"])
"""

from __future__ import annotations

from .client import ZapLinkClient
from .errors import (
    ZapLinkApiError,
    ZapLinkAuthError,
    ZapLinkConflictError,
    ZapLinkError,
    ZapLinkForbiddenError,
    ZapLinkNotFoundError,
    ZapLinkNotImplementedError,
    ZapLinkServiceUnavailableError,
    ZapLinkRateLimitError,
    ZapLinkTimeoutError,
)
from .webhook import verify_webhook_signature

__all__ = [
    "ZapLinkClient",
    "ZapLinkError",
    "ZapLinkApiError",
    "ZapLinkAuthError",
    "ZapLinkForbiddenError",
    "ZapLinkNotFoundError",
    "ZapLinkConflictError",
    "ZapLinkRateLimitError",
    "ZapLinkNotImplementedError",
    "ZapLinkServiceUnavailableError",
    "ZapLinkTimeoutError",
    "verify_webhook_signature",
]
