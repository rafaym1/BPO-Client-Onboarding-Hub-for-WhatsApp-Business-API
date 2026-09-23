FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 5000

# docker-compose overrides this for web (migrations + gunicorn) and worker (celery)
CMD ["gunicorn", "-b", "0.0.0.0:5000", "-w", "2", "wsgi:app"]
