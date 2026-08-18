"""The signature IS the authentication for /billing/webhook.

Every test here builds a real `Stripe-Signature` header the way Stripe does, so
the verifier is exercised against the actual scheme rather than against a mock of
it: HMAC-SHA256 over `f"{timestamp}.{raw_body}"`, hex-encoded, compared in
constant time, inside a replay window.
"""
from __future__ import annotations

import hashlib
import hmac
import time

import pytest

from app.billing.stripe_signature import SignatureError, verify

SECRET = "whsec_test_secret"
BODY = b'{"id":"evt_1","type":"checkout.session.completed"}'


def sign(body: bytes, secret: str = SECRET, timestamp: int | None = None) -> str:
    ts = int(time.time()) if timestamp is None else timestamp
    mac = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={mac}"


def test_a_signature_stripe_would_send_is_accepted():
    verify(BODY, sign(BODY), SECRET)  # does not raise


def test_the_signature_covers_the_body():
    header = sign(BODY)
    with pytest.raises(SignatureError):
        verify(BODY + b" ", header, SECRET)


def test_a_different_secret_is_rejected():
    with pytest.raises(SignatureError):
        verify(BODY, sign(BODY, secret="whsec_someone_elses"), SECRET)


def test_the_timestamp_is_part_of_what_is_signed():
    """Not merely present in the header — INSIDE the digest.

    A verifier that checks the age of `t` but hashes only the body would accept a
    captured request forever, one edited timestamp at a time.

    The assertion is a signature over the body ALONE, with a positive control on
    the next line. "Move `t` and expect a rejection" reads like the same test but
    is satisfied by ANY broken digest — it passed against a verifier that hashed
    the body only, because there the honest signature stopped matching too.
    """
    ts = int(time.time())
    body_only = hmac.new(SECRET.encode(), BODY, hashlib.sha256).hexdigest()
    with pytest.raises(SignatureError):
        verify(BODY, f"t={ts},v1={body_only}", SECRET)
    verify(BODY, sign(BODY, timestamp=ts), SECRET)  # control: the real scheme still passes

    # And `t` is bound to the digest, not merely adjacent to it.
    header = sign(BODY, timestamp=ts)
    with pytest.raises(SignatureError):
        verify(BODY, header.replace(f"t={ts}", f"t={ts - 1}"), SECRET)


def test_an_old_delivery_is_refused():
    with pytest.raises(SignatureError, match="köhnə"):
        verify(BODY, sign(BODY, timestamp=int(time.time()) - 301), SECRET)


def test_a_delivery_inside_the_window_is_accepted():
    verify(BODY, sign(BODY, timestamp=int(time.time()) - 299), SECRET)


def test_a_timestamp_from_the_future_is_refused():
    """Clock skew forgives seconds, not hours — otherwise the window is one-sided
    and a signature can be minted to expire whenever the attacker likes."""
    with pytest.raises(SignatureError):
        verify(BODY, sign(BODY, timestamp=int(time.time()) + 301), SECRET)


def test_during_a_secret_rotation_any_candidate_may_match():
    """Stripe sends one v1 per active endpoint secret while both are live."""
    ts = int(time.time())
    good = sign(BODY, timestamp=ts).split("v1=")[1]
    header = f"t={ts},v1={'0' * 64},v1={good}"
    verify(BODY, header, SECRET)


def test_a_candidate_of_the_wrong_length_does_not_crash_the_compare():
    ts = int(time.time())
    with pytest.raises(SignatureError):
        verify(BODY, f"t={ts},v1=abc", SECRET)


@pytest.mark.parametrize(
    "header",
    ["", "t=", "v1=deadbeef", "t=notanumber,v1=deadbeef", "garbage", "t=1,v1=", "t=1"],
)
def test_a_malformed_header_is_refused_not_parsed_optimistically(header):
    with pytest.raises(SignatureError):
        verify(BODY, header, SECRET)


def test_an_unset_secret_is_refused_rather_than_defaulted():
    """The one failure mode that would accept ANY event: no secret configured."""
    with pytest.raises(SignatureError, match="konfiqurasiya"):
        verify(BODY, sign(BODY), "")


def test_unknown_scheme_versions_are_ignored_but_do_not_substitute_for_v1():
    """v0 is Stripe's test-mode-only scheme; accepting it would accept a value
    the endpoint secret never authenticated."""
    ts = int(time.time())
    v0 = hmac.new(SECRET.encode(), f"{ts}.".encode() + BODY, hashlib.sha256).hexdigest()
    with pytest.raises(SignatureError):
        verify(BODY, f"t={ts},v0={v0}", SECRET)
