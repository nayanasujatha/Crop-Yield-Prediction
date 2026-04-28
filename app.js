/**
 * app.js  –  AgriPredict Frontend Logic
 * =======================================
 * Features:
 *  - JWT auth guard (redirects to login if no token)
 *  - Sidebar navigation
 *  - Yield prediction with validation
 *  - Voice input via Web Speech API
 *  - Slider ↔ Number input sync
 *  - Crop suggestion & warnings
 *  - Prediction history (localStorage)
 *  - Chart.js visualizations (bar, line, donut, scatter, radar)
 *  - Weather API integration with autofill
 *  - Map heatmap simulation
 *  - AI Advisor (tip rotation)
 *  - Report download (text)
 *  - CSV export
 *  - Multi-language support
 *  - Dashboard stats
 */

"use strict";

/* ═══════════════════════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════════════════════ */

const API   = "";         // same origin
const HIST_KEY = "agri_history";

// Slider field map: key → { range, input, rangeVal, error }
const FIELDS = {
  temp: { range:"rTemp", input:"iTemp", rv:"rvTemp", err:"eTemp", min:5,  max:50,   label:"Temperature" },
  rain: { range:"rRain", input:"iRain", rv:"rvRain", err:"eRain", min:100,max:3000, label:"Rainfall"    },
  hum:  { range:"rHum",  input:"iHum",  rv:"rvHum",  err:"eHum",  min:10, max:100,  label:"Humidity"   },
};

// Chart instances (keep refs to destroy before rebuild)
const CHARTS = {};

// Last weather fetch (for autofill)
let lastWeather = null;

// Current language
let curLang = "en";

/* ═══════════════════════════════════════════════════════════
   I18N
═══════════════════════════════════════════════════════════ */
const I18N = {
  en: { predict:"Predict Yield", reset:"Reset", noResult:"Awaiting prediction…",
        history:"Prediction History", download:"Download Report",
        lowRain:"⚠ Low rainfall – yield may be reduced",
        highTemp:"🔥 High temperature – heat stress risk",
        goodCond:"✅ Conditions look favourable" },
  hi: { predict:"उपज का अनुमान लगाएं", reset:"रीसेट", noResult:"पूर्वानुमान की प्रतीक्षा…",
        history:"पूर्वानुमान इतिहास", download:"रिपोर्ट डाउनलोड करें",
        lowRain:"⚠ कम वर्षा – उपज प्रभावित हो सकती है",
        highTemp:"🔥 उच्च तापमान – गर्मी का तनाव",
        goodCond:"✅ परिस्थितियाँ अनुकूल लग रही हैं" },
  es: { predict:"Predecir Rendimiento", reset:"Restablecer", noResult:"Esperando predicción…",
        history:"Historial", download:"Descargar Informe",
        lowRain:"⚠ Lluvia baja – el rendimiento puede reducirse",
        highTemp:"🔥 Alta temperatura – riesgo de estrés térmico",
        goodCond:"✅ Las condiciones parecen favorables" },
  fr: { predict:"Prédire le Rendement", reset:"Réinitialiser", noResult:"En attente…",
        history:"Historique", download:"Télécharger le Rapport",
        lowRain:"⚠ Faibles précipitations – rendement réduit",
        highTemp:"🔥 Haute température – risque de stress thermique",
        goodCond:"✅ Les conditions semblent favorables" },
  te: { predict:"దిగుబడిని అంచనా వేయండి", reset:"రీసెట్", noResult:"అంచనా కోసం వేచి ఉన్నారు…",
        history:"చరిత్ర", download:"నివేదికను డౌన్‌లోడ్ చేయండి",
        lowRain:"⚠ తక్కువ వర్షపాతం – దిగుబడి తగ్గవచ్చు",
        highTemp:"🔥 అధిక ఉష్ణోగ్రత – వేడి ఒత్తిడి ప్రమాదం",
        goodCond:"✅ పరిస్థితులు అనుకూలంగా ఉన్నాయి" },
};

function t(key) { return (I18N[curLang] || I18N.en)[key] || key; }

function setLang(lang) {
  curLang = lang;
  // Update static strings
  const predBtn = document.getElementById("predBtn");
  if (predBtn) predBtn.innerHTML = `🌾 ${t("predict")}`;
}

/* ═══════════════════════════════════════════════════════════
   AUTH GUARD
═══════════════════════════════════════════════════════════ */
function getToken() {
  return localStorage.getItem("agri_token") || sessionStorage.getItem("agri_token");
}

function getUser() {
  return localStorage.getItem("agri_user") || sessionStorage.getItem("agri_user") || "Admin";
}

