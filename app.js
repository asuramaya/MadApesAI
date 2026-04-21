// MadApes.ai — renders live PnL + positions + activity + thoughts.
// Data comes from /data/*.json snapshots committed to the repo (~every 5 min).
// Thoughts are dated markdown files under /thoughts/, indexed by /thoughts/index.json.
//
// DOM is built with createElement/textContent (never innerHTML) for every
// piece of data we control. Rendered markdown is piped through DOMPurify
// before being inserted, so even if a thought file is tampered with, it
// can't inject executable content.

const SOLSCAN = "https://solscan.io";
const DEXSCREENER = "https://dexscreener.com/solana";

function fmtUsd(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1000) return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return "$" + n.toFixed(2);
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sign = n >= 0 ? "+" : "";
  return sign + n.toFixed(1) + "%";
}

function fmtTimeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return Math.floor(diff) + "s ago";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

function shortAddr(a) {
  if (!a || a.length < 10) return a || "—";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function pnlClass(n) {
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "";
}

// --- DOM builders ---
function el(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "href") n.setAttribute("href", v);
      else if (k === "title") n.setAttribute("title", v);
      else if (k === "target") n.setAttribute("target", v);
      else if (k === "rel") n.setAttribute("rel", v);
      else if (k === "datetime") n.setAttribute("datetime", v);
      else n.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of children) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
  }
  return n;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function loadJson(path) {
  try {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn("load failed:", path, e);
    return null;
  }
}

async function loadText(path) {
  try {
    const res = await fetch(path + "?t=" + Date.now());
    if (!res.ok) throw new Error(res.status);
    return await res.text();
  } catch (e) {
    console.warn("load failed:", path, e);
    return null;
  }
}

// --- render: health/header ---
function renderHealth(h) {
  if (!h) return;
  const addr = document.getElementById("wallet-addr");
  addr.textContent = shortAddr(h.wallet || "");
  addr.setAttribute("title", h.wallet || "");
  const solText =
    h.sol_balance != null
      ? h.sol_balance.toFixed(3) + " SOL" +
        (h.sol_price_usd ? " @ $" + h.sol_price_usd.toFixed(0) : "")
      : "—";
  document.getElementById("sol-bal").textContent = solText;
  document.getElementById("last-update").textContent =
    h.last_update ? "updated " + fmtTimeAgo(h.last_update) : "—";
}

// --- render: pnl ---
function renderPnl(pnl) {
  if (!pnl) return;
  const totalEl = document.getElementById("total-value");
  const realizedEl = document.getElementById("realized-pnl");
  const unrealizedEl = document.getElementById("unrealized-pnl");

  totalEl.textContent = fmtUsd(pnl.total_value_usd);
  realizedEl.textContent = fmtUsd(pnl.realized_pnl_usd);
  realizedEl.className = "big " + pnlClass(pnl.realized_pnl_usd || 0);
  unrealizedEl.textContent = fmtUsd(pnl.unrealized_pnl_usd);
  unrealizedEl.className = "big " + pnlClass(pnl.unrealized_pnl_usd || 0);

  renderChart(pnl.series || [], pnl.trades || []);
}

function renderChart(series, trades) {
  const container = document.getElementById("pnl-chart");
  clear(container);
  if (typeof uPlot === "undefined" || !series.length) {
    const hint = el("div", { class: "chart-hint" }, [
      "ape is still sniffing — no banana count yet",
    ]);
    container.appendChild(hint);
    return;
  }
  const xs = series.map((p) => p.ts);
  const ys = series.map((p) => p.value_usd);

  // Build aligned y-arrays for trade markers: one column per "side".
  // Values = portfolio value at the closest series timestamp, or null where
  // no trade matches that x-coordinate.
  const buyYs = new Array(xs.length).fill(null);
  const sellYs = new Array(xs.length).fill(null);
  if (trades && trades.length) {
    for (const t of trades) {
      // Nearest series index by timestamp — markers snap to a real
      // portfolio-value datapoint so the chart geometry stays honest.
      let nearest = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < xs.length; i++) {
        const d = Math.abs(xs[i] - t.ts);
        if (d < bestDiff) {
          bestDiff = d;
          nearest = i;
        }
      }
      if (t.side === "buy") buyYs[nearest] = ys[nearest];
      else sellYs[nearest] = ys[nearest];
    }
  }

  const opts = {
    width: container.clientWidth,
    height: 220,
    padding: [16, 12, 0, 0],
    series: [
      {},
      {
        label: "total value",
        stroke: "#ff7a1a",
        width: 1.5,
        fill: "rgba(255,122,26,0.07)",
      },
      {
        label: "buys",
        stroke: "#5fd47c",
        width: 0,
        points: { show: true, size: 8, stroke: "#5fd47c", fill: "#5fd47c" },
      },
      {
        label: "sells",
        stroke: "#ef5454",
        width: 0,
        points: { show: true, size: 8, stroke: "#ef5454", fill: "#ef5454" },
      },
    ],
    axes: [
      {
        stroke: "#4a4a4a",
        grid: { stroke: "#1f1f1f", width: 0.5 },
        ticks: { stroke: "#4a4a4a", width: 0.5 },
      },
      {
        stroke: "#4a4a4a",
        grid: { stroke: "#1f1f1f", width: 0.5 },
        ticks: { stroke: "#4a4a4a", width: 0.5 },
        values: (_, vs) => vs.map((v) => "$" + Math.round(v).toLocaleString()),
      },
    ],
    cursor: { drag: { x: true, y: false } },
    legend: { show: false },
  };
  new uPlot(opts, [xs, ys, buyYs, sellYs], container);
}

