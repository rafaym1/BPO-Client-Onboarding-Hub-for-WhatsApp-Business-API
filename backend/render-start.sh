#!/bin/sh
# Render entrypoint: migrations -> optional demo seed -> Celery worker+beat (background) -> gunicorn (foreground).
# Worker and web share one container so the whole backend fits Render's free web-service tier.
# On a paid plan, split the worker into its own `type: worker` service instead (see render.yaml).
set -e

alembic upgrade head

if [ "$SEED_DEMO" = "true" ]; then
  python -m app.seed ${SEED_ARGS:-}
fi

# --pool=solo keeps memory low (512 MB free tier); -B embeds beat for the hourly 24h-reminder sweep
celery -A app.celery_app.celery worker -B --pool=solo -l info -s /tmp/celerybeat-schedule &

exec gunicorn -b "0.0.0.0:${PORT:-10000}" -w 1 --threads 4 --access-logfile - wsgi:app
