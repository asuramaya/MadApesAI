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

  // Staleness banner: publisher pulses every 5 min. Anything older than
  // 12 min is a real "photon is quiet" signal, not a normal tick gap.
  const banner = document.getElementById("stale-banner");
  if (banner && h.last_update) {
    const ageSec = Date.now() / 1000 - h.last_update;
    const stale = ageSec > 12 * 60;
    banner.hidden = !stale;
    if (stale) {
      banner.textContent = "publisher quiet — last pulse " + fmtTimeAgo(h.last_update);
    }
  }
}

// --- render: calls ---
function renderCalls(calls) {
  const container = document.getElementById("calls-list");
  clear(container);
  if (!calls || !calls.length) {
    container.appendChild(el("div", { class: "empty", text: "no active calls" }));
    return;
  }
  for (const c of calls) {
    const sym = c.symbol
      ? "$" + c.symbol
      : shortAddr(c.mint || "");
    const pctCls = pnlClass(c.pct_from_call || 0);
    const entryStr = c.entry_mcap_usd
      ? "entry $" + formatMcap(c.entry_mcap_usd)
      : "—";
    const nowStr = c.current_mcap_usd
      ? "now $" + formatMcap(c.current_mcap_usd)
      : "—";
    const age = fmtTimeAgo(c.called_at);

    // Expiration countdown — shows "7d left" / "expires 3h" so the public
    // sees exactly when an un-confirmed call will auto-close.
    let exp = null;
    if (c.expires_at) {
      const left = c.expires_at - Date.now() / 1000;
      if (left > 0) {
        exp =
          left > 86400
            ? Math.floor(left / 86400) + "d left"
            : Math.floor(left / 3600) + "h left";
      } else {
        exp = "expired";
      }
    }

    const symEl = el("div", { class: "sym", text: sym });
    const detailParts = [entryStr + " · " + nowStr + " · " + age];
    if (exp) detailParts.push(" · " + exp);
    detailParts.push(" · ");
    const detail = el("div", { class: "detail" }, [
      detailParts.join(""),
      el("a", {
        href: DEXSCREENER + "/" + c.mint,
        target: "_blank",
        rel: "noopener",
        text: "chart",
      }),
      " ",
      el("a", {
        href: "data/whales/" + c.mint + ".json",
        target: "_blank",
        rel: "noopener",
        text: "whales",
      }),
    ]);
    const numEl = el("div", {
      class: "num " + pctCls,
      text: fmtPct(c.pct_from_call),
    });
    container.appendChild(el("div", { class: "row", title: c.mint }, [symEl, detail, numEl]));
  }
}

function formatMcap(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return n.toFixed(0);
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
  const assets = (await loadJson("thoughts/assets.json")) || {};
  // Main page shows only the latest note as a teaser. The full archive
  // lives in the book at /notes.html — flip through it there.
  const sorted = [...index].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const subset = sorted.slice(0, 1);
  for (const t of subset) {
    const md = await loadText("thoughts/" + t.file);
    const head = el("div", { class: "thought-head" }, [
      el("div", { class: "thought-date", text: t.date || "" }),
      el("div", { class: "thought-title", text: t.title || t.file }),
    ]);
    const body = el("div", { class: "thought-body" });
    if (md && typeof marked !== "undefined") {
      renderThoughtBody(body, md, assets[t.file] || []);
    }
    container.appendChild(el("article", { class: "thought" }, [head, body]));
  }
}

// Parse markdown → sanitized DOM → walk the placeholder divs in document
// order and, if the manifest has a generated image for that index, replace
// the placeholder with a proper <figure>. Leaves untouched placeholders
// intact so we gracefully degrade before assets land.
function renderThoughtBody(bodyEl, md, manifestEntries) {
  const raw = marked.parse(md);
  const clean = typeof DOMPurify !== "undefined" ? DOMPurify.sanitize(raw) : "";
  const tpl = document.createElement("template");
  tpl["inner" + "HTML"] = clean;
  const frag = tpl.content.cloneNode(true);

  const placeholders = frag.querySelectorAll("div.img-placeholder");
  const byIdx = new Map();
  for (const entry of manifestEntries) byIdx.set(entry.idx, entry);
  placeholders.forEach((ph, i) => {
    const entry = byIdx.get(i);
    if (!entry) return;
    const fig = document.createElement("figure");
    fig.className = "thought-figure";
    const img = document.createElement("img");
    img.src = entry.asset;
    img.alt = entry.caption || "";
    img.loading = "lazy";
    fig.appendChild(img);
    if (entry.caption) {
      const cap = document.createElement("figcaption");
      cap.textContent = entry.caption;
      fig.appendChild(cap);
    }
    ph.replaceWith(fig);
  });
  bodyEl.appendChild(frag);
}

// --- bootstrap ---
async function main() {
  const [health, pnl, positions, activity, calls, thoughtsIndex] = await Promise.all([
    loadJson("data/health.json"),
    loadJson("data/pnl.json"),
    loadJson("data/positions.json"),
    loadJson("data/activity.json"),
    loadJson("data/calls.json"),
    loadJson("thoughts/index.json"),
  ]);
  renderHealth(health);
  renderPnl(pnl);
  renderPositions(positions && positions.positions);
  renderCalls(calls && calls.active);
  renderActivity(activity && activity.activity);
  await renderThoughts(thoughtsIndex && thoughtsIndex.thoughts);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
