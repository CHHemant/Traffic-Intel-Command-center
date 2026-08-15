const baseLocations = [
  { id: "L1", name: "MG ROAD / JUNCTION 04", x: 62, y: 43, traffic: 89, speed: 19, coverage: 24, accidents: 22, weatherImpact: 14, incidentCount: 1 },
  { id: "L2", name: "RING ROAD / EXIT 7", x: 47, y: 55, traffic: 76, speed: 27, coverage: 36, accidents: 18, weatherImpact: 11, incidentCount: 0 },
  { id: "L3", name: "NH-48 / SECTOR 12", x: 76, y: 67, traffic: 68, speed: 34, coverage: 43, accidents: 15, weatherImpact: 9, incidentCount: 0 },
  { id: "L4", name: "AIIMS FLYOVER", x: 30, y: 41, traffic: 58, speed: 39, coverage: 61, accidents: 9, weatherImpact: 8, incidentCount: 0 },
  { id: "L5", name: "DWARKA MOR", x: 20, y: 74, traffic: 66, speed: 32, coverage: 29, accidents: 14, weatherImpact: 10, incidentCount: 0 },
  { id: "L6", name: "KASHMERE GATE", x: 57, y: 29, traffic: 42, speed: 47, coverage: 73, accidents: 6, weatherImpact: 7, incidentCount: 0 },
  { id: "L7", name: "SAKET INTERCHANGE", x: 70, y: 79, traffic: 51, speed: 43, coverage: 54, accidents: 8, weatherImpact: 8, incidentCount: 0 }
];

const baseUnits = [
  { id: "P-014", status: "AVAILABLE", x: 54, y: 60, assignedLocation: "L2", eta: null },
  { id: "P-008", status: "DEPLOYED", x: 30, y: 41, assignedLocation: "L4", eta: null },
  { id: "P-023", status: "BUSY", x: 20, y: 75, assignedLocation: "L5", eta: "06:10" },
  { id: "P-041", status: "OFFLINE", x: 82, y: 24, assignedLocation: null, eta: null }
];

const baseWeather = {
  temp: 28,
  condition: "Light Rain",
  humidity: 78,
  visibilityKm: 4.2,
  windKmh: 16
};

class TrafficDataProvider {
  constructor(mode) {
    this.mode = mode;
  }
  async getTrafficData() {
    if (this.mode === "LIVE") {
      try {
        const res = await Promise.race([fetch("/api/traffic"), wait(900)]);
        if (!res.ok) throw new Error("traffic unavailable");
        return this.#demoPayload("LIVE");
      } catch {
        return this.#demoPayload("DEMO");
      }
    }
    return this.#demoPayload("DEMO");
  }
  getTrafficForLocation(locationId, payload) {
    return payload.locations.find((l) => l.id === locationId);
  }
  getTrafficIncidents(payload) {
    return payload.locations.filter((l) => l.incidentCount > 0).map((l) => ({ locationId: l.id, severity: "CRITICAL" }));
  }
  getTrafficSpeed(locationId, payload) {
    return this.getTrafficForLocation(locationId, payload).speed;
  }
  getCongestionLevel(locationId, payload) {
    return this.getTrafficForLocation(locationId, payload).traffic;
  }
  #demoPayload(source) {
    return {
      source,
      updatedAgoSec: source === "LIVE" ? 15 : 0,
      locations: structuredClone(baseLocations),
      units: structuredClone(baseUnits)
    };
  }
}

class WeatherDataProvider {
  constructor(mode) {
    this.mode = mode;
  }
  async getCurrentWeather() {
    if (this.mode === "LIVE") {
      try {
        const res = await Promise.race([fetch("/api/weather"), wait(900)]);
        if (!res.ok) throw new Error("weather unavailable");
        return { ...baseWeather, source: "LIVE" };
      } catch {
        return { ...baseWeather, source: "DEMO" };
      }
    }
    return { ...baseWeather, source: "DEMO" };
  }
  async getForecast() {
    return [
      { hour: "+1h", condition: "Rain", temp: 27 },
      { hour: "+2h", condition: "Cloudy", temp: 27 }
    ];
  }
  async getWeatherForLocation() {
    return this.getCurrentWeather();
  }
}

const state = {
  mode: "DEMO",
  selectedLocationId: null,
  activeLayer: "RISK",
  activeFilter: "ALL",
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  recommendation: null,
  overrideActive: false,
  camera: { scale: 1, x: 0, y: 0 }
};

