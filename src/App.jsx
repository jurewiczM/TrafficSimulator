import { useState, useEffect, useRef, useCallback, useMemo } from "react";

// ─── CORE CONSTANTS ───
const GRID_PX = 580;
const CELL = 20;
const COLS = GRID_PX / CELL;

const TOOLS = [
  { id: "road_h1", label: "━ 1-Lane H", cat: "road" },
  { id: "road_h2", label: "═ 2-Lane H", cat: "road" },
  { id: "road_h3", label: "≡ 3-Lane H", cat: "road" },
  { id: "road_v1", label: "┃ 1-Lane V", cat: "road" },
  { id: "road_v2", label: "║ 2-Lane V", cat: "road" },
  { id: "road_v3", label: "┃┃┃ 3-Lane V", cat: "road" },
  { id: "roundabout_s", label: "◯ Small RB", cat: "junction" },
  { id: "roundabout_m", label: "◎ Med RB", cat: "junction" },
  { id: "roundabout_l", label: "◉ Large RB", cat: "junction" },
  { id: "crossing", label: "╋ Crossing", cat: "junction" },
  { id: "traffic_light", label: "🚦 Light", cat: "infra" },
  { id: "speed_bump", label: "▬ Bump", cat: "infra" },
  { id: "yield_sign", label: "△ Yield", cat: "infra" },
  { id: "eraser", label: "✕ Erase", cat: "tool" },
];

const AGENT_PROFILES = [
  { name: "Commuter", color: "#60A5FA", baseSpeed: 2.2, aggression: 0.30, caution: 0.60, distraction: 0.20, icon: "🚗" },
  { name: "Truck", color: "#A78BFA", baseSpeed: 1.1, aggression: 0.10, caution: 0.85, distraction: 0.10, icon: "🚛" },
  { name: "Cyclist", color: "#34D399", baseSpeed: 1.6, aggression: 0.10, caution: 0.40, distraction: 0.30, icon: "🚲" },
  { name: "Taxi", color: "#FBBF24", baseSpeed: 2.0, aggression: 0.55, caution: 0.50, distraction: 0.15, icon: "🚕" },
  { name: "New Driver", color: "#FB7185", baseSpeed: 1.7, aggression: 0.35, caution: 0.30, distraction: 0.50, icon: "🔰" },
  { name: "Bus", color: "#F97316", baseSpeed: 0.9, aggression: 0.05, caution: 0.90, distraction: 0.08, icon: "🚌" },
  { name: "Motorbike", color: "#E879F9", baseSpeed: 2.8, aggression: 0.50, caution: 0.35, distraction: 0.25, icon: "🏍️" },
  { name: "Emergency", color: "#EF4444", baseSpeed: 3.0, aggression: 0.15, caution: 0.70, distraction: 0.05, icon: "🚑" },
];

const INCIDENT_TYPES = [
  { type: "Near Miss", color: "#FBBF24", severity: 1, weight: 0.38 },
  { type: "Fender Bender", color: "#F97316", severity: 2, weight: 0.27 },
  { type: "Side Swipe", color: "#EF4444", severity: 3, weight: 0.18 },
  { type: "T-Bone", color: "#DC2626", severity: 4, weight: 0.12 },
  { type: "Pile-up", color: "#7F1D1D", severity: 5, weight: 0.05 },
];

const WEATHER_OPTS = [
  { name: "Clear", risk: 1.0, vis: 1.0, icon: "☀️" },
  { name: "Overcast", risk: 1.1, vis: 0.9, icon: "☁️" },
  { name: "Rain", risk: 1.55, vis: 0.7, icon: "🌧️" },
  { name: "Heavy Rain", risk: 1.85, vis: 0.5, icon: "⛈️" },
  { name: "Fog", risk: 1.4, vis: 0.35, icon: "🌫️" },
  { name: "Snow", risk: 2.0, vis: 0.55, icon: "❄️" },
  { name: "Ice", risk: 2.5, vis: 0.8, icon: "🧊" },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// ─── UTILS ───
function rng(seed) {
  let s = seed | 0 || 1;
  return () => { s = (s * 48271) % 2147483647; return (s - 1) / 2147483646; };
}

function pickWeighted(items, weightKey, rand) {
  const total = items.reduce((s, i) => s + i[weightKey], 0);
  let r = rand() * total;
  for (const item of items) { r -= item[weightKey]; if (r <= 0) return item; }
  return items[items.length - 1];
}

function laneCount(type) {
  if (!type) return 0;
  if (type.includes("3")) return 3;
  if (type.includes("2")) return 2;
  if (type.startsWith("road")) return 1;
  if (type.startsWith("roundabout")) return 2;
  if (type === "crossing") return 2;
  return 1;
}

function isRoad(t) { return t && (t.startsWith("road") || t.startsWith("roundabout") || t === "crossing"); }
function isInfra(t) { return t && (t === "traffic_light" || t === "speed_bump" || t === "yield_sign"); }
function baseType(t) {
  if (!t) return null;
  if (t.startsWith("road_h")) return "road_h";
  if (t.startsWith("road_v")) return "road_v";
  if (t.startsWith("roundabout")) return "roundabout";
  return t;
}

// ─── SIMULATION ENGINE ───
function buildGraph(grid, infraGrid) {
  const nodes = {};
  for (let r = 0; r < COLS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = grid[r]?.[c];
      if (!isRoad(t)) continue;
      const key = `${r},${c}`;
      const lanes = laneCount(t);
      const infra = infraGrid[r]?.[c];
      nodes[key] = {
        r, c, type: t, base: baseType(t), lanes,
        px: c * CELL + CELL / 2, py: r * CELL + CELL / 2,
        infra, neighbors: [],
      };
    }
  }
  for (const k in nodes) {
    const { r, c, base } = nodes[k];
    const try_ = (dr, dc) => { const nk = `${r + dr},${c + dc}`; if (nodes[nk]) nodes[k].neighbors.push(nk); };
    if (base === "road_h" || base === "crossing" || base === "roundabout") { try_(0, -1); try_(0, 1); }
    if (base === "road_v" || base === "crossing" || base === "roundabout") { try_(-1, 0); try_(1, 0); }
    if (base === "roundabout") { try_(-1, -1); try_(-1, 1); try_(1, -1); try_(1, 1); }
  }
  return nodes;
}

