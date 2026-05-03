// ============================================================
//  SnorkWatch — main.js
//  Vanilla JS + Three.js realistic ocean + Open-Meteo Marine API
// ============================================================

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.module.js';

// ── Realistic Water Shader ──────────────────────────────────
// Custom GLSL water using Gerstner waves + normal-map distortion
// for a realistic angled ocean surface view.

const waterVertexShader = `
  uniform float uTime;
  uniform float uWaviness;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vWaveHeight;

  // Gerstner wave function
  vec3 gerstner(vec2 pos, float amp, float freq, float speed, vec2 dir, float time) {
    float phase = dot(dir, pos) * freq + time * speed;
    float s = sin(phase);
    float c = cos(phase);
    return vec3(
      dir.x * amp * c,
      amp * s,
      dir.y * amp * c
    );
  }

  void main() {
    vUv = uv;
    vec3 pos = position;

    float t = uTime;
    float w = uWaviness;

    // Layer multiple Gerstner waves
    vec3 wave = vec3(0.0);
    wave += gerstner(pos.xz, 0.28 * w, 0.5,  1.2, normalize(vec2(1.0,  0.6)), t);
    wave += gerstner(pos.xz, 0.18 * w, 0.8,  0.9, normalize(vec2(-0.7, 1.0)), t);
    wave += gerstner(pos.xz, 0.12 * w, 1.2,  1.5, normalize(vec2(0.3, -0.9)), t);
    wave += gerstner(pos.xz, 0.06 * w, 2.1,  2.0, normalize(vec2(-1.0, 0.3)), t);
    wave += gerstner(pos.xz, 0.04 * w, 3.5,  2.8, normalize(vec2(0.8,  0.7)), t);

    pos.x += wave.x;
    pos.y += wave.y;
    pos.z += wave.z;
    vWaveHeight = wave.y;

    vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
    vNormal = normalize(normalMatrix * normal);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const waterFragmentShader = `
  uniform float uTime;
  uniform float uWaviness;
  uniform vec3 uSunDir;
  uniform sampler2D uNormalMap;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vWaveHeight;

  void main() {
    float t = uTime;

    // Scroll two normal map layers in different directions
    vec2 uv1 = vUv * 4.0 + vec2(t * 0.04,  t * 0.02);
    vec2 uv2 = vUv * 4.0 + vec2(-t * 0.03, t * 0.05);

    vec3 n1 = texture2D(uNormalMap, uv1).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalMap, uv2).rgb * 2.0 - 1.0;
    vec3 normalDetail = normalize(n1 + n2);

    // Blend geometry normal with detail normal
    vec3 N = normalize(vNormal + normalDetail * 0.6 * uWaviness);

    // View direction
    vec3 V = normalize(cameraPosition - vWorldPos);

    // Sun specular (Blinn-Phong)
    vec3 H = normalize(uSunDir + V);
    float spec = pow(max(dot(N, H), 0.0), 180.0);
    float specStrength = spec * 2.2;

    // Fresnel — more reflection at grazing angles
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    fresnel = 0.04 + 0.96 * fresnel;

    // Deep vs shallow color
    vec3 deepColor    = vec3(0.01, 0.12, 0.28);
    vec3 shallowColor = vec3(0.0,  0.38, 0.58);
    vec3 foamColor    = vec3(0.75, 0.93, 1.0);
    vec3 skyColor     = vec3(0.35, 0.68, 0.90);

    // Depth fade
    float depth = smoothstep(-0.5, 0.6, vWaveHeight);
    vec3 waterColor = mix(deepColor, shallowColor, depth);

    // Sky reflection tint via Fresnel
    waterColor = mix(waterColor, skyColor, fresnel * 0.45);

    // Foam on wave crests
    float foam = smoothstep(0.22 * uWaviness, 0.45 * uWaviness, vWaveHeight);
    waterColor = mix(waterColor, foamColor, foam * 0.55);

    // Add specular highlight
    waterColor += vec3(1.0, 0.97, 0.85) * specStrength;

    // Subtle horizon darkening
    float horizonFade = smoothstep(0.0, 0.3, V.y);
    waterColor = mix(waterColor * 0.7, waterColor, horizonFade);

    gl_FragColor = vec4(waterColor, 1.0);
  }
