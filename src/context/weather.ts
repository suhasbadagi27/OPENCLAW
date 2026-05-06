import axios from 'axios';
import { config } from '../config';

export type WeatherCondition = 'clear' | 'rain' | 'storm' | 'fog';

export interface WeatherReport {
  condition: WeatherCondition;
  description: string;
  temp_celsius: number;
  feels_like: number;
  humidity: number;
  wind_kph: number;
  icon: string;
}

const OW_BASE = 'https://api.openweathermap.org/data/2.5';

function mapCondition(weatherId: number): WeatherCondition {
  if (weatherId >= 200 && weatherId < 300) return 'storm';
  if (weatherId >= 300 && weatherId < 600) return 'rain';
  if (weatherId >= 700 && weatherId < 800) return 'fog';
  return 'clear';
}

/** Get current weather for a location string (geocoded) */
export async function getWeatherForLocation(location: string): Promise<WeatherReport> {
  const geoRes = await axios.get(`${OW_BASE}/weather`, {
    params: {
      q: location,
      appid: config.openweather.apiKey,
      units: 'metric',
    },
  });

  const data = geoRes.data;
  const weatherId: number = data.weather[0].id;

  return {
    condition: mapCondition(weatherId),
    description: data.weather[0].description,
    temp_celsius: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    wind_kph: Math.round(data.wind.speed * 3.6),
    icon: data.weather[0].icon,
  };
}

/** Get weather by lat/lon */
export async function getWeatherByCoords(lat: number, lon: number): Promise<WeatherReport> {
  const res = await axios.get(`${OW_BASE}/weather`, {
    params: {
      lat,
      lon,
      appid: config.openweather.apiKey,
      units: 'metric',
    },
  });

  const data = res.data;
  const weatherId: number = data.weather[0].id;

  return {
    condition: mapCondition(weatherId),
    description: data.weather[0].description,
    temp_celsius: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    wind_kph: Math.round(data.wind.speed * 3.6),
    icon: data.weather[0].icon,
  };
}

export function weatherEmoji(condition: WeatherCondition): string {
  const map: Record<WeatherCondition, string> = {
    clear: '☀️',
    rain: '☔',
    storm: '⛈️',
    fog: '🌫️',
  };
  return map[condition];
}