function edgeNodes(nodes) {
  return Object.keys(nodes).filter(k => {
    const n = nodes[k];
    return n.neighbors.length <= 1 || n.r === 0 || n.c === 0 || n.r === COLS - 1 || n.c === COLS - 1;
  });
}

function findPath(nodes, edges, rand) {
  if (edges.length < 2) return null;
  const start = edges[Math.floor(rand() * edges.length)];
  const visited = new Set([start]);
  const queue = [[start, [start]]];
  while (queue.length) {
    const [cur, path] = queue.shift();
    const n = nodes[cur];
    if (!n) continue;
    const nb = [...n.neighbors].sort(() => rand() - 0.5);
    for (const next of nb) {
      if (visited.has(next)) continue;
      visited.add(next);
      const np = [...path, next];
      if (edges.includes(next) && np.length > 2) return np;
      queue.push([next, np]);
    }
  }
  return null;
}

function trafficVolume(h, dayIdx) {
  const wknd = dayIdx >= 5;
  const base = wknd ? 0.3 : 0.5;
  const am = Math.exp(-((h - 8) ** 2) / 3.5) * (wknd ? 0.25 : 0.95);
  const pm = Math.exp(-((h - 17.5) ** 2) / 4.5) * (wknd ? 0.35 : 1.0);
  const lunch = Math.exp(-((h - 12.5) ** 2) / 3) * 0.25;
  const night = (h < 5 || h > 22) ? -0.2 : 0;
  return Math.max(0.04, Math.min(1, base + am + pm + lunch + night));
}

function runSimulation(grid, infraGrid, config) {
  const { weatherWeek, seed: s, trafficDensity, lightFailRate, visibilityWeight,
    aggressionMod, speedMod, distractionMod, laneChangeFactor } = config;
  const rand = rng(s);
  const nodes = buildGraph(grid, infraGrid);
  const edges = edgeNodes(nodes);
  const allKeys = Object.keys(nodes);
  if (allKeys.length < 3) return { days: [], incidents: [], heatmap: {}, hourlyTotals: Array(24).fill(0), nodes };

  const allIncidents = [];
  const heatmap = {};
  const dayResults = [];
  const hourlyTotals = Array(24).fill(0);

  for (let d = 0; d < 7; d++) {
    const weather = weatherWeek[d];
    const dayInc = [];

    for (let h = 0; h < 24; h++) {
      const vol = trafficVolume(h, d) * trafficDensity;
      const numAgents = Math.floor(vol * 22 + rand() * 10);
      const agents = [];

      for (let a = 0; a < numAgents; a++) {
        const prof = AGENT_PROFILES[Math.floor(rand() * AGENT_PROFILES.length)];
        const path = findPath(nodes, edges, rand);
        if (path) {
          agents.push({
            ...prof,
            speed: prof.baseSpeed * speedMod * (0.7 + rand() * 0.6),
            aggression: Math.min(1, prof.aggression * aggressionMod),
            distraction: Math.min(1, prof.distraction * distractionMod),
            path,
          });
        }
      }

      const occ = {};
      agents.forEach((ag) => {
        const step = Math.min(Math.floor(rand() * ag.path.length), ag.path.length - 1);
        const nk = ag.path[step];
        if (!occ[nk]) occ[nk] = [];
        occ[nk].push(ag);
      });

      for (const nk in occ) {
        if (occ[nk].length < 2) continue;
        const node = nodes[nk];
        if (!node) continue;
        const group = occ[nk];

        for (let i = 0; i < group.length - 1; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a1 = group[i], a2 = group[j];

            const speedRisk = ((a1.speed + a2.speed) * speedMod) / 4;
            const cautionRisk = 1 - (a1.caution * a2.caution);
            const aggrRisk = (a1.aggression + a2.aggression) / 2;
            const distractRisk = Math.max(a1.distraction, a2.distraction);
            const weatherRisk = weather.risk;
            const visRisk = 1 + (1 - weather.vis) * visibilityWeight;
            const darkRisk = (h < 6 || h > 21) ? 1.35 : 1.0;

            let junctionRisk = 1.0;
            if (node.base === "roundabout") junctionRisk = 1.4;
            else if (node.base === "crossing") junctionRisk = 1.6;

            const laneRisk = 1 + (node.lanes - 1) * 0.2 * laneChangeFactor;

            let infraMod = 1.0;
            let lightFailed = false;
            if (node.infra === "traffic_light") {
              const working = rand() > lightFailRate;
              if (working) { infraMod = 0.4; } else { infraMod = 2.2; lightFailed = true; }
            } else if (node.infra === "speed_bump") {
              infraMod = 0.55;
            } else if (node.infra === "yield_sign") {
              infraMod = 0.65;
            }

            const prob = 0.06 * speedRisk * cautionRisk * (1 + aggrRisk) * (1 + distractRisk * 0.5) *
              weatherRisk * visRisk * darkRisk * junctionRisk * laneRisk * infraMod * 0.35;

            if (rand() < prob) {
              const inc = pickWeighted(INCIDENT_TYPES, "weight", rand);
              const incident = {
                id: `${d}-${h}-${allIncidents.length}`,
                day: d, hour: h,
                ...inc,
                agent1: a1.name, agent2: a2.name,
                nodeKey: nk, px: node.px, py: node.py,
                nodeType: node.base, lanes: node.lanes,
                infra: node.infra || "none",
                weather: weather.name,
                lightFailed,
              };
              dayInc.push(incident);
              allIncidents.push(incident);
              heatmap[nk] = (heatmap[nk] || 0) + inc.severity;
              hourlyTotals[h]++;
            }
          }
        }
      }
    }
    dayResults.push({ day: DAYS[d], dayIndex: d, weather, incidents: dayInc });
  }

  return { days: dayResults, incidents: allIncidents, heatmap, hourlyTotals, nodes };
}

