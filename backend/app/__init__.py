import logging

from flask import Flask
from flask_cors import CORS

from .config import load_config
from .errors import register_error_handlers
from .extensions import db, init_celery


def create_app(overrides: dict | None = None) -> Flask:
    app = Flask(__name__)
    app.url_map.strict_slashes = False
    app.config.update(load_config())
    if overrides:
        app.config.update(overrides)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    db.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})
    init_celery(app)

    from .routes import register_blueprints

    register_blueprints(app)
    register_error_handlers(app)

    from . import tasks  # noqa: F401  (registers Celery tasks so enqueue-by-name works in web and worker)

    return app
