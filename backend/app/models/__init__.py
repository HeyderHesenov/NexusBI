"""SQLAlchemy models. Importing registers them on the Base metadata."""
from app.db.base import Base
from app.models.alert import Alert, Notification
from app.models.brand import BrandConfig
from app.models.comment import DashboardComment
from app.models.dashboard import Dashboard, Widget
from app.models.datasource import DataSource, DBType
from app.models.decision import Decision
from app.models.integration import IntegrationChannel
from app.models.kpi_target import KPITarget
from app.models.metric import Metric
from app.models.query_log import QueryLog
from app.models.requirement import RequirementDoc
from app.models.saved_query import SavedQuery
from app.models.user import User
from app.models.workspace import AuditLog, RLSRule, Workspace, WorkspaceMember

__all__ = [
    "Base",
    "User",
    "DataSource",
    "DBType",
    "QueryLog",
    "Dashboard",
    "Widget",
    "SavedQuery",
    "Metric",
    "Alert",
    "Notification",
    "DashboardComment",
    "Decision",
    "RequirementDoc",
    "KPITarget",
    "IntegrationChannel",
    "BrandConfig",
    "Workspace",
    "WorkspaceMember",
    "RLSRule",
    "AuditLog",
]