function logout() {
  localStorage.removeItem("agri_token");
  localStorage.removeItem("agri_user");
  sessionStorage.removeItem("agri_token");
  sessionStorage.removeItem("agri_user");
  window.location.href = "login.html";
}

// Guard: redirect if no token
(function guard() {
  if (!getToken()) window.location.href = "login.html";
  const u = document.getElementById("tbUser");
  if (u) u.textContent = "👤 " + getUser();
})();

/* ═══════════════════════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════════════════════ */
function showSection(name) {
  document.querySelectorAll(".sec").forEach(s => s.classList.remove("on"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  const sec = document.getElementById("sec-" + name);
  if (sec) sec.classList.add("on");

  // Mark matching nav item
  document.querySelectorAll(".nav-item").forEach(n => {
    if (n.getAttribute("onclick") && n.getAttribute("onclick").includes(`'${name}'`))
      n.classList.add("active");
  });

  // Lazy-init charts
  if (name === "charts")  initCharts();
  if (name === "dash")    refreshDashCharts();
  if (name === "smart")   renderSmartCrops();
  if (name === "history") renderHistory();
  if (name === "map")     buildMap();
  if (name === "ai")      renderTips();
  if (name === "weather") buildCityChips();
}

/* ═══════════════════════════════════════════════════════════
   SLIDER ↔ INPUT SYNC
═══════════════════════════════════════════════════════════ */
function syncR(key) {
  const f   = FIELDS[key];
  const val = document.getElementById(f.range).value;
  document.getElementById(f.input).value = val;
  document.getElementById(f.rv).textContent = val;
  document.getElementById(f.err).classList.remove("on");
  document.getElementById(f.input).classList.remove("err");
}

function syncI(key) {
  const f   = FIELDS[key];
  const val = parseFloat(document.getElementById(f.input).value);
  if (!isNaN(val) && val >= f.min && val <= f.max) {
    document.getElementById(f.range).value = val;
    document.getElementById(f.rv).textContent = val;
    document.getElementById(f.err).classList.remove("on");
    document.getElementById(f.input).classList.remove("err");
  }
}

/* ═══════════════════════════════════════════════════════════
   VOICE INPUT
═══════════════════════════════════════════════════════════ */
function voiceInput(key) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert("Voice input not supported in this browser. Use Chrome."); return; }

  const btn = document.getElementById("v" + key.charAt(0).toUpperCase() + key.slice(1));
  btn.classList.add("mic-on");
  btn.textContent = "🔴";

  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  rec.onresult = e => {
    const spoken = e.results[0][0].transcript.replace(/[^0-9.]/g, "");
    const f = FIELDS[key];
    if (spoken) {
      document.getElementById(f.input).value = spoken;
      syncI(key);
    }
    btn.classList.remove("mic-on");
    btn.textContent = "🎤";
  };

  rec.onerror = () => {
    btn.classList.remove("mic-on");
    btn.textContent = "🎤";
  };

  rec.onend = () => {
    btn.classList.remove("mic-on");
    btn.textContent = "🎤";
  };

  rec.start();
}

/* ═══════════════════════════════════════════════════════════
   VALIDATION
═══════════════════════════════════════════════════════════ */
function validateFields() {
  let ok = true;
  for (const [key, f] of Object.entries(FIELDS)) {
    const raw = document.getElementById(f.input).value.trim();
    const val = parseFloat(raw);
    const hasErr = raw === "" || isNaN(val) || val < f.min || val > f.max;
    document.getElementById(f.err).classList.toggle("on", hasErr);
    document.getElementById(f.input).classList.toggle("err", hasErr);
    if (hasErr) ok = false;
  }
  return ok;
}

/* ═══════════════════════════════════════════════════════════
   CROP SUGGESTION
═══════════════════════════════════════════════════════════ */
const CROPS = {
  low   : { name:"Millet (Bajra)",  icon:"🌾", desc:"Drought-tolerant. Ideal for <400mm rainfall. High protein content." },
  medium: { name:"Wheat (Gehun)",   icon:"🌿", desc:"Thrives in 400–900mm rainfall. Best in loamy/clay soils." },
  high  : { name:"Rice (Chawal)",   icon:"🌾", desc:"Needs >900mm rainfall or irrigation. Prefers flooded conditions." },
};

function getCrop(rainfall) {
  if (rainfall < 400)  return { ...CROPS.low,    level:"Low" };
  if (rainfall < 900)  return { ...CROPS.medium,  level:"Medium" };
  return                      { ...CROPS.high,    level:"High" };
}

