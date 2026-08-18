import os
import platform
import socket
import time

import psutil

PSEUDO_FSTYPES = {
    "proc", "sysfs", "devpts", "devtmpfs", "tmpfs", "ramfs", "cgroup",
    "cgroup2", "binfmt_misc", "pstore", "securityfs", "debugfs", "tracefs",
    "fusectl", "configfs", "mqueue", "hugetlbfs", "rpc_pipefs", "autofs",
    "nsfs", "efivarfs", "bpf", "squashfs", "overlay",
}


def _os_pretty():
    try:
        with open("/etc/os-release") as f:
            for line in f:
                if line.startswith("PRETTY_NAME="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return platform.system()


class MetricsCollector:
    def __init__(self):
        self._prev_net = {}
        self._prev_disk = None
        self._prev_proc = {}
        self._prev_ts = time.monotonic()
        psutil.cpu_percent(interval=None)
        psutil.cpu_percent(interval=None, percpu=True)

    def collect(self):
        now = time.monotonic()
        elapsed = max(now - self._prev_ts, 0.001)
        self._prev_ts = now

        data = {
            "ts": time.time(),
            "hostname": socket.gethostname(),
            "os": _os_pretty(),
            "kernel": platform.release(),
            "uptime": int(time.time() - psutil.boot_time()),
            "load": os.getloadavg(),
            "users": [[u.name, u.terminal, u.host] for u in psutil.users()],
        }
        data["cpu"] = self._cpu()
        data["mem"] = self._mem()
        data["disk"] = self._disk(elapsed)
        data["net"] = self._net(elapsed)
        data["temps"] = self._temps()
        data["fans"] = self._fans()
        data["battery"] = self._battery()
        data["procs"] = self._procs(elapsed)
        return data

    def _cpu(self):
        core = psutil.cpu_percent(interval=None, percpu=True)
        freq = psutil.cpu_freq()
        return {
            "percent": sum(core) / len(core) if core else 0.0,
            "per_core": core,
            "freq": freq.current if freq else None,
            "freq_max": (freq.max or None) if freq else None,
            "cores": psutil.cpu_count(logical=False),
            "threads": len(core),
        }

    def _mem(self):
        m = psutil.virtual_memory()
        s = psutil.swap_memory()
        return {
            "total": m.total,
            "used": m.used,
            "available": m.available,
            "percent": m.percent,
            "swap_total": s.total,
            "swap_used": s.used,
            "swap_percent": s.percent,
        }

    def _disk(self, elapsed):
        parts = []
        seen_devices = set()
        for p in psutil.disk_partitions(all=False):
            if p.fstype in PSEUDO_FSTYPES:
                continue
            if p.device in seen_devices:
                continue
            seen_devices.add(p.device)
            try:
                u = psutil.disk_usage(p.mountpoint)
            except (PermissionError, OSError):
                continue
            parts.append({
                "device": p.device,
                "mount": p.mountpoint,
                "fstype": p.fstype,
                "total": u.total,
                "used": u.used,
                "percent": u.percent,
            })

        read = write = 0.0
        try:
            cur = psutil.disk_io_counters()
            if cur is not None and self._prev_disk is not None:
                read = (cur.read_bytes - self._prev_disk.read_bytes) / elapsed
                write = (cur.write_bytes - self._prev_disk.write_bytes) / elapsed
            self._prev_disk = cur
        except Exception:
            pass

        return {"partitions": parts, "io_read": read, "io_write": write}

    def _net(self, elapsed):
        out = []
        try:
            cur = psutil.net_io_counters(pernic=True, nowrap=True)
        except TypeError:
            cur = psutil.net_io_counters(pernic=True)
        prev = self._prev_net
        for name, c in cur.items():
            if name == "lo" or name.startswith(("veth", "br-", "virbr", "docker")):
                continue
            rx = tx = 0.0
            p = prev.get(name)
            if p:
                rx = (c.bytes_recv - p.bytes_recv) / elapsed
                tx = (c.bytes_sent - p.bytes_sent) / elapsed
            out.append({
                "name": name,
                "rx": rx,
                "tx": tx,
                "rx_total": c.bytes_recv,
                "tx_total": c.bytes_sent,
            })
        self._prev_net = dict(cur)
        return out

    def _temps(self):
        out = []
        try:
            sensors = psutil.sensors_temperatures() or {}
        except AttributeError:
            return out
        for chip, entries in sensors.items():
            for i, e in enumerate(entries):
                out.append({
                    "chip": chip,
                    "label": e.label or f"{chip} #{i + 1}",
                    "current": e.current,
                    "high": e.high,
                    "critical": e.critical,
                })
        return out

    def _fans(self):
        out = []
        try:
            fans = psutil.sensors_fans() or {}
        except AttributeError:
            return out
        for chip, entries in fans.items():
            for e in entries:
                out.append({"chip": chip, "label": e.label, "rpm": e.current})
        return out

    def _battery(self):
        try:
            b = psutil.sensors_battery()
        except AttributeError:
            return None
        if b is None:
            return None
        return {"percent": b.percent, "plugged": b.power_plugged}

    def _procs(self, elapsed):
        out = []
        seen = set()
        try:
            for p in psutil.process_iter([
                "pid", "name", "username", "status", "nice", "cpu_times",
                "memory_percent",
            ]):
                try:
                    pid = p.info["pid"]
                    seen.add(pid)
                    ct = p.info["cpu_times"]
                    t = (ct[0] + ct[1]) if ct else 0.0
                    prev = self._prev_proc.get(pid)
                    cpu = (t - prev) / elapsed * 100.0 if prev is not None else 0.0
                    self._prev_proc[pid] = t
                    out.append({
                        "pid": pid,
                        "user": p.info["username"] or "?",
                        "name": p.info["name"] or "?",
                        "status": p.info["status"] or "?",
                        "nice": p.info["nice"],
                        "cpu": cpu,
                        "mem": p.info["memory_percent"] or 0.0,
                        "time": int(ct[0] + ct[1]) if ct else 0,
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied,
                        psutil.ZombieProcess):
                    continue
        except Exception:
            pass

        for pid in list(self._prev_proc):
            if pid not in seen:
                del self._prev_proc[pid]

        out.sort(key=lambda p: p["cpu"], reverse=True)
        return out[:30]
