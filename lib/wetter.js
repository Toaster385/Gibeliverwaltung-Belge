// Wetter für Achseten (Adelboden BE, 1285 m ü. M.) über Open-Meteo (kostenlos, ohne Schlüssel).
// Der Server holt die Daten und hält sie 30 Minuten im Zwischenspeicher: schont das Handy bei langsamem Internet
// und es gibt höchstens ein paar Anfragen pro Stunde. Fällt der Dienst aus, werden bis zu 6 Stunden alte Daten gezeigt.
const ORT = { name: 'Achseten', hoehe: 1285, lat: 46.4936, lon: 7.5586 };
const FRISCH_MS = 30 * 60 * 1000;
const NOTFALL_MS = 6 * 3600 * 1000;
const URL_BASIS = process.env.WETTER_URL || 'https://api.open-meteo.com/v1/forecast';

function url() {
  const p = new URLSearchParams({
    latitude: ORT.lat, longitude: ORT.lon, timezone: 'Europe/Zurich', forecast_days: '7', wind_speed_unit: 'kmh',
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,is_day,snow_depth',
    hourly: 'temperature_2m,precipitation_probability,weather_code,snowfall',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,sunrise,sunset'
  });
  return `${URL_BASIS}?${p}`;
}

const runde = (n, d = 0) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

// Reduziert die Open-Meteo-Antwort auf das, was die App anzeigt
function aufbereiten(j) {
  const c = j.current || {}, d = j.daily || {}, h = j.hourly || {};
  const jetzt = c.time || '';
  const tage = (d.time || []).map((t, i) => ({
    datum: t, code: d.weather_code[i], max: runde(d.temperature_2m_max[i]), min: runde(d.temperature_2m_min[i]),
    regen: runde(d.precipitation_sum[i], 1), schnee: runde(d.snowfall_sum[i], 1),
    sonnenaufgang: (d.sunrise[i] || '').slice(11, 16), sonnenuntergang: (d.sunset[i] || '').slice(11, 16)
  }));
  const stunden = [];
  (h.time || []).forEach((t, i) => {
    if (t >= jetzt.slice(0, 13) + ':00' && stunden.length < 24) {
      stunden.push({ zeit: t.slice(11, 16), temp: runde(h.temperature_2m[i]), regenWahrsch: h.precipitation_probability ? h.precipitation_probability[i] : null, code: h.weather_code[i], schnee: runde(h.snowfall[i], 1) });
    }
  });
  return {
    ort: ORT.name, hoehe: ORT.hoehe,
    jetzt: { temp: runde(c.temperature_2m), gefuehlt: runde(c.apparent_temperature), code: c.weather_code, wind: runde(c.wind_speed_10m), boeen: runde(c.wind_gusts_10m), tag: c.is_day === 1, schneehoeheCm: c.snow_depth != null ? runde(c.snow_depth * 100) : null },
    stunden, tage
  };
}

let cache = null; // { zeit, daten }
let laufend = null;

async function holeWetter() {
  if (cache && Date.now() - cache.zeit < FRISCH_MS) return { ...cache.daten, stand: cache.zeit, veraltet: false };
  if (!laufend) {
    laufend = (async () => {
      const res = await fetch(url(), { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error('Wetterdienst antwortet mit ' + res.status);
      const daten = aufbereiten(await res.json());
      cache = { zeit: Date.now(), daten };
      return daten;
    })().finally(() => { laufend = null; });
  }
  try {
    const daten = await laufend;
    return { ...daten, stand: cache.zeit, veraltet: false };
  } catch (e) {
    if (cache && Date.now() - cache.zeit < NOTFALL_MS) return { ...cache.daten, stand: cache.zeit, veraltet: true };
    throw e;
  }
}

module.exports = { holeWetter, aufbereiten, ORT };
