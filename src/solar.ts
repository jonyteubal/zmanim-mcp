// NOAA solar equations, ported from the Kavaná app (SolarCalculator.swift).
// Keep the two in step: the app and this server must give the same minute.

export type Edge = "rise" | "set";
export interface CivilDate { year: number; month: number; day: number }

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Official sunrise/sunset zenith: 90° plus refraction and the solar radius. */
export const HORIZON_ZENITH = 90.833;

/** Milliseconds that `timeZone` is ahead of UTC at `instant`. */
export function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(instant));
  const n = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  return local - Math.floor(instant / 1000) * 1000;
}

/** The instant of 00:00 local time on a civil date. */
export function localMidnight(date: CivilDate, timeZone: string): number {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  let t = guess - zoneOffsetMs(timeZone, guess);
  const again = guess - zoneOffsetMs(timeZone, t);
  if (again !== t) t = again;
  return t;
}

/** The civil date in `timeZone` at `instant`. */
export function civilDateAt(instant: number, timeZone: string): CivilDate {
  const d = new Date(instant + zoneOffsetMs(timeZone, instant));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(date: CivilDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** Geometric horizon dip, matching KosherJava's 6,356.9 km Earth radius. */
export function elevationDip(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  return deg(Math.acos(6_356_900 / (6_356_900 + meters)));
}

export class SolarCalculator {
  constructor(readonly latitude: number, readonly longitude: number, readonly timeZone: string) {}

  /** Instant (ms) the sun's centre reaches `zenith` degrees from vertical, or null if it never does. */
  time(date: CivilDate, zenith: number, edge: Edge): number | null {
    const utcMidnight = Date.UTC(date.year, date.month - 1, date.day);
    // First pass at local noon, second pass at the estimate, like NOAA's spreadsheet.
    const noon = localMidnight(date, this.timeZone) + 12 * 3600_000;
    const first = this.minutesUTC(noon, zenith, edge);
    if (first === null) return null;
    const second = this.minutesUTC(utcMidnight + first * 60_000, zenith, edge);
    if (second === null) return null;
    return utcMidnight + second * 60_000;
  }

  sunrise(date: CivilDate, elevation = 0) { return this.time(date, HORIZON_ZENITH + elevationDip(elevation), "rise"); }
  sunset(date: CivilDate, elevation = 0) { return this.time(date, HORIZON_ZENITH + elevationDip(elevation), "set"); }

  /** The sun `degrees` below the horizon before sunrise or after sunset. */
  sunBelowHorizon(date: CivilDate, degrees: number, edge: Edge) { return this.time(date, 90 + degrees, edge); }

  private minutesUTC(instant: number, zenith: number, edge: Edge): number | null {
    const jd = instant / 86_400_000 + 2440587.5;
    const t = (jd - 2451545) / 36525;
    const ha = this.hourAngle(sunDeclination(t), zenith);
    if (ha === null) return null;
    const noonUTC = 720 - 4 * this.longitude - equationOfTime(t);
    return edge === "rise" ? noonUTC - 4 * ha : noonUTC + 4 * ha;
  }

  private hourAngle(declination: number, zenith: number): number | null {
    const lat = rad(this.latitude);
    const dec = rad(declination);
    const cosHA = Math.cos(rad(zenith)) / (Math.cos(lat) * Math.cos(dec)) - Math.tan(lat) * Math.tan(dec);
    if (cosHA < -1 || cosHA > 1) return null;
    return deg(Math.acos(cosHA));
  }
}

function geomMeanLongitude(t: number) {
  const l = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  return l < 0 ? l + 360 : l;
}
const geomMeanAnomaly = (t: number) => 357.52911 + t * (35999.05029 - 0.0001537 * t);
const eccentricity = (t: number) => 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

function sunEquationOfCenter(t: number) {
  const m = rad(geomMeanAnomaly(t));
  return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
}

function sunApparentLongitude(t: number) {
  const omega = 125.04 - 1934.136 * t;
  return geomMeanLongitude(t) + sunEquationOfCenter(t) - 0.00569 - 0.00478 * Math.sin(rad(omega));
}

function obliquityCorrection(t: number) {
  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const mean = 23 + (26 + seconds / 60) / 60;
  return mean + 0.00256 * Math.cos(rad(125.04 - 1934.136 * t));
}

function sunDeclination(t: number) {
  return deg(Math.asin(Math.sin(rad(obliquityCorrection(t))) * Math.sin(rad(sunApparentLongitude(t)))));
}

function equationOfTime(t: number) {
  const l0 = rad(geomMeanLongitude(t));
  const e = eccentricity(t);
  const m = rad(geomMeanAnomaly(t));
  let y = Math.tan(rad(obliquityCorrection(t)) / 2);
  y *= y;
  const etime = y * Math.sin(2 * l0) - 2 * e * Math.sin(m) + 4 * e * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * e * e * Math.sin(2 * m);
  return deg(etime) * 4;
}