// --- render: positions ---
function renderPositions(positions) {
  const container = document.getElementById("positions-list");
  clear(container);
  if (!positions || !positions.length) {
    container.appendChild(el("div", { class: "empty", text: "bag is empty" }));
    return;
  }
  for (const p of positions) {
    const sym = el("div", { class: "sym", text: "$" + (p.symbol || shortAddr(p.mint)) });
    const detail = el("div", { class: "detail" }, [
      "pos " + fmtUsd(p.position_usd) + " · entry " + fmtUsd(p.avg_entry_usd) + " · ",
      el("a", {
        href: DEXSCREENER + "/" + p.mint,
        target: "_blank",
        rel: "noopener",
        text: "chart",
      }),
    ]);
    const num = el("div", {
      class: "num " + pnlClass(p.pnl_pct || 0),
      text: fmtPct(p.pnl_pct),
    });
    container.appendChild(el("div", { class: "row" }, [sym, detail, num]));
  }
}

// --- render: activity ---
function renderActivity(acts) {
  const container = document.getElementById("activity-list");
  clear(container);
  if (!acts || !acts.length) {
    container.appendChild(el("div", { class: "empty", text: "quiet in the jungle" }));
    return;
  }
  for (const a of acts) {
    const time = el("time", {
      datetime: new Date((a.ts || 0) * 1000).toISOString(),
      text: fmtTimeAgo(a.ts),
    });
    const body = el("div", { class: "body", text: a.summary || "" });
    const links = el("div");
    if (a.signature) {
      links.appendChild(
        el("a", {
          href: SOLSCAN + "/tx/" + a.signature,
          target: "_blank",
          rel: "noopener",
          text: "tx",
        })
      );
      links.appendChild(document.createTextNode(" "));
    }
    if (a.mint) {
      links.appendChild(
        el("a", {
          href: DEXSCREENER + "/" + a.mint,
          target: "_blank",
          rel: "noopener",
          text: "chart",
        })
      );
    }
    container.appendChild(el("div", { class: "act" }, [time, body, links]));
  }
}

// --- render: thoughts ---
async function renderThoughts(index) {
  const container = document.getElementById("thoughts-list");
  clear(container);
  if (!index || !index.length) {
    container.appendChild(el("div", { class: "empty", text: "ape hasn't scribbled yet" }));
    return;
  }
  const sorted = [...index].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const subset = sorted.slice(0, 8);
  for (const t of subset) {
    const md = await loadText("thoughts/" + t.file);
    const head = el("div", { class: "thought-head" }, [
      el("div", { class: "thought-date", text: t.date || "" }),
      el("div", { class: "thought-title", text: t.title || t.file }),
    ]);
    const body = el("div", { class: "thought-body" });
    if (md && typeof marked !== "undefined") {
      const raw = marked.parse(md);
      // DOMPurify sanitizes the rendered HTML before we inject it. Since the
      // markdown comes from the repo we control, this is belt-and-suspenders
      // — but the security posture holds even if the repo is compromised.
      const clean = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(raw) : "";
      // Parse via template to get a DocumentFragment we can append safely.
      const tpl = document.createElement("template");
      tpl.innerHTML = clean;
      body.appendChild(tpl.content.cloneNode(true));
    }
    container.appendChild(el("article", { class: "thought" }, [head, body]));
  }
}

// --- bootstrap ---
async function main() {
  const [health, pnl, positions, activity, thoughtsIndex] = await Promise.all([
    loadJson("data/health.json"),
    loadJson("data/pnl.json"),
    loadJson("data/positions.json"),
    loadJson("data/activity.json"),
    loadJson("thoughts/index.json"),
  ]);
  renderHealth(health);
  renderPnl(pnl);
  renderPositions(positions && positions.positions);
  renderActivity(activity && activity.activity);
  await renderThoughts(thoughtsIndex && thoughtsIndex.thoughts);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