/* ═══════════════════════════════════════════════════════════
   WARNINGS
═══════════════════════════════════════════════════════════ */
function buildWarnings(temp, rainfall, humidity) {
  const chips = [];
  if (rainfall < 400)  chips.push({ cls:"chip-w", txt: t("lowRain") });
  if (temp > 38)       chips.push({ cls:"chip-d", txt: t("highTemp") });
  if (humidity < 35)   chips.push({ cls:"chip-w", txt: "⚠ Low humidity – consider irrigation" });
  if (temp < 10)       chips.push({ cls:"chip-w", txt: "❄ Low temperature – frost risk for some crops" });
  if (!chips.length)   chips.push({ cls:"chip-ok", txt: t("goodCond") });
  return chips;
}

/* ═══════════════════════════════════════════════════════════
   MAIN PREDICTION
═══════════════════════════════════════════════════════════ */
async function runPredict() {
  if (!validateFields()) return;

  const temp     = parseFloat(document.getElementById("iTemp").value);
  const rainfall = parseFloat(document.getElementById("iRain").value);
  const humidity = parseFloat(document.getElementById("iHum").value);
  const soil     = document.getElementById("soilSel").value;
  const btn      = document.getElementById("predBtn");

  btn.disabled = true;
  btn.innerHTML = '<span class="spin"></span>Predicting…';

  try {
    const res  = await fetch(`${API}/api/predict`, {
      method : "POST",
      headers: { "Content-Type":"application/json",
                 "Authorization":"Bearer " + getToken() },
      body   : JSON.stringify({ temperature:temp, rainfall, humidity, soilType:soil }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Prediction failed");

    showResult(data.yield, temp, rainfall, humidity, soil);
    saveHistory({ temp, rainfall, humidity, soil, yield: data.yield });
    updateDashStats();
    updatePredChart(temp, rainfall, humidity, data.yield);

  } catch (err) {
    alert("❌ " + err.message +
          "\n\nMake sure:\n1. model.pkl exists (run: python model.py)\n2. Server is running (node server.js)");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `🌾 ${t("predict")}`;
  }
}

function showResult(yieldVal, temp, rainfall, humidity, soil) {
  document.getElementById("noResult").style.display = "none";

  const rbox = document.getElementById("rbox");
  rbox.classList.add("on");
  document.getElementById("rboxVal").textContent = yieldVal.toFixed(2);

  // Warnings
  const chips = buildWarnings(temp, rainfall, humidity);
  document.getElementById("warnChips").innerHTML =
    chips.map(c => `<div class="chip ${c.cls}">${c.txt}</div>`).join("");

  // Crop suggestion
  const crop = getCrop(rainfall);
  document.getElementById("cropIco").textContent = crop.icon;
  document.getElementById("cropNm").textContent  = crop.name;
  document.getElementById("cropDs").textContent  = crop.desc;
  document.getElementById("cropWrap").style.display = "block";
  document.getElementById("dlWrap").style.display   = "block";

  // Update dashboard latest
  document.getElementById("dashLatest").innerHTML = `
    <div style="padding:0.5rem 0">
      <div style="font-size:2rem;font-weight:600;color:var(--gold-light)">${yieldVal.toFixed(2)} <small style="font-size:1rem;color:var(--text-muted)">t/ha</small></div>
      <div style="margin-top:0.5rem;color:var(--text-muted);font-size:0.85rem">
        🌡 ${temp}°C &nbsp;·&nbsp; 🌧 ${rainfall}mm &nbsp;·&nbsp; 💧${humidity}% &nbsp;·&nbsp; 🌍 ${soil}
      </div>
      <div style="margin-top:0.5rem">${crop.icon} Suggested: <strong style="color:var(--gold-light)">${crop.name}</strong></div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   RESET
═══════════════════════════════════════════════════════════ */
function resetForm() {
  for (const [key, f] of Object.entries(FIELDS)) {
    const def = { temp:25, rain:800, hum:70 }[key];
    document.getElementById(f.input).value = def;
    document.getElementById(f.range).value = def;
    document.getElementById(f.rv).textContent = def;
    document.getElementById(f.err).classList.remove("on");
    document.getElementById(f.input).classList.remove("err");
  }
  document.getElementById("soilSel").selectedIndex = 0;
  document.getElementById("rbox").classList.remove("on");
  document.getElementById("noResult").style.display = "";
  document.getElementById("cropWrap").style.display = "none";
  document.getElementById("dlWrap").style.display   = "none";
}

/* ═══════════════════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════════════════ */
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; }
  catch { return []; }
}

function saveHistory(entry) {
  const h = loadHistory();
  h.unshift({ ...entry, date: new Date().toLocaleString() });
  if (h.length > 100) h.pop();
  localStorage.setItem(HIST_KEY, JSON.stringify(h));
}

function renderHistory() {
  const h    = loadHistory();
  const body = document.getElementById("histBody");
  if (!h.length) {
    body.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:2rem">No records yet</td></tr>`;
    return;
  }
  body.innerHTML = h.map((r, i) => {
    const crop = getCrop(r.rainfall);
    const yc   = r.yield >= 5 ? "bg-g" : r.yield >= 3 ? "bg-a" : "bg-r";
    return `<tr>
      <td>${h.length - i}</td>
      <td>${r.date}</td>
      <td>${r.temp}</td>
      <td>${r.rainfall}</td>
      <td>${r.humidity}</td>
      <td>${r.soil}</td>
      <td><span class="badge ${yc}">${r.yield.toFixed(2)}</span></td>
      <td>${crop.icon} ${crop.name.split(" ")[0]}</td>
    </tr>`;
  }).join("");
}

function clearHistory() {
  if (confirm("Clear all prediction history?")) {
    localStorage.removeItem(HIST_KEY);
    renderHistory();
    updateDashStats();
  }
}

function exportCSV() {
  const h = loadHistory();
  if (!h.length) { alert("No history to export."); return; }
  const header = "Date,Temperature,Rainfall,Humidity,SoilType,Yield_t_ha,Crop";
  const rows   = h.map(r => {
    const crop = getCrop(r.rainfall);
    return [r.date, r.temp, r.rainfall, r.humidity, r.soil, r.yield.toFixed(2), crop.name].join(",");
  });
  downloadBlob([header, ...rows].join("\n"), "agripredict_history.csv", "text/csv");
}

/* ═══════════════════════════════════════════════════════════
   DOWNLOAD REPORT
═══════════════════════════════════════════════════════════ */
function downloadReport() {
  const temp     = document.getElementById("iTemp").value;
  const rainfall = document.getElementById("iRain").value;
  const humidity = document.getElementById("iHum").value;
  const soil     = document.getElementById("soilSel").value;
  const yieldVal = document.getElementById("rboxVal").textContent;
  const crop     = getCrop(parseFloat(rainfall));
  const warns    = buildWarnings(+temp, +rainfall, +humidity);

  const report = `
══════════════════════════════════════
       AgriPredict — Yield Report
══════════════════════════════════════
Generated : ${new Date().toLocaleString()}
User      : ${getUser()}

INPUT CONDITIONS
───────────────
Temperature  : ${temp} °C
Rainfall     : ${rainfall} mm/year
Humidity     : ${humidity} %
Soil Type    : ${soil}

PREDICTION RESULT
─────────────────
Predicted Yield : ${yieldVal} tons/hectare

CROP SUGGESTION
───────────────
${crop.icon}  ${crop.name}
${crop.desc}

WARNINGS & ALERTS
─────────────────
${warns.map(w => "• " + w.txt.replace(/^[^\w]+ /,'')).join("\n")}

──────────────────────────────────────
Powered by AgriPredict ML Engine v1.0
Decision Tree Regressor · Scikit-learn
══════════════════════════════════════
`.trim();

  downloadBlob(report, "agripredict_report.txt", "text/plain");
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const a    = Object.assign(document.createElement("a"), {
    href    : URL.createObjectURL(blob),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ═══════════════════════════════════════════════════════════
   DASHBOARD STATS
═══════════════════════════════════════════════════════════ */
function updateDashStats() {
  const h = loadHistory();
  document.getElementById("st-total").textContent = h.length;
  if (h.length) {
    const avg  = h.reduce((s,r) => s + r.yield, 0) / h.length;
    document.getElementById("st-avg").textContent  = avg.toFixed(2);
    document.getElementById("st-temp").textContent = h[0].temp;
    document.getElementById("st-hum").textContent  = h[0].humidity;
  }
}

/* ═══════════════════════════════════════════════════════════
   PREDICTION CHART (bar: inputs + yield)
═══════════════════════════════════════════════════════════ */
function updatePredChart(temp, rain, hum, yld) {
  destroyChart("predChart");
  const ctx = document.getElementById("predChart").getContext("2d");
  CHARTS.predChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Temperature (°C)", "Rainfall (÷10 mm)", "Humidity (%)", "Yield (t/ha)"],
      datasets: [{
        label: "Value",
        data : [temp, rain / 10, hum, yld],
        backgroundColor: ["#e09030aa","#3aacccaa","#3d9a3daa","#c9a84ccc"],
        borderColor    : ["#e09030",  "#3aaccc",  "#3d9a3d",  "#c9a84c"],
        borderWidth: 2,
        borderRadius: 6,
      }],
    },
    options: chartOpts("Prediction vs Inputs"),
  });
}

/* ═══════════════════════════════════════════════════════════
   CHARTS SECTION
═══════════════════════════════════════════════════════════ */
function initCharts() {
  const h = loadHistory();
  buildLineChart(h);
  buildDonutChart(h);
  buildScatterChart(h);
}

function buildLineChart(h) {
  destroyChart("lineChart");
  const ctx = document.getElementById("lineChart").getContext("2d");
  const data = [...h].reverse();
  CHARTS.lineChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.map((_, i) => "#" + (i + 1)),
      datasets: [{
        label: "Yield (t/ha)",
        data : data.map(r => r.yield),
        borderColor   : "#4caf50",
        backgroundColor: "rgba(76,175,80,0.15)",
        pointBackgroundColor: "#c9a84c",
        tension: 0.4, fill: true,
      }],
    },
    options: chartOpts("Yield Over Time"),
  });
}

