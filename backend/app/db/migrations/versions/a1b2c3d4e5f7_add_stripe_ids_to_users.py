"""add users.stripe_customer_id / stripe_subscription_id

Revision ID: a1b2c3d4e5f7
Revises: f9a0b1c2d3e4
Create Date: 2026-08-18 19:40:00.000000

Both are nullable and indexed. The customer is looked up by
`invoice.payment_failed`, which identifies the user by nothing else, and the
subscription is the match key that stops a stale cancellation from downgrading
someone who has just paid.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f7'
down_revision: str | None = 'f9a0b1c2d3e4'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('stripe_customer_id', sa.String(length=64), nullable=True))
        batch_op.add_column(
            sa.Column('stripe_subscription_id', sa.String(length=64), nullable=True)
        )
        batch_op.create_index(
            batch_op.f('ix_users_stripe_customer_id'), ['stripe_customer_id'], unique=False
        )
        batch_op.create_index(
            batch_op.f('ix_users_stripe_subscription_id'), ['stripe_subscription_id'], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_stripe_subscription_id'))
        batch_op.drop_index(batch_op.f('ix_users_stripe_customer_id'))
        batch_op.drop_column('stripe_subscription_id')
        batch_op.drop_column('stripe_customer_id')
