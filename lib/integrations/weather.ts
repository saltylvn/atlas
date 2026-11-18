import "server-only";
import { z } from "zod";
import { FEED_TIMEOUT_MS, safeFetchJson } from "@/lib/security/safeFetch";
import type { Weather } from "@/lib/domain/types";

// Open-Meteo: free, no key, no account. Coordinates come from Settings.
const schema = z.object({
  current: z.object({ temperature_2m: z.number(), weather_code: z.number() }),
  daily: z.object({
    temperature_2m_max: z.array(z.number()).min(1),
    temperature_2m_min: z.array(z.number()).min(1),
    precipitation_probability_max: z.array(z.number().nullable()).min(1),
  }),
});

export function describeCode(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorms";
}

export async function getWeather(lat: number, lon: number, place: string, timeZone: string): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&forecast_days=1&timezone=${encodeURIComponent(timeZone)}`;
  try {
    const parsed = schema.safeParse(await safeFetchJson(url, { revalidate: 1800, maxBytes: 100_000, timeoutMs: FEED_TIMEOUT_MS.weather }));
    if (!parsed.success) return null;
    const d = parsed.data;
    return {
      place,
      tempNowF: d.current.temperature_2m,
      highF: d.daily.temperature_2m_max[0]!,
      lowF: d.daily.temperature_2m_min[0]!,
      precipChance: d.daily.precipitation_probability_max[0] ?? 0,
      summary: describeCode(d.current.weather_code),
    };
  } catch {
    return null;
  }
}
