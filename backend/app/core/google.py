"""Google Sign-In: verify a GIS ID token and extract the profile."""
from __future__ import annotations

from typing import Any

from app.config import settings
from app.core.exceptions import AuthError

_ALLOWED_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


def google_enabled() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID)


def verify_google_token(credential: str) -> dict[str, Any]:
    """Validate a Google ID token and return {email, name, sub}.

    Raises AuthError if Google login is not configured or the token is invalid.
    """
    if not google_enabled():
        raise AuthError("Google girişi konfiqurasiya olunmayıb.")

    # Imported lazily so the dependency is only needed when the feature is used.
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError as exc:  # pragma: no cover - deploy misconfiguration
        raise AuthError("Google auth kitabxanası quraşdırılmayıb.", detail=str(exc)) from exc

    try:
        claims = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            settings.GOOGLE_CLIENT_ID,
        )
    except ValueError as exc:
        raise AuthError("Google token etibarsızdır.", detail=str(exc)) from exc

    if claims.get("iss") not in _ALLOWED_ISSUERS:
        raise AuthError("Google token issuer-i etibarsızdır.")
    if not claims.get("email"):
        raise AuthError("Google hesabında email yoxdur.")
    # Reject unverified emails — otherwise an unverified Google account whose
    # address matches an existing user could take over that account.
    if claims.get("email_verified") not in (True, "true"):
        raise AuthError("Google email-i təsdiqlənməyib.")

    return {
        "email": claims["email"],
        "name": claims.get("name", ""),
        "sub": claims.get("sub", ""),
    }