function buildDonutChart(h) {
  destroyChart("donutChart");
  const soils = {};
  h.forEach(r => {
    soils[r.soil] = soils[r.soil] || [];
    soils[r.soil].push(r.yield);
  });
  const labels = Object.keys(soils);
  const avgs   = labels.map(s => (soils[s].reduce((a,b)=>a+b,0)/soils[s].length).toFixed(2));
  const ctx    = document.getElementById("donutChart").getContext("2d");
  CHARTS.donutChart = new Chart(ctx, {
    type:"doughnut",
    data:{
      labels,
      datasets:[{
        data:avgs,
        backgroundColor:["#2d7a2d99","#c9a84c99","#3aaccc99"],
        borderColor:["#2d7a2d","#c9a84c","#3aaccc"],
        borderWidth:2,
      }],
    },
    options:{
      responsive:true,
      plugins:{
        legend:{ labels:{ color:"#7aA07a", font:{family:"Jost"} } },
        title:{ display:false },
      },
    },
  });
}

function buildScatterChart(h) {
  destroyChart("scatterChart");
  const ctx = document.getElementById("scatterChart").getContext("2d");
  CHARTS.scatterChart = new Chart(ctx, {
    type:"scatter",
    data:{
      datasets:[{
        label:"Temp vs Yield",
        data: h.map(r => ({ x: r.temp, y: r.yield })),
        backgroundColor:"rgba(201,168,76,0.7)",
        pointRadius:6,
      }],
    },
    options:{
      responsive:true,
      plugins:{
        legend:{ labels:{ color:"#7aA07a", font:{family:"Jost"} } },
      },
      scales:{
        x:{ title:{ display:true, text:"Temperature (°C)", color:"#7aA07a" },
            ticks:{ color:"#7aA07a" }, grid:{ color:"rgba(76,175,80,0.08)" } },
        y:{ title:{ display:true, text:"Yield (t/ha)", color:"#7aA07a" },
            ticks:{ color:"#7aA07a" }, grid:{ color:"rgba(76,175,80,0.08)" } },
      },
    },
  });
}

