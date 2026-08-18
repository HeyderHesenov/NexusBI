"""Verify a Stripe webhook signature without the Stripe SDK.

The scheme is small and fully specified, and doing it here keeps `stripe` an
OPTIONAL dependency (it is imported only inside the checkout/portal endpoints)
while letting the tests build real signatures instead of mocking a library:

    Stripe-Signature: t=<unix>,v1=<hex hmac>[,v1=<hex hmac>…]
    digest = HMAC-SHA256(f"{t}.{raw body}", endpoint secret)

`automl_service.py:58-74` already signs artefacts with HMAC-SHA256 and
`hmac.compare_digest`, so this is the house idiom rather than a new one.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import time

# Stripe's own libraries default to five minutes. Both sides matter: a window
# that only bounds the past accepts a signature minted with a far-future `t`,
# which is a replay token with an expiry date the attacker chooses.
TOLERANCE_SECONDS = 300

# A v1 candidate is a SHA-256 digest in hex and nothing else. Checked before the
# comparison, because `hmac.compare_digest` RAISES TypeError on a non-ASCII str
# — on an unauthenticated endpoint that turns a mangled header into a 500 and,
# for a real delivery, into three days of Stripe retrying an error we caused.
_HEX_DIGEST = re.compile(r"\A[0-9a-fA-F]{64}\Z")


class SignatureError(Exception):
    """The request did not prove it came from Stripe. Never process it."""


def _parse(header: str) -> tuple[int, list[str]]:
    timestamp: int | None = None
    candidates: list[str] = []
    for part in (header or "").split(","):
        key, _, value = part.strip().partition("=")
        if not value:
            continue
        if key == "t":
            try:
                timestamp = int(value)
            except ValueError as exc:
                raise SignatureError("Stripe imzasında vaxt damğası oxunmadı.") from exc
        elif key == "v1":
            # v1 only. v0 exists but is Stripe's test-mode scheme and is NOT
            # derived from the endpoint secret, so treating it as a fallback
            # would accept a value this secret never authenticated.
            candidates.append(value)
    if timestamp is None or not candidates:
        raise SignatureError("Stripe imzası tam deyil.")
    return timestamp, candidates


def verify(raw_body: bytes, header: str, secret: str, *, now: float | None = None) -> None:
    """Raise `SignatureError` unless `raw_body` was signed by `secret`.

    `raw_body` must be the bytes as received. Re-serializing the parsed JSON
    changes key order and whitespace, and the digest is over bytes.
    """
    if not secret:
        # Refuse loudly. A missing secret is the one configuration mistake that
        # would otherwise turn this endpoint into "anyone may grant themselves a
        # paid plan", so it must never degrade into acceptance.
        raise SignatureError("Stripe webhook konfiqurasiya olunmayıb.")

    timestamp, candidates = _parse(header)
    age = (time.time() if now is None else now) - timestamp
    if abs(age) > TOLERANCE_SECONDS:
        raise SignatureError("Stripe hadisəsi çox köhnə və ya gələcəkdəndir.")

    expected = hmac.new(
        secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    # compare_digest over every candidate: during a secret rotation Stripe signs
    # one delivery with each active endpoint secret.
    if not any(_HEX_DIGEST.match(c) and hmac.compare_digest(expected, c) for c in candidates):
        raise SignatureError("Stripe imzası uyğun gəlmir.")
