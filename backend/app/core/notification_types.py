"""Notification category — single source of truth.

A real `category` column on Notification replaces the old, fragile habit of
inferring kind from the title's text prefix (a shared warning-style prefix was used by both
AI-quality and decision-regression notifications, so prefix matching was ambiguous).
"""
from __future__ import annotations


class NotificationCategory:
    DIGEST = "digest"          # morning brief
    KPI_ALERT = "kpi_alert"    # saved-query threshold breach
    AI_QUALITY = "ai_quality"  # AI drift / eval accuracy drop
    INSIGHT = "insight"        # smart insight
    DECISION = "decision"      # decision impact (achieved / regressed)
    MENTION = "mention"        # @mention in a dashboard comment