// ─── PRESETS ───
function emptyGrid() { return Array.from({ length: COLS }, () => Array(COLS).fill(null)); }
function emptyInfra() { return Array.from({ length: COLS }, () => Array(COLS).fill(null)); }

function preset(type) {
  const g = emptyGrid();
  const inf = emptyInfra();
  const mid = Math.floor(COLS / 2);
  if (type === "roundabout") {
    for (let d = -2; d <= 2; d++)
      for (let e = -2; e <= 2; e++)
        if (d * d + e * e <= 7 && mid + d >= 0 && mid + d < COLS && mid + e >= 0 && mid + e < COLS)
          g[mid + d][mid + e] = "roundabout_m";
    for (let i = 0; i < mid - 3; i++) { g[mid][i] = "road_h2"; g[mid][COLS - 1 - i] = "road_h2"; g[mid - 1][i] = "road_h2"; g[mid - 1][COLS - 1 - i] = "road_h2"; }
    for (let i = 0; i < mid - 3; i++) { g[i][mid] = "road_v2"; g[COLS - 1 - i][mid] = "road_v2"; g[i][mid + 1] = "road_v2"; g[COLS - 1 - i][mid + 1] = "road_v2"; }
    inf[mid - 3][mid] = "traffic_light"; inf[mid + 3][mid] = "traffic_light";
    inf[mid][mid - 3] = "traffic_light"; inf[mid][mid + 3] = "traffic_light";
  } else if (type === "highway_cross") {
    for (let i = 0; i < COLS; i++) {
      g[mid - 1][i] = "road_h3"; g[mid][i] = "road_h3"; g[mid + 1][i] = "road_h3";
      g[i][mid - 1] = "road_v3"; g[i][mid] = "road_v3"; g[i][mid + 1] = "road_v3";
    }
    for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) g[mid + d][mid + e] = "crossing";
    inf[mid - 2][mid] = "traffic_light"; inf[mid + 2][mid] = "traffic_light";
    inf[mid][mid - 2] = "traffic_light"; inf[mid][mid + 2] = "traffic_light";
  } else if (type === "complex") {
    const m1 = mid - 6, m2 = mid + 6;
    for (let d = -1; d <= 1; d++) for (let e = -1; e <= 1; e++) {
      if (d * d + e * e <= 2) { g[mid + d][m1 + e] = "roundabout_s"; g[mid + d][m2 + e] = "roundabout_s"; }
    }
    for (let i = 0; i < COLS; i++) g[mid][i] = g[mid][i] || "road_h2";
    for (let i = 0; i < COLS; i++) { g[i][m1] = g[i][m1] || "road_v1"; g[i][m2] = g[i][m2] || "road_v1"; g[i][mid] = g[i][mid] || "road_v2"; }
    g[mid][mid] = "crossing";
    inf[mid - 1][mid] = "traffic_light"; inf[mid + 1][mid] = "traffic_light";
    inf[mid][m1 + 2] = "yield_sign"; inf[mid][m2 - 2] = "yield_sign";
    inf[mid][m1 - 2] = "speed_bump"; inf[mid][m2 + 2] = "speed_bump";
  } else if(type == "Srodka") {
    const m1 = mid - 6, m2 = mid - + 6;
  }
  return { g, inf };
}

// ─── THEME ───
const T = {
  bg: "#0B0D12", s1: "#11141C", s2: "#181C28", s3: "#1F2435",
  brd: "#262D3F", brdHi: "#3A4462",
  txt: "#D8DCE8", dim: "#5E6888", accent: "#E8A225", accentDim: "#7A5610",
  danger: "#EF4444", safe: "#22C55E", blue: "#3B82F6",
  road: "#2A3045", roadMark: "#454F6B", rb: "#1A2E50", grass: "#0D150E",
};

