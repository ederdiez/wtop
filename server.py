#!/usr/bin/env python3
import argparse
import json
import threading
import time
from pathlib import Path

from flask import Flask, Response, request, send_from_directory

from metrics import MetricsCollector

BASE = Path(__file__).resolve().parent


def create_app(interval):
    app = Flask(__name__)
    collector = MetricsCollector()
    lock = threading.Lock()
    state = {"interval": max(0.1, interval)}

    @app.route("/")
    def index():
        return send_from_directory(BASE / "static", "index.html")

    @app.route("/static/<path:name>")
    def static_files(name):
        return send_from_directory(BASE / "static", name)

    @app.route("/api/settings")
    def get_settings():
        return {"interval": state["interval"]}

    @app.route("/api/settings", methods=["POST"])
    def set_settings():
        data = request.get_json(silent=True) or {}
        try:
            iv = max(0.1, min(60.0, float(data.get("interval"))))
        except (TypeError, ValueError):
            return {"error": "intervalo inválido"}, 400
        with lock:
            state["interval"] = iv
        return {"interval": iv}

    @app.route("/stream")
    def stream():
        def gen():
            while True:
                with lock:
                    payload = json.dumps(collector.collect())
                    iv = state["interval"]
                yield "data: " + payload + "\n\n"
                time.sleep(iv)

        return Response(
            gen(),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


def main():
    ap = argparse.ArgumentParser(description="wtop - monitor de sistema web")
    ap.add_argument("--host", default="0.0.0.0",
                    help="interfaz a escuchar (0.0.0.0 para Tailscale)")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--interval", type=float, default=1.0,
                    help="segundos entre muestras (default: 1.0)")
    args = ap.parse_args()

    app = create_app(max(0.1, args.interval))
    print(f"wtop en http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, threaded=True,
            use_reloader=False)


if __name__ == "__main__":
    main()
