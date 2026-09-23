from flask import Flask, current_app, jsonify


def register_blueprints(app: Flask):
    from . import appointments, clients, contacts, templates, webhooks

    for module in (clients, templates, appointments, contacts, webhooks):
        app.register_blueprint(module.bp)

    if app.config["DEV_TOOLS"]:
        from . import dev

        app.register_blueprint(dev.bp)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/config")
    def public_config():
        """What the frontend needs to know: which integrations are mocked, and whether demo helpers exist."""
        cfg = current_app.config
        return jsonify({
            "mock": {"whatsapp": cfg["MOCK_WHATSAPP"], "hubspot": cfg["MOCK_HUBSPOT"], "jira": cfg["MOCK_JIRA"]},
            "dev_tools": cfg["DEV_TOOLS"],
            "clinic_timezone": cfg["CLINIC_TIMEZONE"],
        })
