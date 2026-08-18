"use strict";

const $ = (id) => document.getElementById(id);

/* ---------------- formateo ---------------- */

const BPS = ["B", "KB", "MB", "GB", "TB", "PB"];

function fmtBytes(n, { rate = false } = {}) {
  let i = 0;
  let v = n;
  while (v >= 1024 && i < BPS.length - 1) { v /= 1024; i++; }
  const s = v.toFixed(v >= 100 || i === 0 ? 0 : 1);
  return s + " " + BPS[i] + (rate ? "/s" : "");
}

function fmtDur(secs) {
  secs = Math.max(0, Math.floor(secs));
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${secs % 60}s`;
}

function fmtClock(secs) {
  secs = Math.max(0, Math.floor(secs));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return String(h).padStart(2, "0") + ":" +
         String(m).padStart(2, "0") + ":" +
         String(s).padStart(2, "0");
}

function heat(pct) {
  pct = Math.max(0, Math.min(100, pct));
  return `hsl(${120 - pct * 1.2}, 70%, 45%)`;
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- sparklines ---------------- */

class Spark {
  constructor(cv, colors, fixedMax = null) {
    this.cv = typeof cv === "string" ? $(cv) : cv;
    this.ctx = this.cv.getContext("2d");
    this.colors = colors;
    this.series = colors.map(() => []);
    this.fixedMax = fixedMax;
  }

  push(vals) {
    this.series.forEach((s, i) => {
      s.push(vals[i]);
      if (s.length > 60) s.shift();
    });
    this.draw();
  }

  draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.cv.clientWidth || 100;
    const h = this.cv.clientHeight || 60;
    if (this.cv.width !== Math.round(w * dpr) ||
        this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = this.series[0].length;
    if (n < 2) return;

    let max = this.fixedMax;
    if (!max) {
      max = 1;
      for (const s of this.series)
        for (const v of s) if (v > max) max = v;
      max *= 1.2;
    }

    ctx.strokeStyle = "rgba(127, 139, 171, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    this.series.forEach((s, si) => {
      const step = w / (60 - 1);
      ctx.beginPath();
      s.forEach((v, i) => {
        const x = i * step;
        const y = h - (Math.min(v, max) / max) * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = this.colors[si];
      ctx.lineWidth = 1.6;
      ctx.stroke();

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, this.colors[si] + "44");
      grad.addColorStop(1, this.colors[si] + "00");
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    });
  }
}

const cpuSpark = new Spark("cpu-chart", ["#4fc3f7"]);
const memSpark = new Spark("mem-chart", ["#e0af68"], 100);
const netSparks = new Map();

/* ---------------- procesamiento ---------------- */

const sortState = { key: "cpu", dir: -1 };

function renderHeader(d) {
  $("hostname").textContent = d.hostname;
  $("os").textContent = d.os;
  $("kernel").textContent = d.kernel;
  $("uptime").textContent = fmtDur(d.uptime);
  $("load").textContent = d.load.map((l) => l.toFixed(2)).join("  ");
  $("users").textContent = d.users.length;
}

function renderCpu(d) {
  const c = d.cpu;
  const pct = c.percent;
  $("cpu-pct").textContent = pct.toFixed(0) + "%";
  $("cpu-pct").style.color = heat(pct);
  const bar = $("cpu-bar");
  bar.style.width = pct + "%";
  bar.style.background = heat(pct);

  const freq =
    c.freq != null
      ? (c.freq / 1000).toFixed(2) + " GHz" +
        (c.freq_max ? " / " + (c.freq_max / 1000).toFixed(1) + "G" : "")
      : "";
  $("cpu-freq").innerHTML = c.threads + " hilos" +
    (freq ? " &middot; " + freq : "");

  const cores = $("cpu-cores");
  if (cores.childElementCount !== c.per_core.length) {
    cores.innerHTML = "";
    c.per_core.forEach((_, i) => {
      const el = document.createElement("div");
      el.className = "core";
      el.innerHTML = '<div class="cbar"><div class="cfill"></div></div>' +
                     `<span>c${i}</span>`;
      cores.appendChild(el);
    });
  }
  [...cores.children].forEach((el, i) => {
    const v = c.per_core[i];
    const f = el.querySelector(".cfill");
    f.style.height = v + "%";
    f.style.background = heat(v);
    el.title = `core ${i}: ${v.toFixed(1)}%`;
  });

  cpuSpark.push([pct]);
}

function renderMem(d) {
  const m = d.mem;
  $("mem-bar").style.width = m.percent + "%";
  $("mem-bar").style.background = heat(m.percent);
  $("mem-text").innerHTML =
    `<b>${fmtBytes(m.used)}</b> de ${fmtBytes(m.total)} ` +
    `<span class="muted">&middot; ${m.percent.toFixed(0)}% ` +
    `&middot; libre ${fmtBytes(m.available)}</span>`;

  if (m.swap_total > 0) {
    $("swap-bar").style.width = m.swap_percent + "%";
    $("swap-bar").style.background = heat(m.swap_percent);
    $("swap-text").innerHTML =
      `<b>${fmtBytes(m.swap_used)}</b> de ${fmtBytes(m.swap_total)} ` +
      `<span class="muted">&middot; ${m.swap_percent.toFixed(0)}%</span>`;
  } else {
    $("swap-bar").style.width = "0%";
    $("swap-text").innerHTML = '<span class="muted">sin swap</span>';
  }

  memSpark.push([m.percent]);
}

function renderDisk(d) {
  const list = $("disk-list");
  list.innerHTML = "";
  for (const p of d.disk.partitions) {
    const row = document.createElement("div");
    row.className = "disk-row";
    row.innerHTML =
      `<div class="disk-head">` +
        `<span class="mount">${esc(p.mount)}` +
          `<span class="dev">${esc(p.device)} &middot; ${esc(p.fstype)}</span>` +
        `</span>` +
        `<span class="usage">${fmtBytes(p.used)} / <b>${fmtBytes(p.total)}</b> ` +
          `&middot; ${p.percent.toFixed(0)}%</span>` +
      `</div>` +
      `<div class="bar"><div class="fill" style="width:${p.percent}%;` +
        `background:${heat(p.percent)}"></div></div>`;
    list.appendChild(row);
  }
  $("disk-io").innerHTML =
    `<b>&darr; ${fmtBytes(d.disk.io_read, { rate: true })}</b> ` +
    `<b>&uarr; ${fmtBytes(d.disk.io_write, { rate: true })}</b>`;
}

