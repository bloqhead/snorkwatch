# 🤿 SnorkWatch

> Should you be in the water right now?

A tiny, fun PWA that tells you whether it's a good day to snorkel based on your current location. Save it to your Home Screen for one-tap ocean intel.

---

## How it works

1. Asks for your location via the browser Geolocation API
2. Hits **Open-Meteo Marine API** for wave height, swell, wave period, and ocean current
3. Hits **Open-Meteo Forecast API** for wind speed, gusts, precipitation, UV index, and visibility
4. Scores conditions 0–100 using a weighted penalty/bonus system
5. Renders a verdict with a Three.js animated ocean background that reacts to conditions

**No API keys needed.** Everything is free and open.

---

## Scoring breakdown

| Factor         | Weight  | Notes                                      |
|----------------|---------|--------------------------------------------|
| Wave height    | ~30%    | < 0.5m ideal, > 2.5m dangerous             |
| Wind speed     | ~25%    | < 12 mph good, > 30 mph dangerous          |
| Visibility     | ~20%    | > 8km crystal, < 1.5km penalized           |
| Precipitation  | ~15%    | Zero rain is a bonus                        |
| Wave period    | ~10%    | Longer = smoother, shorter = choppier      |
| Bonuses        | —       | Calm winds, glassy seas, no rain, sunny UV |

Scores map to verdicts:
- **75–100** → Get in the water! 🤿
- **50–74** → Eh, maybe… 🌊
- **25–49** → Probably don't. 🌬️
- **0–24**  → Stay ashore. ⛈️

---

## Stack

- **Vanilla JS** (ES modules, no build step)
- **Three.js r128** — animated ocean surface
- **Open-Meteo Marine API** — free, no key
- **Open-Meteo Forecast API** — free, no key
- **Nominatim / OpenStreetMap** — reverse geocoding, free
- **PWA** — manifest + service worker, installable to Home Screen

---

## Deploy

This is a zero-dependency static site. Drop it anywhere:

- **Netlify**: drag & drop the folder
- **Vercel**: `vercel` from the project root
- **GitHub Pages**: push and enable Pages on `main`
- **Any static host**: just serve `index.html`

---

## Local dev

```bash
# Any static server works. Example with npx:
npx serve .

# Or Python:
python3 -m http.server 8080
```

> Note: Geolocation requires either `localhost` or HTTPS in production.

---

## License

MIT. Go snorkel.
