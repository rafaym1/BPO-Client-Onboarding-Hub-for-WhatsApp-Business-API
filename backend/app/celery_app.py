"""Celery entrypoint:  celery -A app.celery_app.celery worker -B -l info"""
from . import create_app
from .extensions import celery

flask_app = create_app()

__all__ = ["celery", "flask_app"]
