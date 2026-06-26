"""Lightweight IP-based rate limiting for unauthenticated / public endpoints.

Sliding-window counter kept in process memory — adequate for the single-worker
demo deployment and a meaningful brute-force speed bump in any case. For a
multi-worker production deploy back this with Redis (shared `app.state.cache`).
Authenticated AI endpoints use the per-user monthly quota in `billing` instead.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.exceptions import RateLimitError

# bucket -> ip -> deque[timestamps]
_HITS: dict[str, dict[str, deque[float]]] = defaultdict(lambda: defaultdict(deque))

# Cap distinct IPs tracked per bucket; beyond it we sweep idle entries so a flood
# of unique source IPs can't grow the map without bound (memory-exhaustion DoS).
_MAX_IPS_PER_BUCKET = 4096


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _prune(bucket_map: dict[str, deque[float]], cutoff: float) -> None:
    """Drop IP entries whose most recent hit is older than the window."""
    stale = [ip for ip, hits in bucket_map.items() if not hits or hits[-1] < cutoff]
    for ip in stale:
        del bucket_map[ip]


def _allow(bucket: str, ip: str, limit: int, window_seconds: int) -> bool:
    """Core sliding-window check. True if allowed (and records the hit)."""
    now = time.monotonic()
    cutoff = now - window_seconds
    bucket_map = _HITS[bucket]
    if len(bucket_map) > _MAX_IPS_PER_BUCKET:
        _prune(bucket_map, cutoff)
    hits = bucket_map[ip]
    while hits and hits[0] < cutoff:
        hits.popleft()
    if len(hits) >= limit:
        return False
    hits.append(now)
    return True


def rate_limit(bucket: str, limit: int, window_seconds: int):
    """Return a FastAPI dependency enforcing `limit` requests per window per IP."""

    def _dep(request: Request) -> None:
        if not _allow(bucket, _client_ip(request), limit, window_seconds):
            raise RateLimitError(
                "Çox sayda cəhd. Bir az sonra yenidən yoxlayın.",
                detail=f"limit={limit}/{window_seconds}s",
            )

    return _dep


def check_ip(bucket: str, ip: str, limit: int, window_seconds: int) -> bool:
    """Non-dependency variant for WebSocket / manual call sites.

    Returns True if allowed, False if the IP is over the limit.
    """
    return _allow(bucket, ip, limit, window_seconds)
