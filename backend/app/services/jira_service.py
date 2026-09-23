"""Jira Cloud REST v3. Mocked (with realistic BPO-1xx keys) unless JIRA_EMAIL/JIRA_API_TOKEN/JIRA_DOMAIN are set."""
import logging

import requests
from flask import current_app

from . import mock_store

log = logging.getLogger(__name__)

# our checklist status -> Jira workflow status name
_STATUS_NAMES = {"done": "Done", "in_progress": "In Progress", "pending": "To Do", "blocked": "Blocked"}


class JiraError(Exception):
    pass


def is_mock() -> bool:
    return current_app.config["MOCK_JIRA"]


def _domain() -> str:
    return current_app.config["JIRA_DOMAIN"] or "mock.atlassian.net"


def issue_url(issue_key: str | None) -> str | None:
    return f"https://{_domain()}/browse/{issue_key}" if issue_key else None


def _request(method: str, path: str, **kwargs):
    cfg = current_app.config
    try:
        resp = requests.request(
            method, f"https://{cfg['JIRA_DOMAIN']}/rest/api/3/{path}",
            auth=(cfg["JIRA_EMAIL"], cfg["JIRA_API_TOKEN"]),
            headers={"Accept": "application/json"}, timeout=15, **kwargs,
        )
    except requests.RequestException as exc:
        raise JiraError(f"Could not reach Jira: {exc}") from exc
    if not resp.ok:
        raise JiraError(f"Jira {method} {path} failed: {resp.status_code} {resp.text[:300]}")
    return resp.json() if resp.content else {}


def _adf(text: str) -> dict:
    """Jira v3 requires descriptions in Atlassian Document Format."""
    return {"type": "doc", "version": 1, "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


def create_onboarding_epic(client) -> dict:
    """Epic "Onboard {business_name} to WhatsApp API" + one sub-task per checklist step.

    Returns {'epic_key': str, 'tasks': {step_order: issue_key}}. Persisting keys is the caller's job.
    """
    summary = f"Onboard {client.business_name} to WhatsApp API"
    steps = sorted(client.checklist, key=lambda s: s.step_order)

    if is_mock():
        epic_key = f"{current_app.config['JIRA_PROJECT_KEY']}-{mock_store.next_number('jira')}"
        mock_store.record("jira", "create_epic", key=epic_key, summary=summary)
        tasks = {}
        for step in steps:
            key = f"{current_app.config['JIRA_PROJECT_KEY']}-{mock_store.next_number('jira')}"
            mock_store.record("jira", "create_task", key=key, parent=epic_key, summary=f"{step.step_name} - {client.business_name}")
            tasks[step.step_order] = key
        return {"epic_key": epic_key, "tasks": tasks}

    project = {"key": current_app.config["JIRA_PROJECT_KEY"]}
    epic = _request("POST", "issue", json={"fields": {
        "project": project, "issuetype": {"name": "Epic"}, "summary": summary,
        "description": _adf(f"Onboarding of {client.business_name} ({client.country}) to the WhatsApp Business API."),
    }})
    tasks = {}
    for step in steps:
        issue = _request("POST", "issue", json={"fields": {
            "project": project, "issuetype": {"name": current_app.config["JIRA_TASK_ISSUE_TYPE"]},
            "summary": f"{step.step_name} - {client.business_name}", "parent": {"key": epic["key"]},
        }})
        tasks[step.step_order] = issue["key"]
    return {"epic_key": epic["key"], "tasks": tasks}


def update_issue_status(issue_key: str, status: str) -> None:
    """Move an issue to the workflow status matching our checklist status (done/in_progress/pending/blocked)."""
    target = _STATUS_NAMES.get(status, status)
    if is_mock():
        mock_store.record("jira", "transition", key=issue_key, to=target)
        return
    transitions = _request("GET", f"issue/{issue_key}/transitions")["transitions"]
    match = next((t for t in transitions if t["to"]["name"].lower() == target.lower()), None)
    if not match:
        raise JiraError(f"{issue_key}: no transition to '{target}' (available: {[t['to']['name'] for t in transitions]})")
    _request("POST", f"issue/{issue_key}/transitions", json={"transition": {"id": match["id"]}})
