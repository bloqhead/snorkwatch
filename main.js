// ============================================================
//  SnorkWatch — main.js
//  Vanilla JS + Three.js ocean + Open-Meteo Marine API
// ============================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

// ── Three.js Ocean ──────────────────────────────────────────

function initOcean() {
  const canvas = document.getElementById('ocean');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x002a4a);
  scene.fog = new THREE.Fog(0x002a4a, 20, 60);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 4, 12);
  camera.lookAt(0, 0, 0);

  // — Ocean plane geometry —
  const SEGS = 120;
  const geo = new THREE.PlaneGeometry(50, 50, SEGS, SEGS);
  geo.rotateX(-Math.PI / 2);

  // Store original Y positions
  const posArr = geo.attributes.position.array;
  const origY = new Float32Array(posArr.length / 3);
  for (let i = 0; i < origY.length; i++) origY[i] = posArr[i * 3 + 1];

  const mat = new THREE.MeshPhongMaterial({
    color: 0x0077b6,
    emissive: 0x003049,
    specular: 0x90e0ef,
    shininess: 140,
    wireframe: false,
    flatShading: false,
    transparent: true,
    opacity: 0.92,
  });

  const ocean = new THREE.Mesh(geo, mat);
  scene.add(ocean);

  // — Foam plane (very slightly above) —
  const foamGeo = new THREE.PlaneGeometry(50, 50, SEGS, SEGS);
  foamGeo.rotateX(-Math.PI / 2);
  const foamMat = new THREE.MeshPhongMaterial({
    color: 0xb8e8ff,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  });
  const foam = new THREE.Mesh(foamGeo, foamMat);
  foam.position.y = 0.02;
  scene.add(foam);

  // — Lighting —
  const ambient = new THREE.AmbientLight(0x87ceeb, 0.6);
  scene.add(ambient);

  const sunLight = new THREE.DirectionalLight(0xfff4c2, 1.8);
  sunLight.position.set(10, 20, 10);
  scene.add(sunLight);

  const fillLight = new THREE.PointLight(0x00b4d8, 1.2, 30);
  fillLight.position.set(-8, 3, 6);
  scene.add(fillLight);

  const rimLight = new THREE.PointLight(0x48cae4, 0.6, 25);
  rimLight.position.set(8, 2, -5);
  scene.add(rimLight);

  // — Horizon mist (large flat quad behind ocean) —
  const mistGeo = new THREE.PlaneGeometry(60, 20);
  const mistMat = new THREE.MeshBasicMaterial({
    color: 0x023e8a,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const mist = new THREE.Mesh(mistGeo, mistMat);
  mist.position.set(0, 3, -18);
  scene.add(mist);

  // — Animated wave function —
  let waviness = 0.4; // default; updated by snorkel score
  const clock = new THREE.Clock();

  function updateWaves(t) {
    const pos = geo.attributes.position;
    const fpos = foamGeo.attributes.position;
    for (let i = 0; i < origY.length; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wave =
        Math.sin(x * 0.5 + t * 1.2) * 0.35 * waviness +
        Math.sin(z * 0.4 + t * 0.9) * 0.25 * waviness +
        Math.sin((x + z) * 0.3 + t * 1.5) * 0.15 * waviness +
        Math.cos(x * 0.8 - t * 0.7) * 0.1 * waviness;
      pos.setY(i, origY[i] + wave);
      fpos.setY(i, origY[i] + wave + 0.02);
    }
    pos.needsUpdate = true;
    fpos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // — Animate —
  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    updateWaves(t);
    camera.position.x = Math.sin(t * 0.07) * 0.5;
    camera.position.y = 4 + Math.sin(t * 0.13) * 0.3;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  }
  animate();

  // — Resize —
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Expose setter for wave intensity
  return {
    setWaviness(v) { waviness = Math.max(0.15, Math.min(2.5, v)); }
  };
}

// ── Geolocation ─────────────────────────────────────────────

function getLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported by your browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      err => {
        const msgs = {
          1: 'Location access was denied. We need it to check your local conditions.',
          2: 'Location unavailable. Are you indoors?',
          3: 'Location request timed out. Try again.',
        };
        reject(new Error(msgs[err.code] || 'Could not get your location.'));
      },
      { timeout: 10000, maximumAge: 300000 }
    );
  });
}

// Reverse-geocode with Open-Meteo's geocoding (no key needed) isn't available,
// so we'll use a free reverse geocoder from nominatim.openstreetmap.org
async function getPlaceName(lat, lon) {
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
      { headers: { 'Accept-Language': 'en' } }
    );
    const d = await r.json();
    const a = d.address || {};
    return a.city || a.town || a.village || a.county || a.state || 'your location';
  } catch {
    return 'your location';
  }
}

// ── Open-Meteo fetch ─────────────────────────────────────────

