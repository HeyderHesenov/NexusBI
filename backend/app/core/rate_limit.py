"""Lightweight IP-based rate limiting for unauthenticated / public endpoints.

Sliding-window counter kept in process memory — adequate for the single-worker
demo deployment and a meaningful brute-force speed bump in any case. For a
multi-worker production deploy back this with Redis (shared `app.state.cache`)
so buckets are shared across workers and survive restarts.
Authenticated AI endpoints use the per-user monthly quota in `billing` instead.

Client-IP resolution honors `TRUSTED_PROXY_HOPS`: behind a reverse proxy the
direct peer is always the proxy, which would collapse every client into a single
bucket (breaking per-IP throttling and letting one abuser starve everyone). When
the real proxy count is configured we read the client's address from
`X-Forwarded-For`; with the default of 0 we never trust that header (a client
could otherwise spoof it) and fall back to the direct peer.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.config import settings
from app.core.exceptions import RateLimitError

# bucket -> ip -> deque[timestamps]
_HITS: dict[str, dict[str, deque[float]]] = defaultdict(lambda: defaultdict(deque))

# Cap distinct IPs tracked per bucket; beyond it we sweep idle entries so a flood
# of unique source IPs can't grow the map without bound (memory-exhaustion DoS).
_MAX_IPS_PER_BUCKET = 4096


def _direct_peer(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _client_ip(request: Request) -> str:
    """Client IP used as the rate-limit key.

    With ``TRUSTED_PROXY_HOPS = N`` (N > 0), the client sits behind N reverse
    proxies, each of which appends exactly one entry to ``X-Forwarded-For``. The
    real client is therefore the Nth entry counted from the right — anything a
    client injects lands further left and is ignored. With N = 0 (default) the
    header is never trusted and we use the direct peer.
    """
    hops = settings.TRUSTED_PROXY_HOPS
    if hops > 0:
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(parts) >= hops:
            return parts[-hops]
    return _direct_peer(request)


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
