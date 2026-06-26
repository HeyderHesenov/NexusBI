"""SSRF guard for user-supplied datasource connection strings.

A user can register a datasource by giving a SQLAlchemy URL. Without validation
they could point the server at internal hosts (databases on localhost, the cloud
metadata endpoint 169.254.169.254, other tenants on the private network). This
module rejects any host that resolves to a private / loopback / link-local /
reserved address. File-backed SQLite URLs (no network host) are always allowed.
"""
from __future__ import annotations

import ipaddress
import socket

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

from app.core.exceptions import DataSourceConnectionError


def _ip_blocked(ip: str) -> bool:
    try:
        obj = ipaddress.ip_address(ip)
    except ValueError:
        return True  # unparseable — fail closed
    return (
        obj.is_private
        or obj.is_loopback
        or obj.is_link_local  # includes 169.254.0.0/16 cloud metadata
        or obj.is_reserved
        or obj.is_multicast
        or obj.is_unspecified
    )


def _assert_public_host(host: str) -> None:
    if not host:
        raise DataSourceConnectionError("Bağlantı host-u yoxdur.")
    # A bare IP literal: check directly. A hostname: check every resolved address.
    try:
        ipaddress.ip_address(host)
        candidates = [host]
    except ValueError:
        try:
            candidates = [info[4][0] for info in socket.getaddrinfo(host, None)]
        except socket.gaierror as exc:
            raise DataSourceConnectionError(
                "Host həll olunmadı.", detail=str(exc)
            ) from exc
    blocked = [ip for ip in candidates if _ip_blocked(ip)]
    if blocked:
        raise DataSourceConnectionError(
            "Daxili/qadağan olunmuş ünvana bağlantı qadağandır (SSRF qoruması)."
        )


def assert_safe_connection_string(connection_string: str) -> None:
    """Raise DataSourceConnectionError if the URL targets a non-public host.

    Called at datasource-create time and again at connect time (defense in depth,
    narrowing the DNS-rebinding window). SQLite URLs have no host → allowed.
    """
    try:
        url = make_url(connection_string)
    except ArgumentError as exc:
        raise DataSourceConnectionError(
            "Bağlantı sətri etibarsızdır.", detail=str(exc)
        ) from exc
    if url.get_backend_name() == "sqlite":
        return
    _assert_public_host(url.host or "")
