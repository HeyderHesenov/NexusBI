"""SQLAlchemy models. Importing registers them on the Base metadata."""
from app.db.base import Base
from app.models.alert import Alert, Notification
from app.models.ba_artifact import BAArtifact
from app.models.brand import BrandConfig
from app.models.chat import Channel, ChatMessage, ChatReadMarker
from app.models.comment import DashboardComment
from app.models.dashboard import Dashboard, Widget
from app.models.dashboard_snapshot import DashboardSnapshot
from app.models.data_contract import ContractRun, DataContract
from app.models.datasource import DataSource, DBType
from app.models.decision import Decision, DecisionMeasurement
from app.models.graph_view import GraphView
from app.models.integration import IntegrationChannel
from app.models.query_embedding import QueryEmbedding
from app.models.kpi_target import KPITarget
from app.models.metric import Metric
from app.models.ml_model import MLModel
from app.models.metric_node import MetricNode
from app.models.query_log import QueryLog
from app.models.refresh_token import RefreshToken
from app.models.requirement import RequirementDoc
from app.models.report_subscription import ReportSubscription
from app.models.saved_query import SavedQuery
from app.models.user import User
from app.models.workspace import (
    AuditLog,
    RLSRule,
    Workspace,
    WorkspaceMember,
    WorkspaceResource,
)

__all__ = [
    "Base",
    "User",
    "DataSource",
    "DBType",
    "QueryLog",
    "RefreshToken",
    "Dashboard",
    "DashboardSnapshot",
    "Widget",
    "SavedQuery",
    "ReportSubscription",
    "Metric",
    "MetricNode",
    "Alert",
    "Notification",
    "DashboardComment",
    "Decision",
    "DecisionMeasurement",
    "GraphView",
    "QueryEmbedding",
    "RequirementDoc",
    "KPITarget",
    "IntegrationChannel",
    "BrandConfig",
    "Workspace",
    "WorkspaceMember",
    "WorkspaceResource",
    "RLSRule",
    "AuditLog",
    "DataContract",
    "ContractRun",
    "BAArtifact",
    "MLModel",
    "Channel",
    "ChatMessage",
    "ChatReadMarker",
]
