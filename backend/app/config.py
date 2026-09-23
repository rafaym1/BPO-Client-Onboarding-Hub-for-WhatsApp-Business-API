import os

from dotenv import find_dotenv, load_dotenv

# local runs (no docker): pick up the project's .env; real environment variables always win
load_dotenv(find_dotenv(usecwd=True))


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _mock_flag(name: str, has_credentials: bool) -> bool:
    """MOCK_<SERVICE>=true|false forces a mode; 'auto' (default) mocks when credentials are missing."""
    value = os.getenv(name, "auto").strip().lower()
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    return not has_credentials


def _database_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///bpo.db")
    prefix = "sqlite:///"
    if url.startswith(prefix) and not url.startswith(prefix + "/") and ":memory:" not in url:
        # Flask-SQLAlchemy would put a relative path in instance/ while Alembic uses the cwd; make it absolute
        url = prefix + os.path.abspath(url[len(prefix):]).replace("\\", "/")
    return url


def load_config() -> dict:
    whatsapp_token = os.getenv("WHATSAPP_TOKEN", "")
    hubspot_token = os.getenv("HUBSPOT_TOKEN", "")
    jira_email = os.getenv("JIRA_EMAIL", "")
    jira_token = os.getenv("JIRA_API_TOKEN", "")
    jira_domain = os.getenv("JIRA_DOMAIN", "")

    return {
        "SQLALCHEMY_DATABASE_URI": _database_url(),
        "SQLALCHEMY_ENGINE_OPTIONS": {"pool_pre_ping": True},
        "REDIS_URL": os.getenv("REDIS_URL", "redis://localhost:6379/0"),
        "CELERY_EAGER": _bool("CELERY_EAGER", False),
        "CORS_ORIGINS": [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()],
        "DEV_TOOLS": _bool("DEV_TOOLS", True),
        "MOCK_DATA_DIR": os.getenv("MOCK_DATA_DIR", "./.mock_data"),
        "CLINIC_TIMEZONE": os.getenv("CLINIC_TIMEZONE", "Europe/Berlin"),
        "DEFAULT_TEMPLATE_LANGUAGE": os.getenv("DEFAULT_TEMPLATE_LANGUAGE", "en_GB"),
        # WhatsApp Cloud API
        "WHATSAPP_TOKEN": whatsapp_token,
        "WHATSAPP_APP_SECRET": os.getenv("WHATSAPP_APP_SECRET", ""),
        "VERIFY_TOKEN": os.getenv("VERIFY_TOKEN", "bpo-verify-token"),
        "PHONE_NUMBER_ID": os.getenv("PHONE_NUMBER_ID", ""),
        "WABA_ID": os.getenv("WABA_ID", ""),
        "GRAPH_API_BASE": os.getenv("GRAPH_API_BASE", "https://graph.facebook.com/v20.0"),
        "MOCK_WHATSAPP": _mock_flag("MOCK_WHATSAPP", bool(whatsapp_token)),
        "MOCK_TEMPLATE_REVIEW_SECONDS": int(os.getenv("MOCK_TEMPLATE_REVIEW_SECONDS", "5")),
        # HubSpot
        "HUBSPOT_TOKEN": hubspot_token,
        "HUBSPOT_OPTIN_PROPERTY": os.getenv("HUBSPOT_OPTIN_PROPERTY", ""),
        "MOCK_HUBSPOT": _mock_flag("MOCK_HUBSPOT", bool(hubspot_token)),
        # Jira
        "JIRA_EMAIL": jira_email,
        "JIRA_API_TOKEN": jira_token,
        "JIRA_DOMAIN": jira_domain,
        "JIRA_PROJECT_KEY": os.getenv("JIRA_PROJECT_KEY", "BPO"),
        "JIRA_TASK_ISSUE_TYPE": os.getenv("JIRA_TASK_ISSUE_TYPE", "Task"),
        "MOCK_JIRA": _mock_flag("MOCK_JIRA", bool(jira_email and jira_token and jira_domain)),
    }
