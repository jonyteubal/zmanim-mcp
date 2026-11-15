// Zmanim and Shabbat times, ported from the Kavaná app (Zmanim.swift, ShabbatTimes).
import { SolarCalculator, addDays, civilDateAt, weekday, type CivilDate } from "./solar.js";

export type Dawn = "ovadia" | "posen" | "chabad" | "fixed72";
export type Nightfall = "8.5deg" | "7.083deg" | "6deg" | "13.5min";

export interface ZmanimOptions {
  dawn?: Dawn;
  nightfall?: Nightfall;
  elevationMeters?: number;
}

export interface Zman {
  id: string;
  name: string;
  plain: string;
  rule: string;
  /** Instant in ms since the epoch, full precision. */
  at: number;
  /** True when the zman is a deadline: displayed rounded down, never up. */
  deadline: boolean;
}

const DAWN_RULES: Record<Dawn, { title: string; alot: string; misheyakir: string; mga: string }> = {
  ovadia: {
    title: "Rav Ovadia Yosef (seasonal minutes)",
    alot: "72 seasonal minutes before sunrise",
    misheyakir: "66 seasonal minutes before sunrise",
    mga: "MGA day: 72 seasonal minutes before sunrise to 72 seasonal minutes after sunset",
  },
  posen: {
    title: "Rav Meir Posen (equivalent degrees)",
    alot: "Sun 16.1° below the horizon",
    misheyakir: "Sun 11° below the horizon",
    mga: "MGA day: morning 16.1° to evening 16.1° below the horizon",
  },
  chabad: {
    title: "Chabad (published solar angles)",
    alot: "Sun 16.9° below the horizon",
    misheyakir: "Sun 10.2° below the horizon",
    mga: "MGA day: morning 16.9° to evening 16.9° below the horizon (symmetric calculation, not Chabad.org's published Shema deadline)",
  },
  fixed72: {
    title: "72 fixed minutes",
    alot: "72 fixed minutes before sunrise",
    misheyakir: "Sun 11.5° below the horizon",
    mga: "MGA day: 72 fixed minutes before sunrise to 72 fixed minutes after sunset",
  },
};

const NIGHTFALL: Record<Nightfall, { title: string; degrees: number | null }> = {
  "8.5deg": { title: "Sun 8.5° below the horizon", degrees: 8.5 },
  "7.083deg": { title: "Sun 7.083° below the horizon", degrees: 7 + 1 / 12 },
  "6deg": { title: "Sun 6° below the horizon", degrees: 6 },
  "13.5min": { title: "13.5 seasonal minutes after sunset", degrees: null },
};

export interface ZmanimResult {
  zmanim: Zman[];
  unavailable: string[];
  method: { dawn: string; nightfall: string; elevationMeters: number };
  shaahZmanitMinutes: number;
}