`;

function initOcean() {
  const canvas = document.getElementById('ocean');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();

  // Sky gradient background
  const skyGeo = new THREE.SphereGeometry(80, 16, 8);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTopColor: { value: new THREE.Color(0x001a3a) },
      uHorizonColor: { value: new THREE.Color(0x0077b6) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: `
      uniform vec3 uTopColor;
      uniform vec3 uHorizonColor;
      varying vec3 vPos;
      void main() {
        float t = clamp((vPos.y + 10.0) / 60.0, 0.0, 1.0);
        gl_FragColor = vec4(mix(uHorizonColor, uTopColor, t), 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // Camera — low angle looking across the surface
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(0, 2.5, 14);
  camera.lookAt(0, 0.5, 0);

  // Normal map texture — procedural fallback, replaced when loaded
  const normalMapUrl = 'https://raw.githubusercontent.com/mrdoob/three.js/r128/examples/textures/waternormals.jpg';
  const loader = new THREE.TextureLoader();
  const normalMap = loader.load(normalMapUrl, tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  });
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;

  // Water mesh
  const waterGeo = new THREE.PlaneGeometry(120, 120, 80, 80);
  waterGeo.rotateX(-Math.PI / 2);

  let waviness = 0.5;

  const sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

  const waterUniforms = {
    uTime:      { value: 0 },
    uWaviness:  { value: waviness },
    uSunDir:    { value: sunDir },
    uNormalMap: { value: normalMap },
  };

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
  });

  const water = new THREE.Mesh(waterGeo, waterMat);
  scene.add(water);

  // Sun disc in sky
  const sunGeo = new THREE.CircleGeometry(4, 32);
  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xfff4c2,
    transparent: true,
    opacity: 0.95,
  });
  const sunDisc = new THREE.Mesh(sunGeo, sunMat);
  sunDisc.position.set(14, 18, -40);
  scene.add(sunDisc);

  // Sun glow halo
  const haloGeo = new THREE.CircleGeometry(9, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff9800,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(14, 18, -40.1);
  scene.add(halo);

  // Animate
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();
    waterUniforms.uTime.value = t;
    waterUniforms.uWaviness.value += (waviness - waterUniforms.uWaviness.value) * 0.02;

    // Gentle camera sway
    camera.position.x = Math.sin(t * 0.06) * 0.8;
    camera.position.y = 2.5 + Math.sin(t * 0.11) * 0.15;
    camera.lookAt(Math.sin(t * 0.05) * 0.5, 0.5, 0);

    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    // Use visualViewport if available — more accurate in PWA standalone mode
    const w = window.visualViewport ? window.visualViewport.width  : window.innerWidth;
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  window.addEventListener('resize', onResize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);

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
    'wind_direction_10m',
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
    windDirection: f.wind_direction_10m ?? null, // degrees
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


// Degrees → compass cardinal + intercardinal
function degreesToCompass(deg) {
  if (deg === null) return '—';
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
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
    <div class="stat">
      <span class="stat-icon">🧭</span>
      <span class="stat-value">${degreesToCompass(c.windDirection)}</span>
      <span class="stat-label">Wind dir</span>
    </div>
    <div class="stat">
      <span class="stat-icon">⏱️</span>
      <span class="stat-value">${c.wavePeriod !== null ? c.wavePeriod.toFixed(0) + 's' : '—'}</span>
      <span class="stat-label">Wave period</span>
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

// ── Geocoding (Open-Meteo, free, no key) ─────────────────────

async function geocodePlace(query) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');
  const r = await fetch(url);
  if (!r.ok) throw new Error('Geocoding failed.');
  const d = await r.json();
  return d.results || [];
}

// ── Main app flow ────────────────────────────────────────────

async function runForCoords(lat, lon, placeName, ocean) {
  hide('result');
  hide('error');
  show('loading');

  try {
    const [conditions, resolvedPlace] = await Promise.all([
      fetchConditions(lat, lon),
      placeName ? Promise.resolve(placeName) : getPlaceName(lat, lon),
    ]);

    const scored = scoreConditions(conditions);
    const verdict = getVerdict(scored.score);

    hide('loading');
    renderResult(conditions, scored.score, verdict, resolvedPlace, ocean);

    // Persist last location
    localStorage.setItem('sw_last', JSON.stringify({ lat, lon, name: resolvedPlace }));
  } catch (err) {
    hide('loading');
    document.getElementById('error-msg').textContent = err.message;
    show('error');
  }
}

// ── Boot ─────────────────────────────────────────────────────

const ocean = initOcean();

// ── Search bar logic ──────────────────────────────────────────

const input      = document.getElementById('location-input');
const geoBtn     = document.getElementById('geolocate-btn');
const searchBtn  = document.getElementById('search-btn');
const dropdown   = document.getElementById('autocomplete');
let acResults    = [];
let acTimer      = null;

// Last successfully resolved coords — used by retry/refresh
// so we never re-geocode an already-resolved display name
let lastCoords   = null; // { lat, lon, name }

function closeDropdown() {
  dropdown.classList.add('hidden');
  dropdown.innerHTML = '';
  acResults = [];
}

function renderDropdown(results) {
  dropdown.innerHTML = '';
  if (!results.length) { closeDropdown(); return; }
  results.forEach((r) => {
    const parts = [r.name, r.admin1, r.country].filter(Boolean);
    const el = document.createElement('div');
    el.className = 'ac-item';
    el.textContent = parts.join(', ');
    el.addEventListener('mousedown', e => e.preventDefault());
    el.addEventListener('click', () => {
      input.value = parts.join(', ');
      closeDropdown();
      // Store coords before running so retry/refresh work
      lastCoords = { lat: r.latitude, lon: r.longitude, name: r.name };
      runForCoords(r.latitude, r.longitude, r.name, ocean);
    });
    dropdown.appendChild(el);
  });
  dropdown.classList.remove('hidden');
}

input.addEventListener('input', () => {
  // User is editing — clear stored coords so next run geocodes fresh
  lastCoords = null;
  clearTimeout(acTimer);
  const q = input.value.trim();
  if (q.length < 2) { closeDropdown(); return; }
  acTimer = setTimeout(async () => {
    try {
      const results = await geocodePlace(q);
      acResults = results;
      renderDropdown(results);
    } catch { closeDropdown(); }
  }, 300);
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { closeDropdown(); triggerSearch(); }
  if (e.key === 'Escape') closeDropdown();
});

input.addEventListener('blur', () => {
  setTimeout(closeDropdown, 150);
});

async function triggerSearch() {
  // If we already have resolved coords (picked from dropdown or geolocation),
  // just re-run — no geocoding needed
  if (lastCoords) {
    runForCoords(lastCoords.lat, lastCoords.lon, lastCoords.name, ocean);
    return;
  }

  const q = input.value.trim();
  if (!q) return;
  hide('result');
  hide('error');
  show('loading');
  try {
    const results = await geocodePlace(q);
    if (!results.length) throw new Error(`Couldn't find "${q}". Try a more specific location.`);
    const r = results[0];
    const name = [r.name, r.admin1, r.country].filter(Boolean).join(', ');
    input.value = name;
    lastCoords = { lat: r.latitude, lon: r.longitude, name: r.name };
    runForCoords(r.latitude, r.longitude, r.name, ocean);
  } catch (err) {
    hide('loading');
    document.getElementById('error-msg').textContent = err.message;
    show('error');
  }
}

searchBtn.addEventListener('click', () => { closeDropdown(); triggerSearch(); });

geoBtn.addEventListener('click', async () => {
  closeDropdown();
  lastCoords = null;
  geoBtn.disabled = true;
  geoBtn.textContent = '⏳';
  try {
    const { lat, lon } = await getLocation();
    const place = await getPlaceName(lat, lon);
    input.value = place;
    lastCoords = { lat, lon, name: place };
    runForCoords(lat, lon, place, ocean);
  } catch (err) {
    document.getElementById('error-msg').textContent = err.message;
    show('error');
  } finally {
    geoBtn.disabled = false;
    geoBtn.textContent = '📍';
  }
});

document.getElementById('retry-btn').addEventListener('click', () => {
  hide('error');
  triggerSearch();
});

document.getElementById('refresh-btn').addEventListener('click', () => {
  hide('result');
  triggerSearch();
});

// Restore last location from previous session
const last = (() => { try { return JSON.parse(localStorage.getItem('sw_last')); } catch { return null; } })();
if (last) {
  input.value = last.name;
  lastCoords = { lat: last.lat, lon: last.lon, name: last.name };
}