function refreshDashCharts() {
  updateDashStats();
  const h = loadHistory().slice(0, 8).reverse();
  destroyChart("dashChart");
  const ctx = document.getElementById("dashChart").getContext("2d");
  CHARTS.dashChart = new Chart(ctx, {
    type:"bar",
    data:{
      labels: h.map((_,i) => "#" + (i+1)),
      datasets:[{
        label:"Yield (t/ha)",
        data : h.map(r => r.yield),
        backgroundColor:"rgba(76,175,80,0.6)",
        borderColor:"#4caf50",
        borderWidth:2, borderRadius:6,
      }],
    },
    options: chartOpts("Recent Yields"),
  });
}

/* shared chart options */
function chartOpts(title) {
  return {
    responsive:true,
    plugins:{
      legend:{ labels:{ color:"#7aA07a", font:{family:"Jost"} } },
      title :{ display: !!title, text:title, color:"#7aA07a", font:{family:"Cormorant Garamond",size:14} },
    },
    scales:{
      x:{ ticks:{ color:"#7aA07a" }, grid:{ color:"rgba(76,175,80,0.08)" } },
      y:{ ticks:{ color:"#7aA07a" }, grid:{ color:"rgba(76,175,80,0.08)" } },
    },
  };
}

function destroyChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
}

