// Weather API — auto-fetch current weather from project address.
// GET ?address=... → { emoji, label, tempF, windMph }
// Uses Nominatim (OpenStreetMap) for geocoding + Open-Meteo for weather (both free, no API key).

import { NextRequest } from 'next/server';

// WMO weather code → our emoji mapping
function mapWeatherCode(code: number, tempF: number, windMph: number) {
  let emoji = '\u2600\uFE0F';   // ☀️
  let label = 'Clear';

  if (code >= 2 && code <= 3) { emoji = '\u26C5'; label = 'Cloudy'; }
  else if (code >= 45 && code <= 48) { emoji = '\u26C5'; label = 'Foggy'; }
  else if (code >= 51 && code <= 67) { emoji = '\uD83C\uDF27\uFE0F'; label = 'Rain'; }
  else if (code >= 71 && code <= 77) { emoji = '\u2744\uFE0F'; label = 'Snow'; }
  else if (code >= 80 && code <= 82) { emoji = '\uD83C\uDF27\uFE0F'; label = 'Showers'; }
  else if (code >= 85 && code <= 86) { emoji = '\u2744\uFE0F'; label = 'Snow'; }
  else if (code >= 95) { emoji = '\uD83C\uDF27\uFE0F'; label = 'Storm'; }

  // Override for extreme cold or wind
  if (tempF <= 35) { emoji = '\u2744\uFE0F'; label = 'Cold'; }
  if (windMph > 25) { emoji = '\uD83C\uDF2C\uFE0F'; label = 'Windy'; }

  return { emoji, label };
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) {
    return Response.json({ error: 'address required' }, { status: 400 });
  }

  try {
    // Step 1: Geocode address → lat/lon
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'ProjectCortex/1.0' } }
    );
    const geoData = await geoRes.json();

    if (!geoData.length) {
      return Response.json({ emoji: null, label: null });
    }

    const lat = parseFloat(geoData[0].lat);
    const lon = parseFloat(geoData[0].lon);

    // Step 2: Fetch current weather from Open-Meteo
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph`
    );
    const weatherData = await weatherRes.json();

    const current = weatherData.current;
    if (!current) {
      return Response.json({ emoji: null, label: null });
    }

    const tempF = Math.round(current.temperature_2m);
    const windMph = Math.round(current.wind_speed_10m);
    const { emoji, label } = mapWeatherCode(current.weather_code, tempF, windMph);

    return Response.json({ emoji, label, tempF, windMph });
  } catch (err) {
    console.error('Weather fetch error:', err);
    return Response.json({ emoji: null, label: null });
  }
}
