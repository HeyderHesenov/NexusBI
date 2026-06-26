"""Azure AD (Entra ID) token acquisition for the Power BI REST API.

Client-credentials (service principal) flow. Only used when POWERBI_* settings
are configured; the mock provider needs none of this. Tokens are cached in
process until shortly before expiry.
"""
from __future__ import annotations

import time

import httpx

from app.config import settings
from app.core.exceptions import DataSourceConnectionError

_SCOPE = "https://analysis.windows.net/powerbi/api/.default"
_token: str | None = None
_expires_at: float = 0.0


async def get_access_token() -> str:
    """Return a cached bearer token, fetching a fresh one when near expiry."""
    global _token, _expires_at
    if _token and time.time() < _expires_at - 60:
        return _token

    url = f"https://login.microsoftonline.com/{settings.POWERBI_TENANT_ID}/oauth2/v2.0/token"
    data = {
        "client_id": settings.POWERBI_CLIENT_ID,
        "client_secret": settings.POWERBI_CLIENT_SECRET,
        "grant_type": "client_credentials",
        "scope": _SCOPE,
    }
    async with httpx.AsyncClient(timeout=30.0) as http:
        resp = await http.post(url, data=data)
    if resp.status_code != 200:
        raise DataSourceConnectionError(
            "Power BI üçün Azure AD token alınmadı.", detail=resp.text[:200]
        )
    payload = resp.json()
    _token = payload["access_token"]
    _expires_at = time.time() + int(payload.get("expires_in", 3600))
    return _token