/* ═══════════════════════════════════════════════════════════
   SMART CROP SECTION
═══════════════════════════════════════════════════════════ */
const FULL_CROPS = [
  { name:"Rice",      icon:"🌾", rain:"900–2000mm", temp:"22–35°C", soil:"Clay, Loamy", score:[9,3,8],  desc:"Staple crop needing high water. Paddy fields ideal." },
  { name:"Wheat",     icon:"🌿", rain:"400–900mm",  temp:"15–25°C", soil:"Loamy, Clay", score:[8,8,6],  desc:"Cool-season crop. Tolerates moderate drought." },
  { name:"Millet",    icon:"🌾", rain:"200–600mm",  temp:"25–35°C", soil:"Sandy, Loamy",score:[4,9,7],  desc:"Extremely drought-resistant. High nutritional value." },
  { name:"Maize",     icon:"🌽", rain:"500–1200mm", temp:"20–32°C", soil:"Loamy",       score:[7,6,8],  desc:"Versatile crop for food, feed, and ethanol." },
  { name:"Soybean",   icon:"🫘", rain:"450–700mm",  temp:"20–30°C", soil:"Clay, Loamy", score:[6,7,9],  desc:"Nitrogen-fixing legume. Rich in protein." },
  { name:"Cotton",    icon:"🌸", rain:"600–1200mm", temp:"25–35°C", soil:"Loamy, Sandy",score:[7,5,6],  desc:"Cash crop. Requires long frost-free season." },
  { name:"Sugarcane", icon:"🎋", rain:"1200–2000mm",temp:"24–38°C", soil:"Loamy, Clay", score:[10,3,7], desc:"Tropical crop. Highest biomass per hectare." },
  { name:"Tomato",    icon:"🍅", rain:"400–600mm",  temp:"18–27°C", soil:"Loamy, Sandy",score:[5,8,9],  desc:"High-value vegetable. Sensitive to waterlogging." },
  { name:"Chickpea",  icon:"🫘", rain:"300–500mm",  temp:"15–25°C", soil:"Sandy, Loamy",score:[3,9,7],  desc:"Drought-tolerant legume. Improves soil nitrogen." },
];

function renderSmartCrops() {
  const grid = document.getElementById("smartGrid");
  if (!grid) return;
  grid.innerHTML = FULL_CROPS.map(c => `
    <div class="card" style="text-align:center">
      <div style="font-size:2.5rem;margin-bottom:0.5rem">${c.icon}</div>
      <div style="font-size:1rem;font-weight:600;color:var(--gold-light);margin-bottom:0.4rem">${c.name}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.6rem">${c.desc}</div>
      <div style="font-size:0.72rem;color:var(--text-muted)">
        🌧 ${c.rain} &nbsp; 🌡 ${c.temp}<br>🌍 ${c.soil}
      </div>
    </div>`).join("");

  // Radar chart
  destroyChart("radarChart");
  const ctx = document.getElementById("radarChart").getContext("2d");
  CHARTS.radarChart = new Chart(ctx, {
    type:"radar",
    data:{
      labels:["Water Need","Drought Tolerance","Yield Potential"],
      datasets: FULL_CROPS.slice(0,5).map((c,i) => ({
        label: c.name,
        data : c.score,
        borderColor:`hsl(${i*72},60%,55%)`,
        backgroundColor:`hsla(${i*72},60%,55%,0.12)`,
        pointBackgroundColor:`hsl(${i*72},60%,55%)`,
      })),
    },
    options:{
      responsive:true,
      scales:{r:{
        ticks:{ color:"#7aA07a", backdropColor:"transparent" },
        grid :{ color:"rgba(76,175,80,0.12)" },
        pointLabels:{ color:"#7aA07a", font:{family:"Jost"} },
      }},
      plugins:{ legend:{ labels:{ color:"#7aA07a", font:{family:"Jost"} } } },
    },
  });
}

/* ═══════════════════════════════════════════════════════════
   AI ADVISOR
═══════════════════════════════════════════════════════════ */
const AI_TIPS = [
  { ico:"💧", title:"Water Management",    body:"Use drip irrigation to reduce water usage by up to 50%. Soil moisture sensors can help schedule irrigation precisely." },
  { ico:"🌱", title:"Soil Health",          body:"Add organic compost each season. Healthy soil microbiome can increase yield by 15–20% without extra fertiliser." },
  { ico:"🌡️", title:"Temperature Control", body:"Use mulching to regulate soil temperature. Shade nets can reduce heat stress in high-temperature regions." },
  { ico:"🐛", title:"Pest Management",     body:"Integrated pest management (IPM) combines biological controls with minimal pesticides to protect beneficial insects." },
  { ico:"🌾", title:"Crop Rotation",       body:"Rotate legumes with cereals. This naturally replenishes nitrogen and breaks pest/disease cycles." },
  { ico:"📊", title:"Data-Driven Farming", body:"Track yield data over multiple seasons. Patterns reveal optimal planting windows and input requirements." },
];

