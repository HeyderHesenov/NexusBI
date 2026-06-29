"""Password hashing, JWT tokens, and connection-string encryption."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings
from app.core.exceptions import AuthError

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ─── Passwords ───
def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd_context.verify(plain, hashed)


# ─── JWT ───
def create_access_token(subject: str, extra: dict[str, Any] | None = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError as exc:
        raise AuthError("Token etibarsızdır və ya vaxtı bitib.") from exc


def create_refresh_token(user_id: str, jti: str, family_id: str) -> tuple[str, datetime]:
    """Mint a long-lived refresh token (claim type "rt"). Returns (token, expiry)."""
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    payload = {"sub": user_id, "rt": jti, "fam": family_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM), expire


def decode_refresh_token(token: str) -> dict[str, Any]:
    """Decode a refresh token, ensuring it actually carries the "rt" claim
    (so an access token can't be replayed at the refresh endpoint)."""
    payload = decode_access_token(token)
    if not payload.get("rt"):
        raise AuthError("Refresh token etibarsızdır.")
    return payload


def create_ws_ticket(user_id: str, dashboard_id: str, ttl_seconds: int = 60) -> str:
    """Short-lived, single-dashboard token for the collab WebSocket so the
    long-lived access token never appears in a WS URL (logs / browser history)."""
    expire = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    payload = {"sub": user_id, "ws": dashboard_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_embed_token(dashboard_id: str, ttl_days: int = 30) -> str:
    """Signed, read-only embed token for a single dashboard (no user identity)."""
    expire = datetime.now(timezone.utc) + timedelta(days=ttl_days)
    payload = {"emb": dashboard_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_embed_token(token: str) -> str:
    """Return the dashboard_id from a valid embed token, or raise AuthError."""
    payload = decode_access_token(token)
    dashboard_id = payload.get("emb")
    if not dashboard_id:
        raise AuthError("Embed token etibarsızdır.")
    return dashboard_id


# ─── Fernet encryption for connection strings ───
def _fernet() -> Fernet:
    key = settings.FERNET_KEY
    if not key:
        raise AuthError("FERNET_KEY konfiqurasiya olunmayıb.")
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise AuthError("Şifrəli dəyər oxunmadı.") from exc