async function fetchConditions(lat, lon) {
  // Marine API — wave & swell data
  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.searchParams.set('latitude', lat);
  marineUrl.searchParams.set('longitude', lon);
  marineUrl.searchParams.set('current', [
    'wave_height',
    'wave_direction',
    'wave_period',
    'wind_wave_height',
    'swell_wave_height',
    'ocean_current_velocity',
  ].join(','));

  // Forecast API — wind, visibility, UV, precipitation
  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.searchParams.set('latitude', lat);
  forecastUrl.searchParams.set('longitude', lon);
  forecastUrl.searchParams.set('current', [
    'wind_speed_10m',
    'wind_gusts_10m',
    'precipitation',
    'uv_index',
    'visibility',
    'weather_code',
  ].join(','));
  forecastUrl.searchParams.set('wind_speed_unit', 'mph');

  const [marineRes, forecastRes] = await Promise.all([
    fetch(marineUrl),
    fetch(forecastUrl),
  ]);

  if (!marineRes.ok || !forecastRes.ok) {
    throw new Error('Could not reach weather APIs. Try again later.');
  }

  const [marineData, forecastData] = await Promise.all([
    marineRes.json(),
    forecastRes.json(),
  ]);

  const m = marineData.current || {};
  const f = forecastData.current || {};

  return {
    waveHeight: m.wave_height ?? null,        // metres
    swellHeight: m.swell_wave_height ?? null, // metres
    wavePeriod: m.wave_period ?? null,        // seconds
    currentSpeed: m.ocean_current_velocity ?? null, // m/s
    windSpeed: f.wind_speed_10m ?? null,      // mph
    windGusts: f.wind_gusts_10m ?? null,      // mph
    precipitation: f.precipitation ?? null,  // mm
    uvIndex: f.uv_index ?? null,
    visibility: f.visibility ?? null,        // metres
    weatherCode: f.weather_code ?? null,
  };
}

// ── Scoring engine ───────────────────────────────────────────

/*
  Score 0–100 based on snorkeling suitability.
  Key factors (roughly weighted):
    Wave height   30%
    Wind speed    25%
    Visibility    20%
    Precipitation 15%
    Swell period  10%
*/

function scoreConditions(c) {
  let score = 100;
  const penalties = [];
  const bonuses = [];

  // Wave height (metres) — calm < 0.5m, sketchy > 1.5m, dangerous > 2.5m
  if (c.waveHeight !== null) {
    if (c.waveHeight < 0.3)      { bonuses.push('glassy seas'); }
    else if (c.waveHeight < 0.6) { /* good */ }
    else if (c.waveHeight < 1.0) { score -= 20; penalties.push('choppy waves'); }
    else if (c.waveHeight < 1.5) { score -= 40; penalties.push('rough waves'); }
    else                          { score -= 60; penalties.push('dangerous waves'); }
  }

  // Wind speed (mph)
  if (c.windSpeed !== null) {
    if (c.windSpeed < 5)        { bonuses.push('calm winds'); }
    else if (c.windSpeed < 12)  { /* fine */ }
    else if (c.windSpeed < 20)  { score -= 20; penalties.push('strong winds'); }
    else if (c.windSpeed < 30)  { score -= 35; penalties.push('very strong winds'); }
    else                         { score -= 55; penalties.push('gale-force winds'); }
  }

  // Wind gusts bonus hit
  if (c.windGusts !== null && c.windGusts > 25) {
    score -= 10; penalties.push('gusty conditions');
  }

  // Visibility (metres) — good > 5000m, poor < 1000m
  if (c.visibility !== null) {
    if (c.visibility >= 8000)      { bonuses.push('crystal visibility'); }
    else if (c.visibility >= 4000) { /* ok */ }
    else if (c.visibility >= 1500) { score -= 15; penalties.push('reduced visibility'); }
    else                            { score -= 30; penalties.push('poor visibility'); }
  }

  // Precipitation
  if (c.precipitation !== null) {
    if (c.precipitation === 0)       { bonuses.push('no rain'); }
    else if (c.precipitation < 0.5)  { score -= 5; }
    else if (c.precipitation < 2)    { score -= 20; penalties.push('light rain'); }
    else                              { score -= 35; penalties.push('rain'); }
  }

  // Wave period — longer is better for snorkeling (less chop)
  if (c.wavePeriod !== null) {
    if (c.wavePeriod >= 10)      { bonuses.push('long wave period'); }
    else if (c.wavePeriod < 5)   { score -= 10; penalties.push('short choppy period'); }
  }

  // Ocean current
  if (c.currentSpeed !== null && c.currentSpeed > 0.5) {
    score -= 15; penalties.push('strong current');
  }

  // UV index bonus (good beach day)
  if (c.uvIndex !== null && c.uvIndex >= 6) {
    bonuses.push('sunny skies ☀️');
  }

  // Weather code — storm codes (95, 96, 99, 77, etc.)
  const BAD_CODES = [51,53,55,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99];
  if (c.weatherCode !== null && BAD_CODES.includes(c.weatherCode)) {
    score -= 25; penalties.push('bad weather');
  }

  score = Math.max(0, Math.min(100, score));

  return { score, penalties, bonuses };
}

// ── Verdict ──────────────────────────────────────────────────