function renderNet(d) {
  const list = $("net-list");
  for (const iface of d.net) {
    let entry = netSparks.get(iface.name);
    if (!entry) {
      const row = document.createElement("div");
      row.className = "net-row";
      row.innerHTML =
        `<div class="net-top">` +
          `<span class="ifname">${esc(iface.name)}</span>` +
          `<span class="rate"><span class="down">&darr; --</span> ` +
          `<span class="up">&uarr; --</span></span>` +
        `</div>` +
        `<canvas></canvas>`;
      list.appendChild(row);
      entry = { el: row, spark: null };
      netSparks.set(iface.name, entry);
    }
    const row = entry.el;
    const down = row.querySelector(".down");
    const up = row.querySelector(".up");
    down.textContent = "\u2193 " + fmtBytes(iface.rx, { rate: true });
    up.textContent = "\u2191 " + fmtBytes(iface.tx, { rate: true });
    if (!entry.spark) {
      entry.spark = new Spark(row.querySelector("canvas"),
                              ["#4fd6a5", "#7aa2f7"]);
    }
    entry.spark.push([iface.rx, iface.tx]);
  }
  for (const [name, row] of netSparks) {
    if (!d.net.some((n) => n.name === name)) row.el.remove(), netSparks.delete(name);
  }
}

