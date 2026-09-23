from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app import create_app
from app.extensions import db
from app.models import UTCDateTime

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

app = create_app()
DB_URL = app.config["SQLALCHEMY_DATABASE_URI"]
target_metadata = db.metadata


def render_item(type_, obj, autogen_context):
    # keep migrations free of app imports: our UTC TypeDecorator is a plain timestamptz column
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False


def run_migrations_offline() -> None:
    context.configure(url=DB_URL, target_metadata=target_metadata, literal_binds=True, render_item=render_item)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(DB_URL)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, render_item=render_item, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
