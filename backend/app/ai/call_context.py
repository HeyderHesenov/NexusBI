"""How many completions the request currently being served has made.

Quota used to cost one unit per HTTP request, which made /dashboard/generate —
a planner plus six questions at three completions each — as cheap as asking a
single question. Counting here, at the one place every completion passes
through, is what makes the charge proportional to what was actually spent.

The context variable holds a *mutable* counter rather than an int, and ``bump``
mutates it instead of rebinding the variable. That distinction is the whole
design: ``asyncio.gather`` wraps each coroutine in a Task, and a Task runs in a
*copy* of the context, so a ``ContextVar.set()`` inside one is invisible to the
parent. Both of the fan-out paths this exists to charge for run that way —
``query_service`` gathers chart selection and insight generation, and
``dashboard_service`` gathers per question — so with an int the counter would
have read 1 where the truth was 3, or 19. Sharing one object across the copies
is what makes the bumps land where the reconciliation can see them.

No active counter means no request is being charged — a scheduler digest or an
alert evaluation. ``bump`` is then a no-op, deliberately: that work is billed to
the operator in ``ai_spend_daily`` but belongs to no user's quota.

Embeddings are not counted either: at $0.02 per 1M tokens against a completion's
$2.50 they are rounding error, and charging a full unit for one would bill a
three-completion question as five.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar, Token

from sqlalchemy.ext.asyncio import AsyncSession


class _Counter:
    """One request's completion tally. Mutated in place; see the module docstring."""

    __slots__ = ("completions",)

    def __init__(self) -> None:
        self.completions = 0


_active: ContextVar[_Counter | None] = ContextVar("ai_call_counter", default=None)


def begin() -> Token[_Counter | None]:
    """Start counting for one request. Pass the token back to `end`."""
    return _active.set(_Counter())


def bump() -> None:
    counter = _active.get()
    if counter is not None:
        counter.completions += 1


def count() -> int:
    counter = _active.get()
    return counter.completions if counter is not None else 0


def end(token: Token[_Counter | None]) -> None:
    _active.reset(token)


@asynccontextmanager
async def charged(user_id: str, db: AsyncSession | None = None) -> AsyncIterator[None]:
    """Count the completions made in this block and bill the ones past the first.

    For the fan-out paths that take their quota unit by hand instead of through
    ``dependencies.enforce_rate_limit`` — the copilot endpoint and the chat plan
    executor. Both already consumed one unit before entering, which is why the
    charge is ``count - 1``; the block is otherwise charged twice for its first
    call. The charge is made even if the block raises — those calls happened —
    and lands in ``db`` when given one, for the locking reason spelled out in
    ``usage_service.consume_extra``.
    """
    from app.billing import usage_service

    token = begin()
    try:
        yield
    finally:
        extra = max(0, count() - 1)
        end(token)
        if extra:
            await usage_service.consume_extra(user_id, extra, db)
