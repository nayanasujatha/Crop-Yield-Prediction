/**
 * server.js  –  AgriPredict Express Backend
 * ==========================================
 *
 * Routes
 * ──────
 *   GET  /health           → server health check
 *   POST /api/login        → authenticate, returns JWT
 *   POST /api/predict      → run ML prediction  (JWT required)
 *   GET  /api/weather      → weather data        (JWT required)
 *
 * Setup
 * ──────
 *   npm install
 *   python model.py        ← run once to build model.pkl
 *   node server.js
 */

require("dotenv").config();

const express     = require("express");
const cors        = require("cors");
const path        = require("path");
const { exec }    = require("child_process");
const jwt         = require("jsonwebtoken");
const bcrypt      = require("bcryptjs");
const rateLimit   = require("express-rate-limit");

const app  = express();
const PORT = parseInt(process.env.PORT) || 3000;
const SECRET = process.env.JWT_SECRET || "change_me_in_production";
const PYTHON = process.env.PYTHON_CMD || "python";

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve HTML/JS/CSS

// Rate limit – 200 req / 15 min per IP
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200,
  message: { error: "Too many requests. Slow down." } }));

// ── User store (single demo user; swap for DB in production) ──
const DEMO_USER = {
  id: 1,
  username: process.env.ADMIN_USER || "admin",
  rawPass : process.env.ADMIN_PASS || "agri2024",
  hash    : null,   // filled at startup
  role    : "admin",
};
bcrypt.hash(DEMO_USER.rawPass, 10).then(h => { DEMO_USER.hash = h; });

// ── Auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer "))
    return res.status(401).json({ error: "No token provided" });

  try {
    req.user = jwt.verify(header.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ── GET /health ───────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status   : "OK",
    service  : "AgriPredict API",
    version  : "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/login ───────────────────────────────────────────
app.post("/api/login", async (req, res) => {
  const { username = "", password = "" } = req.body;

  if (!username || !password)
    return res.status(400).json({ error: "Username and password required" });

  if (username !== DEMO_USER.username)
    return res.status(401).json({ error: "Invalid credentials" });

  // Wait for hash to be ready (startup race guard)
  let tries = 0;
  while (!DEMO_USER.hash && tries++ < 10)
    await new Promise(r => setTimeout(r, 100));

  const ok = await bcrypt.compare(password, DEMO_USER.hash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { id: DEMO_USER.id, username: DEMO_USER.username, role: DEMO_USER.role },
    SECRET,
    { expiresIn: "8h" }
  );

  res.json({ token, username: DEMO_USER.username, role: DEMO_USER.role,
             message: "Login successful" });
});

// ── POST /api/predict ─────────────────────────────────────────
app.post("/api/predict", requireAuth, (req, res) => {
  const { temperature, rainfall, humidity, soilType = "Loamy" } = req.body;

  // Validate
  for (const [k, v] of Object.entries({ temperature, rainfall, humidity })) {
    if (v === undefined || v === null || v === "")
      return res.status(400).json({ error: `${k} is required` });
    if (isNaN(Number(v)))
      return res.status(400).json({ error: `${k} must be a number` });
  }
  if (Number(temperature) < -10 || Number(temperature) > 60)
    return res.status(400).json({ error: "Temperature must be between -10 and 60 °C" });
  if (Number(rainfall) < 0 || Number(rainfall) > 5000)
    return res.status(400).json({ error: "Rainfall must be between 0 and 5000 mm" });
  if (Number(humidity) < 0 || Number(humidity) > 100)
    return res.status(400).json({ error: "Humidity must be between 0 and 100 %" });

  const cmd = `${PYTHON} predict.py ${temperature} ${rainfall} ${humidity} ${soilType}`;

  exec(cmd, { cwd: __dirname, timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      console.error("[predict] exec error:", stderr || err.message);
      return res.status(500).json({ error: "Prediction engine error: " + (stderr || err.message) });
    }

    let parsed;
    try   { parsed = JSON.parse(stdout.trim()); }
    catch { return res.status(500).json({ error: "Bad output from Python: " + stdout }); }

    if (parsed.error) return res.status(500).json({ error: parsed.error });

    res.json({
      yield    : parsed.yield,
      unit     : "tons/hectare",
      inputs   : { temperature: +temperature, rainfall: +rainfall,
                   humidity: +humidity, soilType },
      timestamp: new Date().toISOString(),
    });
  });
});

// ── GET /api/weather?city=Mumbai ──────────────────────────────
app.get("/api/weather", requireAuth, async (req, res) => {
  const city   = (req.query.city || "Mumbai").trim();
  const apiKey = process.env.OPENWEATHER_API_KEY || "";

  // Use mock data when no real key is supplied
  if (!apiKey || apiKey === "DEMO_KEY" || apiKey === "your_openweather_api_key_here") {
    const mockBase = { Mumbai:28, Delhi:32, Bangalore:26, Chennai:31,
                       Kolkata:30, Hyderabad:29, Jaipur:33, Ahmedabad:34 };
    const baseTemp = mockBase[city] || 25 + Math.random() * 10;
    return res.json({
      city       : city,
      temperature: +(baseTemp + (Math.random() * 4 - 2)).toFixed(1),
      humidity   : +(50 + Math.random() * 40).toFixed(0),
      description: ["Clear sky","Partly cloudy","Overcast","Light rain"][Math.floor(Math.random()*4)] + " (demo)",
      rainfall   : +(Math.random() * 15).toFixed(1),
      windSpeed  : +(5 + Math.random() * 20).toFixed(1),
      icon       : ["01d","02d","03d","10d"][Math.floor(Math.random()*4)],
      isMock     : true,
    });
  }

  try {
    // Dynamic import of node-fetch (ESM compat)
    const { default: fetch } = await import("node-fetch").catch(() => ({ default: globalThis.fetch }));
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    const r   = await fetch(url);
    const d   = await r.json();

    if (d.cod !== 200) return res.status(400).json({ error: d.message });

    res.json({
      city       : d.name,
      temperature: d.main.temp,
      humidity   : d.main.humidity,
      description: d.weather[0].description,
      rainfall   : d.rain ? (d.rain["1h"] || d.rain["3h"] || 0) : 0,
      windSpeed  : d.wind?.speed || 0,
      icon       : d.weather[0].icon,
      isMock     : false,
    });
  } catch (e) {
    res.status(500).json({ error: "Weather service error: " + e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("\n╔══════════════════════════════════════╗");
  console.log("║   🌾  AgriPredict Server Running     ║");
  console.log("╚══════════════════════════════════════╝");
  console.log(`\n  URL    : http://localhost:${PORT}/login.html`);
  console.log(`  Health : http://localhost:${PORT}/health\n`);
  console.log("  Credentials → admin / agri2024");
  console.log("─────────────────────────────────────────\n");
});
