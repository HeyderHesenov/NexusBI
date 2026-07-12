"""add team chat: workspace channels + DM messages + read markers

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-07-12 17:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: str | None = 'c2d3e4f5a6b7'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        'channels',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('workspace_id', sa.String(length=36), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('created_by', sa.String(length=36), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('workspace_id', 'name', name='uq_channel_name'),
    )
    op.create_index('ix_channels_workspace_id', 'channels', ['workspace_id'])

    op.create_table(
        'chat_messages',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('room_key', sa.String(length=120), nullable=False),
        sa.Column('author_id', sa.String(length=36), nullable=False),
        sa.Column('author_name', sa.String(length=120), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['author_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_chat_messages_room_key', 'chat_messages', ['room_key'])
    op.create_index('ix_chat_messages_author_id', 'chat_messages', ['author_id'])
    op.create_index('ix_chat_messages_room_created', 'chat_messages', ['room_key', 'created_at'])

    op.create_table(
        'chat_read_markers',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('room_key', sa.String(length=120), nullable=False),
        sa.Column('last_read_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'room_key', name='uq_read_marker'),
    )
    op.create_index('ix_chat_read_markers_user_id', 'chat_read_markers', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_chat_read_markers_user_id', table_name='chat_read_markers')
    op.drop_table('chat_read_markers')
    op.drop_index('ix_chat_messages_room_created', table_name='chat_messages')
    op.drop_index('ix_chat_messages_author_id', table_name='chat_messages')
    op.drop_index('ix_chat_messages_room_key', table_name='chat_messages')
    op.drop_table('chat_messages')
    op.drop_index('ix_channels_workspace_id', table_name='channels')
    op.drop_table('channels')
