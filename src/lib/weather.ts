/**
 * Weather utility using Open-Meteo API (free, no API key needed).
 */

export interface WeatherData {
  temp: number; // °F
  description: string; // e.g. "Partly Cloudy"
  emoji: string; // e.g. "⛅"
  windSpeed: number; // mph
  humidity: number; // %
  summary: string; // e.g. "72°F ⛅ Partly Cloudy"
}

// WMO Weather Codes → description + emoji
const WEATHER_CODES: Record<number, { description: string; emoji: string }> = {
  0: { description: 'Clear Sky', emoji: '☀️' },
  1: { description: 'Mainly Clear', emoji: '🌤️' },
  2: { description: 'Partly Cloudy', emoji: '⛅' },
  3: { description: 'Overcast', emoji: '☁️' },
  45: { description: 'Foggy', emoji: '🌫️' },
  48: { description: 'Rime Fog', emoji: '🌫️' },
  51: { description: 'Light Drizzle', emoji: '🌦️' },
  53: { description: 'Drizzle', emoji: '🌦️' },
  55: { description: 'Heavy Drizzle', emoji: '🌧️' },
  56: { description: 'Freezing Drizzle', emoji: '🌧️' },
  57: { description: 'Heavy Freezing Drizzle', emoji: '🌧️' },
  61: { description: 'Light Rain', emoji: '🌦️' },
  63: { description: 'Rain', emoji: '🌧️' },
  65: { description: 'Heavy Rain', emoji: '🌧️' },
  66: { description: 'Freezing Rain', emoji: '🌧️' },
  67: { description: 'Heavy Freezing Rain', emoji: '🌧️' },
  71: { description: 'Light Snow', emoji: '🌨️' },
  73: { description: 'Snow', emoji: '❄️' },
  75: { description: 'Heavy Snow', emoji: '❄️' },
  77: { description: 'Snow Grains', emoji: '❄️' },
  80: { description: 'Light Showers', emoji: '🌦️' },
  81: { description: 'Showers', emoji: '🌧️' },
  82: { description: 'Heavy Showers', emoji: '🌧️' },
  85: { description: 'Light Snow Showers', emoji: '🌨️' },
  86: { description: 'Heavy Snow Showers', emoji: '❄️' },
  95: { description: 'Thunderstorm', emoji: '⛈️' },
  96: { description: 'Thunderstorm w/ Hail', emoji: '⛈️' },
  99: { description: 'Thunderstorm w/ Heavy Hail', emoji: '⛈️' },
};

export async function fetchWeather(latitude: number, longitude: number): Promise<WeatherData | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&temperature_unit=fahrenheit&wind_speed_unit=mph`;

    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      console.error('Open-Meteo error:', res.status);
      return null;
    }

    const data = await res.json();
    const current = data.current;
    if (!current) return null;

    const temp = Math.round(current.temperature_2m);
    const weatherCode = current.weather_code ?? 0;
    const windSpeed = Math.round(current.wind_speed_10m);
    const humidity = Math.round(current.relative_humidity_2m);

    const info = WEATHER_CODES[weatherCode] || { description: 'Unknown', emoji: '🌡️' };

    return {
      temp,
      description: info.description,
      emoji: info.emoji,
      windSpeed,
      humidity,
      summary: `${temp}°F ${info.emoji} ${info.description}`,
    };
  } catch (err) {
    console.error('Weather fetch failed:', err);
    return null;
  }
}