function renderTemps(d) {
  const list = $("temps-list");
  list.innerHTML = "";
  if (!d.temps.length) {
    list.innerHTML = '<div class="none">sin datos (puede requerir root)</div>';
    return;
  }
  for (const t of d.temps) {
    const pct = t.critical ? (t.current / t.critical) * 100 : (t.current / 85) * 100;
    const row = document.createElement("div");
    row.className = "temp-row";
    const crit = t.critical ? " / " + t.critical.toFixed(0) + "\u00B0C cr\u00edt" : "";
    row.innerHTML =
      `<span class="tname">${esc(t.label)}` +
        `<small>${esc(t.chip)}${crit}</small></span>` +
      `<span class="tval" style="color:${heat(pct)}">` +
        `${t.current.toFixed(1)}\u00B0C</span>`;
    list.appendChild(row);
  }
}

function renderBattery(d) {
  const el = $("battery");
  if (!d.battery) {
    el.innerHTML = '<div class="none">sin bater\u00eda</div>';
    return;
  }
  const b = d.battery;
  const color = heat(b.percent);
  el.innerHTML =
    `<div class="bar"><div class="fill" style="width:${b.percent}%;` +
      `background:${color}"></div></div>` +
    `<div class="stats"><b>${b.percent.toFixed(0)}%</b> ` +
      `&middot; ${b.plugged ? "enchufado" : "a bater\u00eda"}</div>`;
}

const STATUS_COLORS = {
  running: "#4fd6a5",
  sleeping: "#7aa2f7",
  idle: "#7f8bab",
  zombie: "#f7768e",
  stopped: "#e0af68",
  "disk-sleep": "#bb9af7",
  dead: "#f7768e",
};

function renderProcs(d) {
  const list = [...d.procs];
  const { key, dir } = sortState;
  list.sort((a, b) => {
    if (typeof a[key] === "string")
      return a[key].localeCompare(b[key]) * dir;
    return (a[key] - b[key]) * dir;
  });

  const tbody = document.querySelector("#procs tbody");
  tbody.innerHTML = "";
  for (const p of list.slice(0, 20)) {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td>${p.pid}</td>` +
      `<td>${esc(p.user)}</td>` +
      `<td class="num pcpu" style="color:${heat(p.cpu)}">${p.cpu.toFixed(1)}</td>` +
      `<td class="num pmem" style="color:${heat(p.mem)}">${p.mem.toFixed(1)}</td>` +
      `<td style="color:${STATUS_COLORS[p.status] || "#dbe2ef"}">${esc(p.status)}</td>` +
      `<td class="num">${p.nice}</td>` +
      `<td class="num">${fmtClock(p.time)}</td>` +
      `<td class="pname" title="${esc(p.name)}">${esc(p.name)}</td>`;
    tbody.appendChild(tr);
  }
}

function renderSortHeader() {
  document.querySelectorAll("#procs th").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.k === sortState.key);
  });
}

function render(d) {
  renderHeader(d);
  renderCpu(d);
  renderMem(d);
  renderDisk(d);
  renderNet(d);
  renderTemps(d);
  renderBattery(d);
  renderProcs(d);
  $("last-update").textContent = new Date(d.ts * 1000)
    .toLocaleTimeString("es-ES");
}

/* ---------------- sse ---------------- */

function setStatus(on) {
  $("status").classList.toggle("on", on);
  $("status").title = on ? "conectado" : "desconectado";
}

const es = new EventSource("/stream");
es.onopen = () => setStatus(true);
es.onerror = () => setStatus(false);
es.onmessage = (e) => {
  try { render(JSON.parse(e.data)); } catch (_) {}
};

document.querySelectorAll("#procs th").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortState.key === k) sortState.dir *= -1;
    else sortState.key = k, sortState.dir = -1;
    renderSortHeader();
  });
});
renderSortHeader();