/** Null when the sun does not rise and set on that day at that place. */
export function computeZmanim(date: CivilDate, latitude: number, longitude: number, timeZone: string, options: ZmanimOptions = {}): ZmanimResult | null {
  const dawn = options.dawn ?? "ovadia";
  const nightfall = options.nightfall ?? "8.5deg";
  const elevation = options.elevationMeters ?? 0;
  const solar = new SolarCalculator(latitude, longitude, timeZone);
  const rise = solar.sunrise(date, elevation);
  const set = solar.sunset(date, elevation);
  if (rise === null || set === null || set <= rise) return null;
  const hour = (set - rise) / 12;
  const minute = 60_000;

  let alot: number | null, misheyakir: number | null, mgaEnd: number | null;
  switch (dawn) {
    case "fixed72":
      alot = rise - 72 * minute;
      misheyakir = solar.sunBelowHorizon(date, 11.5, "rise");
      mgaEnd = set + 72 * minute;
      break;
    case "posen":
      alot = solar.sunBelowHorizon(date, 16.1, "rise");
      misheyakir = solar.sunBelowHorizon(date, 11, "rise");
      mgaEnd = solar.sunBelowHorizon(date, 16.1, "set");
      break;
    case "chabad":
      alot = solar.sunBelowHorizon(date, 16.9, "rise");
      misheyakir = solar.sunBelowHorizon(date, 10.2, "rise");
      mgaEnd = solar.sunBelowHorizon(date, 16.9, "set");
      break;
    default:
      alot = rise - 1.2 * hour;
      misheyakir = rise - 1.1 * hour;
      mgaEnd = set + 1.2 * hour;
  }
  let shemaMGA: number | null = null, tefilaMGA: number | null = null;
  if (alot !== null && mgaEnd !== null && mgaEnd > alot) {
    const mgaHour = (mgaEnd - alot) / 12;
    shemaMGA = alot + 3 * mgaHour;
    tefilaMGA = alot + 4 * mgaHour;
  }
  const night = NIGHTFALL[nightfall];
  const tzeit = night.degrees !== null ? solar.sunBelowHorizon(date, night.degrees, "set") : set + (13.5 * hour) / 60;
  const rules = DAWN_RULES[dawn];

  const rows: [string, string, string, string, number | null, boolean][] = [
    ["alot", "Alot HaShachar", "Halachic dawn", rules.alot, alot, false],
    ["misheyakir", "Misheyakir", "Earliest tallit and tefillin", rules.misheyakir, misheyakir, false],
    ["netz", "Netz HaChamah", "Sunrise", "Calculated sunrise; terrain is not modeled", rise, false],
    ["shemaMGA", "Sof zman Shema (MGA)", "Latest Shema, Magen Avraham", rules.mga, shemaMGA, true],
    ["shemaGRA", "Sof zman Shema (GRA)", "Latest Shema, Gra", "3 seasonal hours from sunrise to sunset", rise + 3 * hour, true],
    ["tefilaMGA", "Sof zman tefillah (MGA)", "Latest Shacharit, Magen Avraham", "4 seasonal hours using the MGA day", tefilaMGA, true],
    ["tefilaGRA", "Sof zman tefillah (GRA)", "Latest Shacharit, Gra", "4 seasonal hours from sunrise to sunset", rise + 4 * hour, true],
    ["chatzot", "Chatzot", "Halachic midday", "Midpoint between sunrise and sunset", rise + 6 * hour, false],
    ["minchaGedola", "Mincha Gedolah", "Earliest Mincha", "6.5 seasonal hours from sunrise", rise + 6.5 * hour, false],
    ["minchaKetana", "Mincha Ketanah", "Preferred time for Mincha", "9.5 seasonal hours from sunrise", rise + 9.5 * hour, false],
    ["plag", "Plag HaMincha", "Plag HaMincha", "10.75 seasonal hours from sunrise", rise + 10.75 * hour, false],
    ["shkia", "Shkiah", "Sunset", "Calculated sunset; terrain is not modeled", set, true],
    ["tzeit", "Tzeit HaKochavim", "Nightfall", night.title, tzeit, false],
  ];
  const zmanim: Zman[] = [];
  const unavailable: string[] = [];
  for (const [id, name, plain, rule, at, deadline] of rows) {
    if (at === null) unavailable.push(name);
    else zmanim.push({ id, name, plain, rule, at, deadline });
  }
  zmanim.sort((a, b) => a.at - b.at);
  return {
    zmanim,
    unavailable,
    method: { dawn: rules.title, nightfall: night.title, elevationMeters: elevation },
    shaahZmanitMinutes: hour / minute,
  };
}

export interface ShabbatResult {
  friday: CivilDate;
  saturday: CivilDate;
  candleLighting: number;
  havdalah: number;
  candleRule: string;
  havdalahRule: string;
}

/**
 * The coming (or current) Shabbat for `reference`. On Saturday it stays with
 * that Shabbat until Havdalah, then moves to the next week.
 * `havdalahMinutes` of 0 means the sun 8.5° below the horizon.
 */
export function nextShabbat(reference: number, latitude: number, longitude: number, timeZone: string, candleMinutes = 18, havdalahMinutes = 40): ShabbatResult | null {
  const solar = new SolarCalculator(latitude, longitude, timeZone);
  let today = civilDateAt(reference, timeZone);
  for (let attempt = 0; attempt < 2; attempt++) {
    const dow = weekday(today);
    const friday = addDays(today, dow === 6 ? -1 : (5 - dow + 7) % 7);
    const saturday = addDays(friday, 1);
    const fridaySunset = solar.sunset(friday);
    const saturdaySunset = solar.sunset(saturday);
    if (fridaySunset === null || saturdaySunset === null) return null;
    let havdalah: number;
    let havdalahRule: string;
    if (havdalahMinutes > 0) {
      havdalah = saturdaySunset + havdalahMinutes * 60_000;
      havdalahRule = `${havdalahMinutes} minutes after Saturday's sunset`;
    } else {
      const byAngle = solar.sunBelowHorizon(saturday, 8.5, "set");
      havdalah = byAngle ?? saturdaySunset + 40 * 60_000;
      havdalahRule = byAngle !== null ? "Sun 8.5° below the horizon" : "40 minutes after sunset (8.5° is not reached at this latitude today)";
    }
    if (dow === 6 && reference >= havdalah) {
      today = addDays(today, 1);
      continue;
    }
    return {
      friday, saturday, havdalah, havdalahRule,
      candleLighting: fridaySunset - candleMinutes * 60_000,
      candleRule: `${candleMinutes} minutes before Friday's sunset`,
    };
  }
  return null;
}

/** Deadlines round down to the minute, beginnings round up, as in the app. */
export function displayInstant(at: number, deadline: boolean): number {
  const minutes = at / 60_000;
  return (deadline ? Math.floor(minutes) : Math.ceil(minutes)) * 60_000;
}

export function formatTime(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at));
}