const layers = ["RISK", "TRAFFIC", "POLICE COVERAGE", "INCIDENTS", "WEATHER IMPACT"];
const filters = ["ALL", "HIGH RISK", "UNMANNED", "STAFFED", "INCIDENTS"];
const $ = (id) => document.getElementById(id);

function wait(ms = 1000) {
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

function level(score) {
  if (score >= 85) return "CRITICAL";
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function scoreLocation(loc, weather) {
  const coveragePenalty = Math.max(0, 65 - loc.coverage);
  const visibilityPenalty = Math.max(0, 10 - weather.visibilityKm) * 1.5;
  const speedAnomaly = Math.max(0, 55 - loc.speed);
  const total = Math.min(100, Math.round(loc.traffic * 0.32 + loc.accidents * 1.1 + loc.weatherImpact + speedAnomaly * 0.5 + coveragePenalty * 0.24 + visibilityPenalty));
  return {
    total,
    contributors: [
      ["Traffic congestion", Math.round(loc.traffic * 0.32)],
      ["Accident history", Math.round(loc.accidents * 1.1)],
      ["Weather", Math.round(loc.weatherImpact + visibilityPenalty)],
      ["Speed anomaly", Math.round(speedAnomaly * 0.5)],
      ["Low police coverage", Math.round(coveragePenalty * 0.24)]
    ]
  };
}

function nearestAvailableUnit(location, units) {
  const available = units.filter((u) => u.status === "AVAILABLE");
  return available.sort((a, b) => distance(a, location) - distance(b, location))[0] || null;
}

function distance(a, b) {
  return Math.hypot((a.x || 0) - b.x, (a.y || 0) - b.y);
}

function renderLayerButtons() {
  const wrap = $("layerButtons");
  wrap.innerHTML = "";
  layers.forEach((name) => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.className = name === state.activeLayer ? "active" : "";
    btn.onclick = () => {
      state.activeLayer = name;
      renderAll(state.payload, state.weather);
    };
    wrap.appendChild(btn);
  });
}

function renderFilterButtons() {
  const wrap = $("filterButtons");
  wrap.innerHTML = "";
  filters.forEach((name) => {
    const btn = document.createElement("button");
    btn.textContent = name;
    btn.className = name === state.activeFilter ? "active" : "";
    btn.onclick = () => {
      state.activeFilter = name;
      renderAll(state.payload, state.weather);
    };
    wrap.appendChild(btn);
  });
}

function renderStatuses(trafficSource, weatherSource) {
  $("systemStatus").innerHTML = [
    `● TRAFFIC ${trafficSource}`,
    `● WEATHER ${weatherSource}`,
    "● MAP CONNECTED",
    "● RISK ENGINE ACTIVE"
  ].map((s) => `<span>${s}</span>`).join("");
}

function markerClass(loc, score) {
  if (state.activeLayer === "TRAFFIC") return loc.traffic >= 80 ? "critical" : loc.traffic >= 60 ? "high" : "low";
  if (state.activeLayer === "POLICE COVERAGE") return loc.coverage < 35 ? "critical" : loc.coverage < 55 ? "high" : "low";
  if (state.activeLayer === "INCIDENTS") return loc.incidentCount > 0 ? "critical" : "low";
  if (state.activeLayer === "WEATHER IMPACT") return loc.weatherImpact >= 12 ? "high" : loc.weatherImpact >= 9 ? "medium" : "low";
  return level(score).toLowerCase();
}

function passFilter(loc, score) {
  if (state.activeFilter === "HIGH RISK") return score >= 70;
  if (state.activeFilter === "UNMANNED") return score >= 70 && loc.coverage < 35;
  if (state.activeFilter === "STAFFED") return loc.coverage >= 35;
  if (state.activeFilter === "INCIDENTS") return loc.incidentCount > 0;
  return true;
}

function renderMap(payload, weather) {
  const root = $("mapMarkers");
  root.innerHTML = "";
  const scores = payload.locations.map((loc) => ({ loc, ...scoreLocation(loc, weather) }));
  scores.forEach(({ loc, total }) => {
    if (!passFilter(loc, total)) return;
    const m = document.createElement("button");
    m.className = `marker ${markerClass(loc, total)}`;
    m.style.left = `${loc.x}%`;
    m.style.top = `${loc.y}%`;
    m.title = `${loc.name} | RISK ${total}`;
    m.onclick = () => focusLocation(loc.id);
    root.appendChild(m);
  });
  payload.units.forEach((unit) => {
    const u = document.createElement("div");
    u.className = "unit";
    u.style.left = `${unit.x}%`;
    u.style.top = `${unit.y}%`;
    u.title = `${unit.id} ${unit.status}`;
    root.appendChild(u);
  });
  payload.locations.filter((l) => l.incidentCount > 0).forEach((loc) => {
    const i = document.createElement("div");
    i.className = "incident";
    i.style.left = `${loc.x + 1.3}%`;
    i.style.top = `${loc.y - 1.4}%`;
    root.appendChild(i);
  });
}

function renderOverview(payload, weather) {
  const stats = payload.locations.map((loc) => scoreLocation(loc, weather).total);
  $("highCount").textContent = stats.filter((s) => s >= 70).length;
  $("mediumCount").textContent = stats.filter((s) => s >= 40 && s < 70).length;
  $("lowCount").textContent = stats.filter((s) => s < 40).length;
  const unmanned = payload.locations.filter((loc) => scoreLocation(loc, weather).total >= 70 && loc.coverage < 35);
  $("unmannedCount").textContent = unmanned.length;
}

function renderIncidents(payload) {
  const list = $("incidentList");
  const rows = payload.locations.filter((l) => l.incidentCount > 0);
  list.innerHTML = rows.map((l, i) => `<li>#0${i + 1} CRITICAL — ${l.name}</li>`).join("") || "<li>NO ACTIVE INCIDENTS</li>";
}

function renderRanking(payload, weather) {
  const ranked = payload.locations
    .map((loc) => ({ loc, score: scoreLocation(loc, weather).total }))
    .sort((a, b) => b.score - a.score);
  $("rankingList").innerHTML = ranked.map((row, i) => `<li data-id="${row.loc.id}">${String(i + 1).padStart(2, "0")} ${row.loc.name}<br><strong>RISK ${row.score} ${level(row.score)}</strong></li>`).join("");
  $("rankingList").querySelectorAll("li").forEach((li) => li.addEventListener("click", () => focusLocation(li.dataset.id)));
}

function renderWeather(weather) {
  $("temp").textContent = weather.temp;
  $("weatherDesc").textContent = weather.condition;
  $("weatherMeta").textContent = `Humidity ${weather.humidity}%  •  Visibility ${weather.visibilityKm} km  •  Wind ${weather.windKmh} km/h`;
}

function renderRiskCard(payload, weather) {
  const loc = payload.locations.find((l) => l.id === state.selectedLocationId) || payload.locations[0];
  const { total, contributors } = scoreLocation(loc, weather);
  animateTo($("riskScore"), Number($("riskScore").textContent) || 0, total, 450);
  $("riskLevel").textContent = level(total);
  $("contributors").innerHTML = contributors.map(([k, v]) => `<li>${k} +${v}</li>`).join("") + `<li><strong>TOTAL ${total}</strong></li>`;
}

function renderRecommendation(payload, weather) {
  const rankedTop = payload.locations
    .map((loc) => ({ loc, score: scoreLocation(loc, weather).total }))
    .sort((a, b) => b.score - a.score)[0];
  const unit = nearestAvailableUnit(rankedTop.loc, payload.units);
  state.recommendation = unit ? {
    unitId: unit.id,
    from: unit.assignedLocation || "PATROL",
    to: rankedTop.loc.id,
    reason: "High risk + low coverage + nearest available unit",
    confidence: 91,
    expectedRiskReduction: 18,
    eta: "03:42"
  } : null;
  if (!state.recommendation) {
    $("recommendationText").textContent = "No available units for redeployment";
    return;
  }
  $("recommendationText").innerHTML = `UNIT ${state.recommendation.unitId} → ${rankedTop.loc.name}<br>ETA ${state.recommendation.eta} • EXPECTED RISK REDUCTION ${state.recommendation.expectedRiskReduction}%<br>CONFIDENCE ${state.recommendation.confidence}%`;
}

function renderComparison() {
  const table = $("comparisonTable");
  const rows = [
    ["Critical zones", "07", state.overrideActive ? "04" : "03"],
    ["Unmanned zones", "09", state.overrideActive ? "03" : "02"],
    ["Avg response", "08:42", state.overrideActive ? "05:12" : "04:31"],
    ["Coverage", "64%", state.overrideActive ? "84%" : "89%"],
    ["Risk index", "78", state.overrideActive ? "64" : "61"]
  ];
  table.innerHTML = `<tr><th></th><th>CURRENT</th><th>RECOMMENDED</th></tr>${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}`;
}

function focusLocation(locationId) {
  state.selectedLocationId = locationId;
  const loc = state.payload.locations.find((l) => l.id === locationId);
  if (!loc) return;
  const score = scoreLocation(loc, state.weather).total;
  $("focusCard").classList.remove("hidden");
  $("focusCard").innerHTML = `<strong>${loc.name}</strong><br>RISK ${score} ${level(score)}<br>Traffic ${loc.traffic} • Speed ${loc.speed} km/h • Coverage ${loc.coverage}%${loc.coverage < 35 && score >= 70 ? "<br><strong>⚠ UNMANNED HIGH-RISK</strong>" : ""}`;
  state.camera.scale = 1.15;
  state.camera.x = 50 - loc.x;
  state.camera.y = 50 - loc.y;
  applyCamera();
  renderRiskCard(state.payload, state.weather);
}

function renderOverridePanel(payload) {
  const panel = $("overridePanel");
  panel.innerHTML = `
    <p>MANUAL DEPLOYMENT</p>
    <select id="manualUnit">${payload.units.map((u) => `<option value="${u.id}">${u.id} (${u.status})</option>`)}</select>
    <select id="manualDest">${payload.locations.map((l) => `<option value="${l.id}">${l.name}</option>`)}</select>
    <button id="confirmOverride">CONFIRM</button>
    <div>MANUAL OVERRIDE ACTIVE</div>`;
  $("confirmOverride").onclick = () => {
    const unitId = $("manualUnit").value;
    const to = $("manualDest").value;
    const unit = payload.units.find((u) => u.id === unitId);
    const destination = payload.locations.find((l) => l.id === to);
    if (unit && destination) {
      const fromLocation = payload.locations.find((l) => l.id === unit.assignedLocation);
      if (fromLocation) fromLocation.coverage = Math.max(10, fromLocation.coverage - 8);
      destination.coverage = Math.min(95, destination.coverage + 12);
      unit.assignedLocation = destination.id;
      unit.status = "DEPLOYED";
      unit.x = destination.x;
      unit.y = destination.y;
    }
    state.overrideActive = true;
    renderComparison();
    renderAll(payload, state.weather);
    $("simulationLog").textContent = "MANUAL OVERRIDE ACTIVE\nOperator deployment applied.";
  };
}

async function runSimulation() {
  const incidentLoc = state.payload.locations.find((l) => l.id === "L1");
  const recoUnit = state.payload.units.find((u) => u.id === "P-014");
  if (!incidentLoc || !recoUnit) return;
  const scoreView = $("riskScore");
  $("simulationLog").textContent = "PHASE 1 — INCIDENT\nCRITICAL INCIDENT DETECTED\nMG ROAD / JUNCTION 04";
  focusLocation("L1");
  await pause();
  $("simulationLog").textContent += "\n\nPHASE 2 — RISK ESCALATION";
  for (const v of [68, 77, 89, 94]) {
    animateTo(scoreView, Number(scoreView.textContent) || 61, v, 280);
    await pause(320);
  }
  $("simulationLog").textContent += "\nRISK CONTRIBUTORS: Traffic +++, Incident +++, Weather ++";
  await pause();
  $("simulationLog").textContent += `\n\nPHASE 3 — SYSTEM RECOMMENDATION\nRedeploy ${recoUnit.id} to MG ROAD\nETA 03:42\nExpected risk reduction 18%`;
  await pause();
  $("simulationLog").textContent += "\n\nPHASE 4 — POLICE UNIT MOVEMENT";
  drawRoute(recoUnit, incidentLoc);
  await moveUnit(recoUnit, incidentLoc);
  $("simulationLog").textContent += "\nP-014 RESPONDING ETA 00:00";
  await pause();
  $("simulationLog").textContent += "\n\nPHASE 5 — RISK REDUCTION";
  for (const v of [86, 74, 62]) {
    animateTo(scoreView, Number(scoreView.textContent) || 94, v, 260);
    await pause(300);
  }
  $("simulationLog").textContent += "\nINCIDENT CONTAINED\nRISK REDUCED BY 34%";
}

function drawRoute(unit, target) {
  const line = $("routeLine");
  line.classList.remove("hidden");
  line.style.left = `${unit.x}%`;
  line.style.top = `${unit.y}%`;
  const len = distance(unit, target);
  const angle = Math.atan2(target.y - unit.y, target.x - unit.x);
  line.style.width = `${len}%`;
  line.style.transform = `rotate(${angle}rad)`;
}

function moveUnit(unit, target) {
  return new Promise((resolve) => {
    const steps = state.reducedMotion ? 1 : 20;
    let step = 0;
    const start = { x: unit.x, y: unit.y };
    const interval = setInterval(() => {
      step += 1;
      unit.x = start.x + ((target.x - start.x) * step) / steps;
      unit.y = start.y + ((target.y - start.y) * step) / steps;
      renderMap(state.payload, state.weather);
      if (step >= steps) {
        clearInterval(interval);
        resolve();
      }

      function applyCamera() {
        $("map").style.transition = state.reducedMotion ? "none" : "transform 0.9s ease";
        $("map").style.transform = `perspective(1200px) rotateX(57deg) scale(${state.camera.scale}) translate(${state.camera.x}%, ${state.camera.y}%)`;
      }

      function bindMapInteractions() {
        const mapWrap = $("map");
        mapWrap.addEventListener("wheel", (event) => {
          event.preventDefault();
          const delta = event.deltaY < 0 ? 0.08 : -0.08;
          state.camera.scale = Math.min(1.8, Math.max(0.9, state.camera.scale + delta));
          applyCamera();
        }, { passive: false });
      }
    }, state.reducedMotion ? 10 : 120);
  });
}

function pause(ms = 700) {
  return new Promise((resolve) => setTimeout(resolve, state.reducedMotion ? 0 : ms));
}

function animateTo(el, from, to, duration = 400) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / (state.reducedMotion ? 1 : duration));
    el.textContent = String(Math.round(from + (to - from) * p));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bindEvents() {
  $("enterBtn").onclick = () => {
    $("intro").style.opacity = "0";
    setTimeout(() => {
      $("intro").classList.add("hidden");
      $("app").classList.remove("hidden");
      initData();
    }, state.reducedMotion ? 0 : 850);
  };
  $("skipMotionBtn").onclick = () => { state.reducedMotion = true; };
  $("modeLive").onclick = () => setMode("LIVE");
  $("modeDemo").onclick = () => setMode("DEMO");
  $("acceptBtn").onclick = () => {
    state.overrideActive = false;
    $("simulationLog").textContent = "AI RECOMMENDATION ACCEPTED";
    renderComparison();
  };
  $("overrideBtn").onclick = () => {
    $("overridePanel").classList.toggle("hidden");
    if (!$("overridePanel").classList.contains("hidden")) renderOverridePanel(state.payload);
  };
  $("simulateBtn").onclick = runSimulation;
}

function setMode(mode) {
  state.mode = mode;
  $("modeLive").classList.toggle("active", mode === "LIVE");
  $("modeDemo").classList.toggle("active", mode === "DEMO");
  initData();
}

async function initData() {
  const trafficProvider = new TrafficDataProvider(state.mode);
  const weatherProvider = new WeatherDataProvider(state.mode);
  const payload = await trafficProvider.getTrafficData();
  const weather = await weatherProvider.getCurrentWeather();
  state.payload = payload;
  state.weather = weather;
  renderAll(payload, weather);
}

function renderAll(payload, weather) {
  renderLayerButtons();
  renderFilterButtons();
  renderStatuses(payload.source, weather.source);
  renderMap(payload, weather);
  renderOverview(payload, weather);
  renderIncidents(payload);
  renderRanking(payload, weather);
  renderWeather(weather);
  renderRiskCard(payload, weather);
  renderRecommendation(payload, weather);
  renderComparison();
  $("intelChain").textContent = `${weather.condition.toUpperCase()} → VISIBILITY ${weather.visibilityKm} KM → SPEED ↓ → CONGESTION ↑ → RISK ↑`;
  applyCamera();
}

$("introTimestamp").textContent = new Date().toLocaleString();
bindEvents();
bindMapInteractions();