const AI_ANSWERS = {
  wheat      : "Wheat performs best at 15–25°C with 400–900mm annual rainfall. In clay soil, ensure good drainage to prevent root rot. Apply nitrogen fertilizer (e.g. urea) at sowing and again at the jointing stage. Use certified seeds of rust-resistant varieties.",
  rice       : "Rice thrives in 22–35°C with >900mm rainfall or consistent irrigation. Transplant seedlings 25–30 days after sowing. Maintain 5cm standing water during tillering. Top-dress with nitrogen at panicle initiation.",
  fertilizer : "General guideline: apply NPK 10-26-26 at sowing, then urea (46-0-0) at 30 days. Soil test first for precise recommendations. Organic alternatives: vermicompost and green manure improve long-term soil health.",
  default    : "For optimal yield, focus on: (1) timely planting matched to your climate zone, (2) balanced fertilization based on soil tests, (3) efficient irrigation scheduling, (4) integrated pest management, and (5) post-harvest handling to minimize losses.",
};

function renderTips() {
  const g = document.getElementById("tipsGrid");
  if (!g || g.children.length) return;
  g.innerHTML = AI_TIPS.map(t => `
    <div class="card">
      <div style="font-size:1.8rem;margin-bottom:0.6rem">${t.ico}</div>
      <div style="font-size:0.9rem;font-weight:600;color:var(--gold-light);margin-bottom:0.4rem">${t.title}</div>
      <div style="font-size:0.8rem;color:var(--text-muted)">${t.body}</div>
    </div>`).join("");
}

function askAI() {
  const q   = (document.getElementById("aiQ").value || "").toLowerCase();
  const out = document.getElementById("aiOut");

  let answer = AI_ANSWERS.default;
  if (q.includes("wheat"))      answer = AI_ANSWERS.wheat;
  else if (q.includes("rice"))  answer = AI_ANSWERS.rice;
  else if (q.includes("fertil")) answer = AI_ANSWERS.fertilizer;

  // typing effect
  out.textContent = "";
  out.classList.add("typing-cur");
  let i = 0;
  const timer = setInterval(() => {
    out.textContent += answer[i++];
    if (i >= answer.length) {
      clearInterval(timer);
      out.classList.remove("typing-cur");
    }
  }, 18);
}

/* ═══════════════════════════════════════════════════════════
   WEATHER
═══════════════════════════════════════════════════════════ */
const QUICK_CITIES = ["Mumbai","Delhi","Bangalore","Chennai","Kolkata","Hyderabad","Jaipur","Pune"];

function buildCityChips() {
  const c = document.getElementById("cityChips");
  if (!c || c.children.length) return;
  c.innerHTML = QUICK_CITIES.map(city =>
    `<button class="btn btn-s" style="padding:0.3rem 0.8rem;font-size:0.78rem"
      onclick="document.getElementById('cityIn').value='${city}';fetchWeather()">
      ${city}
    </button>`).join("");
  fetchWeather();
}

async function fetchWeather() {
  const city = (document.getElementById("cityIn")?.value || "Mumbai").trim();
  try {
    const res  = await fetch(`${API}/api/weather?city=${encodeURIComponent(city)}`, {
      headers: { Authorization: "Bearer " + getToken() },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    lastWeather = data;
    renderWeather(data);
  } catch (e) {
    console.warn("Weather error:", e.message);
  }
}

function renderWeather(d) {
  const ICONS = { "01":"☀️","02":"⛅","03":"☁️","04":"☁️","09":"🌧","10":"🌦","11":"⛈","13":"❄️","50":"🌫" };
  const icon  = ICONS[d.icon?.slice(0,2)] || "🌤";

  ["wxIco","tbWxIco"].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = icon;
  });
  set("wxTemp",  `${d.temperature}°C`);
  set("tbWxTemp",`${d.temperature}°C`);
  set("wxDesc",  d.description + (d.isMock ? " (demo)" : ""));
  set("wxHum",   d.humidity);
  set("wxRain",  d.rainfall);
  set("wxWind",  d.windSpeed || "--");
  set("wxCity",  d.city);
}