// ─── SLIDER COMPONENT ───
function Slider({ label, value, onChange, min = 0, max = 2, step = 0.05, info }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: T.dim }}>{label} {info && <span title={info} style={{ cursor: "help", opacity: 0.6 }}>ⓘ</span>}</span>
        <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: T.accent, fontWeight: 700 }}>{value.toFixed(2)}</span>
      </div>
      <div style={{ position: "relative", height: 18, display: "flex", alignItems: "center" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: 4, background: T.s2, borderRadius: 2 }} />
        <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, background: `linear-gradient(90deg, ${T.accentDim}, ${T.accent})`, borderRadius: 2 }} />
        <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position: "absolute", width: "100%", height: 18, opacity: 0, cursor: "pointer", zIndex: 2 }} />
        <div style={{
          position: "absolute", left: `calc(${pct}% - 7px)`, width: 14, height: 14,
          background: T.accent, borderRadius: "50%", border: `2px solid ${T.bg}`,
          boxShadow: `0 0 6px ${T.accentDim}`, pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}

// ─── MINI BAR ───
function Bar({ val, max, color, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, fontSize: 11 }}>
      <span style={{ width: 28, textAlign: "right", fontFamily: "JetBrains Mono", color: T.dim }}>{val}</span>
      <div style={{ flex: 1, height: 8, background: T.s1, borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, (val / Math.max(max, 1)) * 100)}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.3s" }} />
      </div>
      <span style={{ width: 80, color: T.dim, fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}

// ─── CANVAS ───
function Canvas({ grid, infraGrid, setGrid, setInfraGrid, tool, simResult, showHeatmap, selDay }) {
  const ref = useRef(null);
  const [painting, setPainting] = useState(false);

  const getCell = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const scale = GRID_PX / rect.width;
    return { c: Math.floor(((e.clientX - rect.left) * scale) / CELL), r: Math.floor(((e.clientY - rect.top) * scale) / CELL) };
  };

  const paint = (e) => {
    const { r, c } = getCell(e);
    if (r < 0 || r >= COLS || c < 0 || c >= COLS) return;
    if (tool === "eraser") {
      setGrid(p => { const n = p.map(x => [...x]); n[r][c] = null; return n; });
      setInfraGrid(p => { const n = p.map(x => [...x]); n[r][c] = null; return n; });
    } else if (isInfra(tool)) {
      setInfraGrid(p => { const n = p.map(x => [...x]); n[r][c] = tool; return n; });
    } else if (tool.startsWith("roundabout")) {
      const sz = tool === "roundabout_s" ? 1 : tool === "roundabout_m" ? 2 : 3;
      setGrid(p => {
        const n = p.map(x => [...x]);
        for (let dr = -sz; dr <= sz; dr++)
          for (let dc = -sz; dc <= sz; dc++)
            if (dr * dr + dc * dc <= sz * sz + sz && r + dr >= 0 && r + dr < COLS && c + dc >= 0 && c + dc < COLS)
              n[r + dr][c + dc] = tool;
        return n;
      });
    } else {
      setGrid(p => { const n = p.map(x => [...x]); n[r][c] = tool; return n; });
    }
  };

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    cv.width = GRID_PX * dpr; cv.height = GRID_PX * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = T.grass; ctx.fillRect(0, 0, GRID_PX, GRID_PX);
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let r = 0; r < COLS; r++) for (let c = 0; c < COLS; c++) ctx.fillRect(c * CELL + CELL / 2 - 0.4, r * CELL + CELL / 2 - 0.4, 0.8, 0.8);

    for (let r = 0; r < COLS; r++) {
      for (let c = 0; c < COLS; c++) {
        const t = grid[r][c]; if (!t) continue;
        const x = c * CELL, y = r * CELL;
        const bt = baseType(t);
        const lanes = laneCount(t);

        if (bt === "roundabout") {
          ctx.fillStyle = T.rb;
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 2 + 1, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = T.roadMark; ctx.lineWidth = 0.7;
          ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 4, 0, Math.PI * 2); ctx.stroke();
          if (lanes >= 2) { ctx.beginPath(); ctx.arc(x + CELL / 2, y + CELL / 2, CELL / 3, 0, Math.PI * 2); ctx.stroke(); }
        } else if (bt === "crossing") {
          ctx.fillStyle = T.road; ctx.fillRect(x, y, CELL, CELL);
          ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 0.6; ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4); ctx.setLineDash([]);
        } else {
          ctx.fillStyle = T.road; ctx.fillRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
          ctx.setLineDash([3, 3]);
          if (bt === "road_h") {
            for (let l = 1; l < lanes; l++) {
              const ly = y + (l / lanes) * CELL;
              ctx.strokeStyle = T.roadMark; ctx.lineWidth = 0.5;
              ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x + CELL, ly); ctx.stroke();
            }
            ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(x, y + CELL / 2); ctx.lineTo(x + CELL, y + CELL / 2); ctx.stroke();
          } else {
            for (let l = 1; l < lanes; l++) {
              const lx = x + (l / lanes) * CELL;
              ctx.strokeStyle = T.roadMark; ctx.lineWidth = 0.5;
              ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx, y + CELL); ctx.stroke();
            }
            ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 0.8;
            ctx.beginPath(); ctx.moveTo(x + CELL / 2, y); ctx.lineTo(x + CELL / 2, y + CELL); ctx.stroke();
          }
          ctx.setLineDash([]);
        }

        const inf = infraGrid[r][c];
        if (inf === "traffic_light") {
          ctx.fillStyle = "#111"; ctx.fillRect(x + CELL / 2 - 4, y + 2, 8, 16);
          ctx.fillStyle = "#dc2626"; ctx.beginPath(); ctx.arc(x + CELL / 2, y + 5, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#facc15"; ctx.beginPath(); ctx.arc(x + CELL / 2, y + 10, 2.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#16a34a"; ctx.beginPath(); ctx.arc(x + CELL / 2, y + 15, 2.5, 0, Math.PI * 2); ctx.fill();
        } else if (inf === "speed_bump") {
          ctx.fillStyle = "#f97316"; ctx.fillRect(x + 3, y + CELL / 2 - 2, CELL - 6, 4);
          ctx.fillStyle = "#fff";
          for (let b = 0; b < 3; b++) ctx.fillRect(x + 5 + b * 4, y + CELL / 2 - 1, 2, 2);
        } else if (inf === "yield_sign") {
          ctx.fillStyle = "#facc15";
          ctx.beginPath(); ctx.moveTo(x + CELL / 2, y + 3); ctx.lineTo(x + CELL - 3, y + CELL - 3); ctx.lineTo(x + 3, y + CELL - 3); ctx.closePath(); ctx.fill();
          ctx.fillStyle = "#000"; ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", x + CELL / 2, y + CELL - 5);
        }
      }
    }

    if (showHeatmap && simResult) {
      const maxH = Math.max(1, ...Object.values(simResult.heatmap));
      for (const k in simResult.heatmap) {
        const [r, c] = k.split(",").map(Number);
        const intensity = simResult.heatmap[k] / maxH;
        const cx = c * CELL + CELL / 2, cy = r * CELL + CELL / 2;
        const radius = 10 + intensity * 28;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(0, `rgba(239,68,68,${0.25 + intensity * 0.55})`);
        grad.addColorStop(0.6, `rgba(239,68,68,${intensity * 0.2})`);
        grad.addColorStop(1, `rgba(239,68,68,0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill();
      }
    }

    if (simResult) {
      const incs = selDay === -1 ? simResult.incidents : simResult.incidents.filter(i => i.day === selDay);
      incs.forEach(inc => {
        ctx.globalAlpha = 0.85; ctx.fillStyle = inc.color;
        ctx.beginPath(); ctx.arc(inc.px, inc.py + (Math.sin(inc.id.length) * 3), 2.5 + inc.severity, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.arc(inc.px, inc.py, 6 + inc.severity * 3, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      });
    }
  }, [grid, infraGrid, simResult, showHeatmap, selDay]);

  return (
    <canvas ref={ref}
      style={{ width: "100%", maxWidth: GRID_PX, aspectRatio: "1", cursor: "crosshair", borderRadius: 8, border: `1px solid ${T.brd}` }}
      onMouseDown={e => { setPainting(true); paint(e); }}
      onMouseMove={e => painting && paint(e)}
      onMouseUp={() => setPainting(false)}
      onMouseLeave={() => setPainting(false)}
    />
  );
}

function Tab({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", fontSize: 11, fontFamily: "JetBrains Mono",
      background: active ? T.accent : "transparent", color: active ? T.bg : T.dim,
      border: `1px solid ${active ? T.accent : T.brd}`, borderRadius: 4, cursor: "pointer", fontWeight: active ? 700 : 400,
    }}>{children}</button>
  );
}

function HourChart({ data }) {
  const max = Math.max(1, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 1.5, height: 70, padding: "4px 0" }}>
      {data.map((v, h) => (
        <div key={h} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{
            width: "100%", maxWidth: 14,
            height: `${Math.max(1, (v / max) * 56)}px`,
            background: v > 0 ? `linear-gradient(to top, ${T.accent}, ${T.danger})` : T.s2,
            borderRadius: "2px 2px 0 0", transition: "height 0.3s",
          }} />
          {h % 6 === 0 && <span style={{ fontSize: 8, color: T.dim, marginTop: 1 }}>{h}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── MAIN APP ───
export default function App() {
  const [grid, setGrid] = useState(() => preset("roundabout").g);
  const [infraGrid, setInfraGrid] = useState(() => preset("roundabout").inf);
  const [tool, setTool] = useState("road_h2");
  const [mode, setMode] = useState("build");
  const [simResult, setSimResult] = useState(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [selDay, setSelDay] = useState(-1);
  const [rightTab, setRightTab] = useState("config");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const [seed, setSeed] = useState(42);
  const [trafficDensity, setTrafficDensity] = useState(1.0);
  const [lightFailRate, setLightFailRate] = useState(0.05);
  const [visibilityWeight, setVisibilityWeight] = useState(1.0);
  const [aggressionMod, setAggressionMod] = useState(1.0);
  const [speedMod, setSpeedMod] = useState(1.0);
  const [distractionMod, setDistractionMod] = useState(1.0);
  const [laneChangeFactor, setLaneChangeFactor] = useState(1.0);
  const [weatherWeek, setWeatherWeek] = useState(() => DAYS.map(() => WEATHER_OPTS[0]));

  const totalCells = useMemo(() => { let c = 0; grid.forEach(r => r.forEach(v => { if (v) c++; })); return c; }, [grid]);
  const infraCount = useMemo(() => {
    let lights = 0, bumps = 0, yields = 0;
    infraGrid.forEach(r => r.forEach(v => { if (v === "traffic_light") lights++; if (v === "speed_bump") bumps++; if (v === "yield_sign") yields++; }));
    return { lights, bumps, yields };
  }, [infraGrid]);

  const runSim = useCallback(() => {
    setRunning(true); setProgress(0);
    let p = 0;
    const iv = setInterval(() => {
      p += 4 + Math.random() * 12;
      if (p >= 100) {
        clearInterval(iv); p = 100;
        const res = runSimulation(grid, infraGrid, { weatherWeek, seed, trafficDensity, lightFailRate, visibilityWeight, aggressionMod, speedMod, distractionMod, laneChangeFactor });
        setSimResult(res); setRunning(false); setMode("sim"); setRightTab("overview");
      }
      setProgress(Math.min(100, Math.floor(p)));
    }, 50);
  }, [grid, infraGrid, weatherWeek, seed, trafficDensity, lightFailRate, visibilityWeight, aggressionMod, speedMod, distractionMod, laneChangeFactor]);

  const fInc = useMemo(() => simResult ? (selDay === -1 ? simResult.incidents : simResult.incidents.filter(i => i.day === selDay)) : [], [simResult, selDay]);
  const sevCounts = useMemo(() => { const c = {}; INCIDENT_TYPES.forEach(t => c[t.type] = 0); fInc.forEach(i => c[i.type]++); return c; }, [fInc]);
  const agentCounts = useMemo(() => { const c = {}; AGENT_PROFILES.forEach(a => c[a.name] = 0); fInc.forEach(i => { c[i.agent1]++; c[i.agent2]++; }); return c; }, [fInc]);
  const infraIncCount = useMemo(() => { const c = { traffic_light: 0, speed_bump: 0, yield_sign: 0, none: 0 }; fInc.forEach(i => c[i.infra]++); return c; }, [fInc]);
  const lightFailCount = useMemo(() => fInc.filter(i => i.lightFailed).length, [fInc]);
  const hourData = useMemo(() => { const h = Array(24).fill(0); fInc.forEach(i => h[i.hour]++); return h; }, [fInc]);
  const dayTotals = useMemo(() => simResult ? simResult.days.map(d => d.incidents.length) : Array(7).fill(0), [simResult]);
  const maxDay = Math.max(1, ...dayTotals);

  const loadPreset = (type) => { const p = preset(type); setGrid(p.g); setInfraGrid(p.inf); setSimResult(null); setMode("build"); };

  const P = { background: T.s1, borderRadius: 8, border: `1px solid ${T.brd}`, padding: 14, marginBottom: 12 };
  const H = { fontFamily: "JetBrains Mono", fontSize: 12, fontWeight: 700, color: T.accent, marginBottom: 10 };

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.txt, fontFamily: "'DM Sans', sans-serif", padding: "16px 20px" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=DM+Sans:wght@400;500;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: ${T.s1}; } ::-webkit-scrollbar-thumb { background: ${T.brd}; border-radius: 2px; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        .fi { animation: fadeIn 0.3s ease-out; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${T.brd}` }}>
        <div>
          <h1 style={{ fontFamily: "JetBrains Mono", fontSize: 18, fontWeight: 700, letterSpacing: "-0.5px" }}>
            <span style={{ color: T.accent }}>◉</span> Intersection Incident Lab
          </h1>
          <p style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>Build → Configure → Simulate → Analyse</p>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => setMode("build")} style={{ padding: "6px 14px", fontSize: 11, fontFamily: "JetBrains Mono", background: mode === "build" ? T.accent : T.s2, color: mode === "build" ? T.bg : T.txt, border: `1px solid ${mode === "build" ? T.accent : T.brd}`, borderRadius: 5, cursor: "pointer", fontWeight: mode === "build" ? 700 : 400 }}>✎ Build</button>
          <button onClick={() => totalCells > 4 && runSim()} disabled={running || totalCells < 5}
            style={{ padding: "6px 14px", fontSize: 11, fontFamily: "JetBrains Mono", background: running ? T.s2 : "#14532d", color: "#fff", border: "1px solid #16a34a", borderRadius: 5, cursor: totalCells < 5 ? "not-allowed" : "pointer" }}>
            {running ? `⏳ ${progress}%` : "▶ Simulate Week"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 500px", minWidth: 320 }}>
          {mode === "build" && (
            <div className="fi" style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 4, fontFamily: "JetBrains Mono" }}>ROADS</div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6 }}>
                {TOOLS.filter(t => t.cat === "road").map(t => (
                  <button key={t.id} onClick={() => setTool(t.id)}
                    style={{ padding: "4px 8px", fontSize: 10, fontFamily: "JetBrains Mono", background: tool === t.id ? T.accent : T.s2, color: tool === t.id ? T.bg : T.txt, border: `1px solid ${tool === t.id ? T.accent : T.brd}`, borderRadius: 4, cursor: "pointer", fontWeight: tool === t.id ? 700 : 400, whiteSpace: "nowrap" }}>{t.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 4, fontFamily: "JetBrains Mono" }}>JUNCTIONS</div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6 }}>
                {TOOLS.filter(t => t.cat === "junction").map(t => (
                  <button key={t.id} onClick={() => setTool(t.id)}
                    style={{ padding: "4px 8px", fontSize: 10, fontFamily: "JetBrains Mono", background: tool === t.id ? T.accent : T.s2, color: tool === t.id ? T.bg : T.txt, border: `1px solid ${tool === t.id ? T.accent : T.brd}`, borderRadius: 4, cursor: "pointer", fontWeight: tool === t.id ? 700 : 400, whiteSpace: "nowrap" }}>{t.label}</button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: T.dim, marginBottom: 4, fontFamily: "JetBrains Mono" }}>INFRASTRUCTURE</div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 6 }}>
                {TOOLS.filter(t => t.cat === "infra" || t.cat === "tool").map(t => (
                  <button key={t.id} onClick={() => setTool(t.id)}
                    style={{ padding: "4px 8px", fontSize: 10, fontFamily: "JetBrains Mono", background: tool === t.id ? (t.id === "eraser" ? T.danger : T.accent) : T.s2, color: tool === t.id ? T.bg : T.txt, border: `1px solid ${tool === t.id ? (t.id === "eraser" ? T.danger : T.accent) : T.brd}`, borderRadius: 4, cursor: "pointer", fontWeight: tool === t.id ? 700 : 400, whiteSpace: "nowrap" }}>{t.label}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                <span style={{ fontSize: 10, color: T.dim, lineHeight: "24px" }}>Presets:</span>
                {[["roundabout", "Roundabout"], ["highway_cross", "Highway ╋"], ["complex", "Complex"]].map(([k, l]) => (
                  <button key={k} onClick={() => loadPreset(k)} style={{ padding: "3px 8px", fontSize: 10, fontFamily: "JetBrains Mono", background: T.s2, color: T.txt, border: `1px solid ${T.brd}`, borderRadius: 4, cursor: "pointer" }}>{l}</button>
                ))}
                <button onClick={() => { setGrid(emptyGrid()); setInfraGrid(emptyInfra()); setSimResult(null); }} style={{ padding: "3px 8px", fontSize: 10, fontFamily: "JetBrains Mono", background: T.s2, color: T.danger, border: `1px solid ${T.brd}`, borderRadius: 4, cursor: "pointer" }}>Clear All</button>
              </div>
            </div>
          )}

          {mode === "sim" && simResult && (
            <div className="fi" style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
              <Tab active={selDay === -1} onClick={() => setSelDay(-1)}>All</Tab>
              {DAYS.map((d, i) => <Tab key={d} active={selDay === i} onClick={() => setSelDay(i)}>{weatherWeek[i].icon}{d}</Tab>)}
              <label style={{ fontSize: 10, color: T.dim, display: "flex", alignItems: "center", gap: 4, marginLeft: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} /> Heatmap
              </label>
            </div>
          )}

          <Canvas grid={grid} infraGrid={infraGrid} setGrid={setGrid} setInfraGrid={setInfraGrid} tool={tool} simResult={mode === "sim" ? simResult : null} showHeatmap={showHeatmap} selDay={selDay} />

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.dim, fontFamily: "JetBrains Mono", marginTop: 5 }}>
            <span>{totalCells} tiles · 🚦{infraCount.lights} · ▬{infraCount.bumps} · △{infraCount.yields}</span>
            {totalCells < 5 && <span style={{ color: T.accent }}>Place 5+ tiles to simulate</span>}
          </div>
        </div>

        <div style={{ flex: "1 1 310px", minWidth: 270, maxWidth: 400 }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 10, flexWrap: "wrap" }}>
            {(mode === "build"
              ? [["config", "⚙ Config"], ["weather", "⛅ Weather"], ["agents", "🤖 Agents"]]
              : [["overview", "📊 Overview"], ["detail", "📋 Detail"], ["log", "📝 Log"]]
            ).map(([k, l]) => (
              <Tab key={k} active={rightTab === k} onClick={() => setRightTab(k)}>{l}</Tab>
            ))}
          </div>

          {mode === "build" && rightTab === "config" && (
            <div className="fi" style={P}>
              <h3 style={H}>⚙ Simulation Parameters</h3>
              <Slider label="Traffic Density" value={trafficDensity} onChange={setTrafficDensity} min={0.2} max={3} info="Multiplier on base traffic volume per hour" />
              <Slider label="Speed Multiplier" value={speedMod} onChange={setSpeedMod} min={0.3} max={2.5} info="Scales all agent speeds" />
              <Slider label="Aggression Mod" value={aggressionMod} onChange={setAggressionMod} min={0.1} max={3} info="Scales agent aggression behavior" />
              <Slider label="Distraction Mod" value={distractionMod} onChange={setDistractionMod} min={0.1} max={3} info="Phone use, inattention, etc." />
              <Slider label="Lane-Change Risk" value={laneChangeFactor} onChange={setLaneChangeFactor} min={0} max={3} info="Extra risk per additional lane" />
              <Slider label="Visibility Impact" value={visibilityWeight} onChange={setVisibilityWeight} min={0} max={3} info="How much weather visibility affects risk" />
              <Slider label="🚦 Light Fail Rate" value={lightFailRate} onChange={setLightFailRate} min={0} max={0.5} step={0.01} info="Probability traffic light malfunctions" />
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: T.dim }}>Random Seed</label>
                <input type="number" value={seed} onChange={e => setSeed(Number(e.target.value))}
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "5px 8px", background: T.s2, border: `1px solid ${T.brd}`, borderRadius: 4, color: T.txt, fontFamily: "JetBrains Mono", fontSize: 12 }} />
              </div>
            </div>
          )}

          {mode === "build" && rightTab === "weather" && (
            <div className="fi" style={P}>
              <h3 style={H}>⛅ Weekly Weather</h3>
              {DAYS.map((d, i) => (
                <div key={d} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{ width: 28, fontSize: 11, fontFamily: "JetBrains Mono", color: T.dim }}>{d}</span>
                  <div style={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                    {WEATHER_OPTS.map(w => (
                      <button key={w.name} onClick={() => setWeatherWeek(p => { const n = [...p]; n[i] = w; return n; })}
                        title={`${w.name} (×${w.risk} risk, ${(w.vis * 100).toFixed(0)}% vis)`}
                        style={{
                          padding: "2px 5px", fontSize: 11, cursor: "pointer",
                          background: weatherWeek[i].name === w.name ? T.accent : T.s2,
                          color: weatherWeek[i].name === w.name ? T.bg : T.txt,
                          border: `1px solid ${weatherWeek[i].name === w.name ? T.accent : T.brd}`,
                          borderRadius: 3,
                        }}>{w.icon}</button>
                    ))}
                  </div>
                  <span style={{ fontSize: 9, color: T.dim, fontFamily: "JetBrains Mono" }}>×{weatherWeek[i].risk}</span>
                </div>
              ))}
              <div style={{ marginTop: 8, padding: 8, background: T.s2, borderRadius: 5, fontSize: 10, color: T.dim, lineHeight: 1.5 }}>
                Weather modifies both <b style={{ color: T.txt }}>risk</b> (grip, braking) and <b style={{ color: T.txt }}>visibility</b> (sight lines, reaction time). Ice is most dangerous at ×2.5 risk.
              </div>
            </div>
          )}

          {mode === "build" && rightTab === "agents" && (
            <div className="fi" style={P}>
              <h3 style={H}>🤖 AI Agent Profiles</h3>
              <div style={{ maxHeight: 460, overflow: "auto" }}>
                {AGENT_PROFILES.map(a => (
                  <div key={a.name} style={{ padding: "8px 10px", background: T.s2, borderRadius: 6, marginBottom: 6, borderLeft: `3px solid ${a.color}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{a.icon} {a.name}</span>
                      <span style={{ fontSize: 10, color: T.dim, fontFamily: "JetBrains Mono" }}>spd {a.baseSpeed}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 5, fontSize: 10, color: T.dim }}>
                      <span>AGG <b style={{ color: a.aggression > 0.4 ? T.danger : T.safe }}>{a.aggression.toFixed(2)}</b></span>
                      <span>CAU <b style={{ color: a.caution > 0.6 ? T.safe : T.danger }}>{a.caution.toFixed(2)}</b></span>
                      <span>DST <b style={{ color: a.distraction > 0.3 ? T.danger : T.safe }}>{a.distraction.toFixed(2)}</b></span>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 10, color: T.dim, marginTop: 8, lineHeight: 1.5 }}>
                Risk = f(speed, aggression, caution, distraction, weather, visibility, darkness, junction, lanes, infrastructure). All sliders in Config tab scale these base values.
              </p>
            </div>
          )}

          {mode === "sim" && simResult && rightTab === "overview" && (
            <div className="fi">
              <div style={P}>
                <h3 style={H}>📊 {selDay === -1 ? "Week Summary" : `${DAYS[selDay]} ${weatherWeek[selDay]?.icon}`}</h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
                  {[[fInc.length, "Total", T.accent], [fInc.filter(i => i.severity >= 4).length, "Severe", T.danger], [lightFailCount, "🚦 Fail", "#F97316"]].map(([v, l, c]) => (
                    <div key={l} style={{ background: T.s2, borderRadius: 6, padding: 10, textAlign: "center" }}>
                      <div style={{ fontSize: 24, fontFamily: "JetBrains Mono", fontWeight: 700, color: c }}>{v}</div>
                      <div style={{ fontSize: 9, color: T.dim, marginTop: 2 }}>{l}</div>
                    </div>
                  ))}
                </div>
                <h4 style={{ fontSize: 11, color: T.dim, fontFamily: "JetBrains Mono", marginBottom: 4 }}>By Hour</h4>
                <HourChart data={hourData} />
                {selDay === -1 && <>
                  <h4 style={{ fontSize: 11, color: T.dim, fontFamily: "JetBrains Mono", marginBottom: 4, marginTop: 8 }}>By Day</h4>
                  <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 50 }}>
                    {dayTotals.map((v, i) => (
                      <div key={i} onClick={() => setSelDay(i)} style={{ flex: 1, cursor: "pointer", textAlign: "center" }}>
                        <div style={{ height: `${Math.max(2, (v / maxDay) * 40)}px`, background: T.accent, borderRadius: "2px 2px 0 0", transition: "height 0.3s" }} />
                        <div style={{ fontSize: 8, color: T.dim, marginTop: 2 }}>{DAYS[i]}</div>
                      </div>
                    ))}
                  </div>
                </>}
              </div>
              <div style={P}>
                <h3 style={{ ...H, fontSize: 11 }}>By Severity</h3>
                {INCIDENT_TYPES.map(t => <Bar key={t.type} val={sevCounts[t.type]} max={Math.max(1, ...Object.values(sevCounts))} color={t.color} label={t.type} />)}
              </div>
              <div style={P}>
                <h3 style={{ ...H, fontSize: 11 }}>Agent Involvement</h3>
                {AGENT_PROFILES.map(a => <Bar key={a.name} val={agentCounts[a.name]} max={Math.max(1, ...Object.values(agentCounts))} color={a.color} label={`${a.icon} ${a.name}`} />)}
              </div>
            </div>
          )}

          {mode === "sim" && simResult && rightTab === "detail" && (
            <div className="fi">
              <div style={P}>
                <h3 style={H}>🏗️ By Infrastructure</h3>
                {[["traffic_light", "🚦 Traffic Light", T.safe], ["speed_bump", "▬ Speed Bump", "#F97316"], ["yield_sign", "△ Yield Sign", "#FBBF24"], ["none", "— No Infra", T.dim]].map(([k, l, c]) => (
                  <Bar key={k} val={infraIncCount[k]} max={Math.max(1, ...Object.values(infraIncCount))} color={c} label={l} />
                ))}
                <div style={{ marginTop: 8, padding: 8, background: T.s2, borderRadius: 5, fontSize: 10, color: T.dim, borderLeft: `3px solid ${T.danger}` }}>
                  <b style={{ color: T.danger }}>{lightFailCount}</b> incidents during light malfunction ({(lightFailRate * 100).toFixed(1)}% fail rate)
                </div>
              </div>
              <div style={P}>
                <h3 style={H}>🛣️ By Lane Count</h3>
                {[1, 2, 3].map(l => {
                  const cnt = fInc.filter(i => i.lanes === l).length;
                  return <Bar key={l} val={cnt} max={Math.max(1, fInc.length)} color={l === 3 ? T.danger : l === 2 ? T.accent : T.blue} label={`${l}-lane`} />;
                })}
              </div>
              <div style={P}>
                <h3 style={H}>🌤️ By Weather</h3>
                {WEATHER_OPTS.map(w => {
                  const cnt = fInc.filter(i => i.weather === w.name).length;
                  return cnt > 0 ? <Bar key={w.name} val={cnt} max={Math.max(1, fInc.length)} color={w.risk > 1.5 ? T.danger : T.accent} label={`${w.icon} ${w.name}`} /> : null;
                })}
              </div>
              <div style={P}>
                <h3 style={H}>⚔️ Top Conflict Pairs</h3>
                {(() => {
                  const pairs = {};
                  fInc.forEach(i => { const k = [i.agent1, i.agent2].sort().join(" × "); pairs[k] = (pairs[k] || 0) + 1; });
                  return Object.entries(pairs).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => (
                    <Bar key={k} val={v} max={Math.max(1, ...Object.values(pairs))} color="#E879F9" label={k} />
                  ));
                })()}
              </div>
            </div>
          )}

          {mode === "sim" && simResult && rightTab === "log" && (
            <div className="fi" style={P}>
              <h3 style={H}>📝 Incident Log ({fInc.length})</h3>
              <div style={{ maxHeight: 520, overflow: "auto" }}>
                {fInc.slice(0, 80).map(inc => (
                  <div key={inc.id} style={{ padding: "5px 8px", marginBottom: 3, background: T.s2, borderRadius: 4, borderLeft: `3px solid ${inc.color}`, fontSize: 10, fontFamily: "JetBrains Mono" }}>
                    <div>
                      <span style={{ color: T.dim }}>{DAYS[inc.day]} {String(inc.hour).padStart(2, "0")}:00</span>{" "}
                      <span style={{ color: inc.color, fontWeight: 700 }}>{inc.type}</span>{" "}
                      <span style={{ color: T.dim }}>sev:{inc.severity}</span>
                    </div>
                    <div style={{ color: T.dim, marginTop: 2 }}>
                      {inc.agent1} vs {inc.agent2} · {inc.nodeType} · {inc.lanes}L · {inc.infra !== "none" ? inc.infra.replace("_", " ") : "no infra"}
                      {inc.lightFailed && <span style={{ color: T.danger }}> · 🚦FAIL</span>}
                      {" · "}{inc.weather}
                    </div>
                  </div>
                ))}
                {fInc.length > 80 && <div style={{ fontSize: 9, color: T.dim, padding: 4 }}>+{fInc.length - 80} more</div>}
              </div>
            </div>
          )}

          {mode === "sim" && simResult && (
            <button onClick={() => { setSeed(s => s + 1); setTimeout(runSim, 50); }}
              style={{ width: "100%", padding: "9px", fontSize: 11, fontFamily: "JetBrains Mono", background: "#14532d", color: "#fff", border: "1px solid #16a34a", borderRadius: 6, cursor: "pointer", marginTop: 4 }}>
              🔄 Re-run (seed {seed + 1})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
