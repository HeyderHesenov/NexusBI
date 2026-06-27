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


def create_ws_ticket(user_id: str, dashboard_id: str, ttl_seconds: int = 60) -> str:
    """Short-lived, single-dashboard token for the collab WebSocket so the
    long-lived access token never appears in a WS URL (logs / browser history)."""
    expire = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    payload = {"sub": user_id, "ws": dashboard_id, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


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