function set(id, val) {
  const el = document.getElementById(id); if (el) el.textContent = val;
}

function autofill() {
  if (!lastWeather) return;
  const d = lastWeather;
  document.getElementById("iTemp").value = d.temperature;
  document.getElementById("rTemp").value = d.temperature;
  document.getElementById("rvTemp").textContent = d.temperature;
  if (d.humidity) {
    document.getElementById("iHum").value = d.humidity;
    document.getElementById("rHum").value = d.humidity;
    document.getElementById("rvHum").textContent = d.humidity;
  }
  showSection("predict");
}

/* ═══════════════════════════════════════════════════════════
   MAP
═══════════════════════════════════════════════════════════ */
const MAP_REGIONS = [
  {name:"Punjab",     rain:600,  temp:22, yield:5.8},
  {name:"Haryana",    rain:550,  temp:24, yield:5.2},
  {name:"UP",         rain:800,  temp:26, yield:4.9},
  {name:"Bihar",      rain:1100, temp:28, yield:4.5},
  {name:"WB",         rain:1600, temp:27, yield:5.5},
  {name:"Rajasthan",  rain:300,  temp:33, yield:2.1},
  {name:"Gujarat",    rain:500,  temp:30, yield:3.5},
  {name:"MP",         rain:1000, temp:27, yield:4.2},
  {name:"Maha",       rain:900,  temp:28, yield:4.3},
  {name:"AP",         rain:1000, temp:29, yield:4.8},
  {name:"Telangana",  rain:900,  temp:30, yield:4.2},
  {name:"Karnataka",  rain:800,  temp:26, yield:4.0},
  {name:"TN",         rain:1200, temp:29, yield:4.6},
  {name:"Kerala",     rain:2000, temp:27, yield:5.1},
  {name:"Odisha",     rain:1400, temp:28, yield:4.4},
  {name:"Jharkhand",  rain:1300, temp:27, yield:4.0},
  {name:"Chhattisgarh",rain:1200,temp:28,yield:4.3},
  {name:"Assam",      rain:1800, temp:25, yield:4.9},
  {name:"HP",         rain:900,  temp:15, yield:3.2},
  {name:"Uttarakhand",rain:1200, temp:18, yield:3.5},
  {name:"J&K",        rain:700,  temp:12, yield:2.8},
  {name:"Goa",        rain:2500, temp:28, yield:5.2},
  {name:"Manipur",    rain:1500, temp:23, yield:4.1},
  {name:"Meghalaya",  rain:2000, temp:20, yield:3.8},
];

function buildMap() {
  const g = document.getElementById("mapGrid");
  if (!g || g.children.length) return;

  g.innerHTML = MAP_REGIONS.map((r,i) => {
    const norm = (r.yield - 1) / 6;   // 0–1
    const h    = Math.floor(norm * 120); // green hue range
    const bg   = `hsl(${h},60%,${20 + norm * 25}%)`;
    return `<div class="mcell" style="background:${bg}" title="${r.name}: ${r.yield} t/ha" onclick="showMapResult(${i})">
      <span>${r.name}</span>
    </div>`;
  }).join("");
}

function showMapResult(idx) {
  const r = MAP_REGIONS[idx];
  const crop = getCrop(r.rain);
  document.getElementById("mapResBody").innerHTML = `
    <div style="display:flex;gap:2rem;flex-wrap:wrap">
      <div>
        <div style="font-size:1.8rem;font-weight:600;color:var(--gold-light)">${r.name}</div>
        <div style="color:var(--text-muted);font-size:0.85rem;margin-top:0.3rem">
          🌡 ${r.temp}°C &nbsp;·&nbsp; 🌧 ${r.rain}mm/yr
        </div>
        <div style="margin-top:0.6rem">
          Estimated Yield: <strong style="color:var(--leaf-bright);font-size:1.2rem">${r.yield} t/ha</strong>
        </div>
        <div style="margin-top:0.5rem">${crop.icon} Recommend: <strong>${crop.name}</strong></div>
        <div style="margin-top:0.5rem;font-size:0.82rem;color:var(--text-muted)">${crop.desc}</div>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  updateDashStats();
  refreshDashCharts();
  fetchWeather();
  renderTips();

  // Enter key on city input
  const ci = document.getElementById("cityIn");
  if (ci) ci.addEventListener("keydown", e => { if (e.key==="Enter") fetchWeather(); });

  // AI enter key
  const ai = document.getElementById("aiQ");
  if (ai) ai.addEventListener("keydown", e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); askAI(); } });
});
