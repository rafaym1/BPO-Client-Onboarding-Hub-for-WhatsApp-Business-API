import logging

from celery import Celery
from flask import current_app, has_app_context
from flask_sqlalchemy import SQLAlchemy

log = logging.getLogger(__name__)

db = SQLAlchemy()
celery = Celery("bpo")


def init_celery(app):
    celery.conf.update(
        broker_url=app.config["REDIS_URL"],
        result_backend=app.config["REDIS_URL"],
        task_ignore_result=True,
        timezone="UTC",
        enable_utc=True,
        imports=("app.tasks",),
        broker_connection_retry_on_startup=True,
        beat_schedule={
            "send-24h-appointment-reminders": {
                "task": "appointments.sweep_due_reminders",
                "schedule": 3600.0,  # every hour
            },
        },
    )

    class ContextTask(celery.Task):
        def __call__(self, *args, **kwargs):
            if has_app_context():
                return self.run(*args, **kwargs)
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = ContextTask


def enqueue(task_name: str, args=(), countdown: float | None = None, eta=None):
    """Queue a Celery task by name.

    With CELERY_EAGER=true (local runs without Redis, tests) tasks run inline; ETA-scheduled tasks are
    skipped because the hourly sweep is the safety net for those.
    """
    task = celery.tasks[task_name]
    if current_app.config["CELERY_EAGER"]:
        if eta is not None:
            log.info("eager mode: skipping ETA task %s%s", task_name, tuple(args))
            return None
        return task.apply(args=tuple(args))
    return task.apply_async(args=tuple(args), countdown=countdown, eta=eta)