function getVerdict(score) {
  if (score >= 75) return {
    cls: 'verdict--go',
    icon: '🤿',
    label: "Get in the water!",
    sub: "Conditions are looking great",
  };
  if (score >= 50) return {
    cls: 'verdict--maybe',
    icon: '🌊',
    label: "Eh, maybe…",
    sub: "Could be decent, could be choppy",
  };
  if (score >= 25) return {
    cls: 'verdict--no',
    icon: '🌬️',
    label: "Probably don't.",
    sub: "Not ideal snorkeling conditions",
  };
  return {
    cls: 'verdict--no',
    icon: '⛈️',
    label: "Stay ashore.",
    sub: "The sea says absolutely not",
  };
}

// ── UI helpers ───────────────────────────────────────────────

function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }

function fmt(val, unit, dec = 1) {
  if (val === null || val === undefined) return '—';
  return `${(+val).toFixed(dec)}${unit}`;
}

function weatherLabel(code) {
  if (code === null) return '—';
  const map = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Foggy', 48: 'Icy fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers',
    95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
  };
  return map[code] ?? `Code ${code}`;
}

function renderResult(c, score, verdict, place, ocean) {
  const resultEl = document.getElementById('result');
  resultEl.className = `card card--result ${verdict.cls}`;

  document.getElementById('verdict-icon').textContent  = verdict.icon;
  document.getElementById('verdict-label').textContent = verdict.label;
  document.getElementById('verdict-sub').textContent   = verdict.sub;
  document.getElementById('location-line').textContent = `📍 ${place}`;

  // Stats grid
  const statsEl = document.getElementById('stats');
  const visKm = c.visibility !== null ? (c.visibility / 1000).toFixed(1) + ' km' : '—';
  const waveM = fmt(c.waveHeight, ' m');
  const windMph = fmt(c.windSpeed, ' mph', 0);
  const uvVal = c.uvIndex !== null ? c.uvIndex.toFixed(0) : '—';
  const sky = weatherLabel(c.weatherCode);
  const currentKt = c.currentSpeed !== null
    ? (c.currentSpeed * 1.944).toFixed(1) + ' kt'
    : '—';

  statsEl.innerHTML = `
    <div class="stat">
      <span class="stat-icon">🌊</span>
      <span class="stat-value">${waveM}</span>
      <span class="stat-label">Wave height</span>
    </div>
    <div class="stat">
      <span class="stat-icon">💨</span>
      <span class="stat-value">${windMph}</span>
      <span class="stat-label">Wind speed</span>
    </div>
    <div class="stat">
      <span class="stat-icon">👁️</span>
      <span class="stat-value">${visKm}</span>
      <span class="stat-label">Visibility</span>
    </div>
    <div class="stat">
      <span class="stat-icon">☀️</span>
      <span class="stat-value">${uvVal}</span>
      <span class="stat-label">UV index</span>
    </div>
    <div class="stat">
      <span class="stat-icon">🌀</span>
      <span class="stat-value">${currentKt}</span>
      <span class="stat-label">Current</span>
    </div>
    <div class="stat">
      <span class="stat-icon">🌤️</span>
      <span class="stat-value" style="font-size:0.85rem">${sky}</span>
      <span class="stat-label">Conditions</span>
    </div>
    <div class="score-bar-wrap">
      <div class="score-bar-label">Snorkel score — ${score}/100</div>
      <div class="score-bar-track">
        <div class="score-bar-fill" id="score-fill"
          style="width:0%; background: ${scoreColor(score)};">
        </div>
      </div>
    </div>
  `;

  // Animate score bar after paint
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('score-fill').style.width = `${score}%`;
    });
  });

  // Set wave intensity on the Three.js ocean
  // score 100 → calm (0.3), score 0 → stormy (2.2)
  const waveIntensity = 0.3 + ((100 - score) / 100) * 1.9;
  ocean.setWaviness(waveIntensity);

  show('result');
}

function scoreColor(s) {
  if (s >= 75) return 'linear-gradient(90deg, #00c853, #69f0ae)';
  if (s >= 50) return 'linear-gradient(90deg, #ff8f00, #ffd54f)';
  return 'linear-gradient(90deg, #c62828, #ff6b6b)';
}

// ── Main app flow ────────────────────────────────────────────

async function run(ocean) {
  // Reset UI
  hide('result');
  hide('error');
  show('loading');

  try {
    const { lat, lon } = await getLocation();

    // Fetch conditions & place name in parallel
    const [conditions, place] = await Promise.all([
      fetchConditions(lat, lon),
      getPlaceName(lat, lon),
    ]);

    const { score } = scoreConditions(conditions);
    const verdict = getVerdict(score);
    const scored = scoreConditions(conditions);

    hide('loading');
    renderResult(conditions, scored.score, verdict, place, ocean);

  } catch (err) {
    hide('loading');
    document.getElementById('error-msg').textContent = err.message;
    show('error');
  }
}

// ── Boot ─────────────────────────────────────────────────────

const ocean = initOcean();

run(ocean);

document.getElementById('retry-btn').addEventListener('click', () => run(ocean));
document.getElementById('refresh-btn').addEventListener('click', () => {
  hide('result');
  run(ocean);
});
