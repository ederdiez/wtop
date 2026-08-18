# wtop

Web-based system monitor in the style of btop: CPU, memory, disks, network,
temperatures, battery and processes in real time, with a dark theme and no
external dependencies in the browser.

## Requirements

- Python 3.10+
- `psutil` and `flask`

Both are usually already installed. If not:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

## Usage

```bash
.venv/bin/python server.py
# open http://localhost:8080
```

Options:

| Flag          | Default  | Description                         |
|---------------|----------|-------------------------------------|
| `--host`      | 0.0.0.0  | Interface to listen on             |
| `--port`      | 8080     | Port                                |
| `--interval`  | 1.0      | Seconds between samples             |

## With Tailscale

With `--host 0.0.0.0` (the default) the server is reachable at
`http://<tailscale-IP>:8080` from any device in your tailnet.
Authentication is handled by Tailscale (ACLs), so no own login is needed.

## Notes

- Temperatures require `/sys/class/hwmon` to be readable (usually it is; some
  sensors need root).
- No GPU support (psutil does not expose it).
- Stop the server with `Ctrl+C`.
