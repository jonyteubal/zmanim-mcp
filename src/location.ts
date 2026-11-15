export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  israel: boolean;
}

export interface PlaceInput {
  location?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

interface GeocodeHit {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  population?: number;
}

const cache = new Map<string, Place>();

export function assertTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    throw new Error(`"${timeZone}" is not a valid IANA time zone. Use a name like "America/Panama" or "Asia/Jerusalem".`);
  }
}

/** Israel's bounding box, for the one-day versus two-day holiday calendar. */
function inIsrael(latitude: number, longitude: number, timeZone: string): boolean {
  return timeZone === "Asia/Jerusalem" && latitude > 29.3 && latitude < 33.4 && longitude > 34.2 && longitude < 35.95;
}

export async function resolvePlace(input: PlaceInput, fetcher: typeof fetch = fetch): Promise<Place> {
  if (input.latitude !== undefined || input.longitude !== undefined) {
    if (input.latitude === undefined || input.longitude === undefined) throw new Error("Give both latitude and longitude.");
    if (!input.timezone) throw new Error("With coordinates, also give the IANA timezone (for example \"America/Panama\").");
    const timeZone = assertTimeZone(input.timezone);
    return {
      name: input.location ?? `${input.latitude.toFixed(4)}, ${input.longitude.toFixed(4)}`,
      latitude: input.latitude, longitude: input.longitude, timeZone,
      israel: inIsrael(input.latitude, input.longitude, timeZone),
    };
  }
  const query = input.location?.trim();
  if (!query) throw new Error("Give a location (a city name) or latitude, longitude and timezone.");
  const key = query.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  // The geocoder matches place names only, so "Panama City, Panama" is
  // searched as "Panama City" and the rest picks among the candidates.
  const [city, ...rest] = query.split(",").map((part) => part.trim()).filter(Boolean);
  const hints = rest.map((part) => part.toLowerCase());
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=10&language=en&format=json`;
  let hits: GeocodeHit[];
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    hits = ((await response.json()) as { results?: GeocodeHit[] }).results ?? [];
  } catch (error) {
    throw new Error(`Could not look up "${query}" (${(error as Error).message}). Pass latitude, longitude and timezone instead.`);
  }
  const matches = (hit: GeocodeHit) => hints.every((hint) =>
    [hit.country, hit.country_code, hit.admin1].some((field) => field && (field.toLowerCase() === hint || field.toLowerCase().includes(hint))));
  const hit = (hints.length ? hits.find(matches) : undefined) ?? hits[0];
  if (!hit || !hit.timezone) throw new Error(`No place found for "${query}". Try a larger nearby city, or pass latitude, longitude and timezone.`);
  const place: Place = {
    name: [hit.name, hit.admin1 !== hit.name ? hit.admin1 : undefined, hit.country].filter(Boolean).join(", "),
    latitude: hit.latitude, longitude: hit.longitude, timeZone: hit.timezone,
    israel: hit.country_code === "IL",
  };
  cache.set(key, place);
  return place;
}
