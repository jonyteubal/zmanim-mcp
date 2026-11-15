// Place resolution. City names are matched against a bundled GeoNames list
// (data/cities.txt), so the server never contacts an outside service.

export interface Place {
  name: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  israel: boolean;
  /** Other cities with the same name, most populous first. */
  otherMatches?: string[];
}

export interface PlaceInput {
  location?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

/** Returns the text of data/cities.txt: one city per line, tab separated, most populous first. */
export type CitySource = () => string | Promise<string>;

interface City {
  name: string;
  region: string;
  latitude: number;
  longitude: number;
  timeZone: string;
  country: string;
  /** Normalized name. */
  key: string;
  /** Normalized alternate names, comma separated; the first entry also holds the plain-ASCII name. */
  alternates: string;
}

const US_STATES: Record<string, string> = {
  al: "alabama", ak: "alaska", az: "arizona", ar: "arkansas", ca: "california", co: "colorado", ct: "connecticut",
  de: "delaware", fl: "florida", ga: "georgia", hi: "hawaii", id: "idaho", il: "illinois", in: "indiana", ia: "iowa",
  ks: "kansas", ky: "kentucky", la: "louisiana", me: "maine", md: "maryland", ma: "massachusetts", mi: "michigan",
  mn: "minnesota", ms: "mississippi", mo: "missouri", mt: "montana", ne: "nebraska", nv: "nevada", nh: "new hampshire",
  nj: "new jersey", nm: "new mexico", ny: "new york", nc: "north carolina", nd: "north dakota", oh: "ohio",
  ok: "oklahoma", or: "oregon", pa: "pennsylvania", ri: "rhode island", sc: "south carolina", sd: "south dakota",
  tn: "tennessee", tx: "texas", ut: "utah", vt: "vermont", va: "virginia", wa: "washington", wv: "west virginia",
  wi: "wisconsin", wy: "wyoming", dc: "district of columbia",
};
const COUNTRY_ALIASES: Record<string, string> = { usa: "us", "u.s.": "us", "u.s.a.": "us", america: "us", uk: "gb", england: "gb", britain: "gb" };

// Letters that Unicode does not split into a base letter and an accent.
const UNDECOMPOSED: Record<string, string> = { "ø": "o", "æ": "ae", "ß": "ss", "đ": "d", "ł": "l", "ı": "i" };

/** Lowercase, without accents or vowel points. */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-֑ͯ-ׇ]/g, "").toLowerCase()
    .replace(/[øæßđłı]/g, (letter) => UNDECOMPOSED[letter]).replace(/\s+/g, " ").trim();
}

let parsed: Promise<City[]> | undefined;
function cities(source: CitySource): Promise<City[]> {
  parsed ??= Promise.resolve(source()).then((text) => text.split("\n").filter(Boolean).map((line) => {
    const [name, region, latitude, longitude, timeZone, country, alternates] = line.split("\t");
    return { name, region, latitude: Number(latitude), longitude: Number(longitude), timeZone, country, key: normalize(name), alternates: alternates ?? "" };
  }));
  return parsed;
}

function hasAlternate(city: City, query: string): boolean {
  const at = city.alternates.indexOf(query);
  if (at < 0) return false;
  const [first, ...rest] = city.alternates.split(",");
  return rest.includes(query) || ` ${first} `.includes(` ${query} `);
}

function matchesHint(city: City, hint: string): boolean {
  const region = normalize(city.region);
  const code = COUNTRY_ALIASES[hint] ?? hint;
  if (city.country === code) return true;
  if (city.country === "us" && US_STATES[hint] && region.startsWith(US_STATES[hint])) return true;
  // GeoNames spells some US states as two-letter codes ("ID, United States").
  if (city.country === "us") {
    const abbreviation = Object.keys(US_STATES).find((key) => US_STATES[key] === hint);
    if (abbreviation && region.startsWith(`${abbreviation},`)) return true;
  }
  return region.split(",").some((part) => part.trim() === hint) || region.includes(hint);
}

const label = (city: City) => `${city.name}, ${city.region}`;

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

export async function resolvePlace(input: PlaceInput, source: CitySource): Promise<Place> {
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
  const [cityPart, ...rest] = query.split(",").map(normalize).filter(Boolean);
  if (!cityPart) throw new Error("Give a location (a city name) or latitude, longitude and timezone.");
  const all = await cities(source);

  // Exact names outrank alternate spellings; within each group the list is by population.
  const find = (name: string) => [...all.filter((city) => city.key === name), ...all.filter((city) => city.key !== name && hasAlternate(city, name))];
  let candidates = find(cityPart);
  if (!candidates.length && cityPart.endsWith(" city")) candidates = find(cityPart.slice(0, -5));
  if (!candidates.length) throw new Error(`No place found for "${query}". Try a larger nearby city, or pass latitude, longitude and timezone.`);

  const matching = rest.length ? candidates.filter((city) => rest.every((hint) => matchesHint(city, hint))) : candidates;
  if (!matching.length) {
    throw new Error(`No place named "${cityPart}" matches "${rest.join(", ")}". Found: ${candidates.slice(0, 5).map(label).join("; ")}. Use one of these, or pass latitude, longitude and timezone.`);
  }
  const city = matching[0];
  const others = matching.slice(1).filter((other) => other.key === city.key).slice(0, 4).map(label);
  return {
    name: label(city),
    latitude: city.latitude, longitude: city.longitude, timeZone: city.timeZone,
    israel: city.country === "il",
    otherMatches: others.length ? others : undefined,
  };
}
