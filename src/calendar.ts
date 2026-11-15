import { HDate, HebrewCalendar, flags, type Event } from "@hebcal/core";
import { addDays, type CivilDate } from "./solar.js";

// HDate reads the local getters of a JS Date, so civil dates are built in local time.
const toJs = (d: CivilDate) => new Date(d.year, d.month - 1, d.day);
const fromJs = (d: Date): CivilDate => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
const pad = (n: number) => String(n).padStart(2, "0");

export const isoDate = (d: CivilDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export function parseIsoDate(text: string): CivilDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) throw new Error(`"${text}" is not a date in YYYY-MM-DD form.`);
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = toJs(date);
  if (check.getMonth() + 1 !== date.month || check.getDate() !== date.day) throw new Error(`"${text}" is not a real calendar date.`);
  return date;
}

export function weekdayName(d: CivilDate): string {
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][toJs(d).getDay()];
}

export interface HebrewDateInfo {
  english: string;
  hebrew: string;
  day: number;
  month: string;
  year: number;
}

export function hebrewDate(d: CivilDate): HebrewDateInfo {
  const hd = new HDate(toJs(d));
  return { english: hd.render("en"), hebrew: hd.renderGematriya(), day: hd.getDate(), month: hd.getMonthName(), year: hd.getFullYear() };
}

export interface CalendarEvent {
  date: string;
  weekday: string;
  name: string;
  hebrew: string;
  categories: string[];
  /** Work is forbidden as on Shabbat (Yom Tov). */
  yomTov: boolean;
}

function describe(ev: Event): CalendarEvent {
  const date = fromJs(ev.getDate().greg());
  return {
    date: isoDate(date), weekday: weekdayName(date),
    name: ev.render("en"), hebrew: ev.render("he"),
    categories: ev.getCategories(),
    yomTov: (ev.getFlags() & flags.CHAG) !== 0,
  };
}

/** Holidays, fasts, Rosh Chodesh and special Shabbatot from `start` through `end`. */
export function events(start: CivilDate, end: CivilDate, israel: boolean): CalendarEvent[] {
  return HebrewCalendar.calendar({ start: toJs(start), end: toJs(end), il: israel, sedrot: false, omer: true })
    .map(describe);
}

/** The Torah reading for the Shabbat on or after `d`; null when a holiday reading replaces it. */
export function parasha(d: CivilDate, israel: boolean): { name: string; hebrew: string; shabbat: string } | null {
  const saturday = addDays(d, (6 - toJs(d).getDay() + 7) % 7);
  const found = HebrewCalendar.calendar({ start: toJs(saturday), end: toJs(saturday), il: israel, sedrot: true, noHolidays: true })
    .find((ev) => (ev.getFlags() & flags.PARSHA_HASHAVUA) !== 0);
  return found ? { name: found.render("en"), hebrew: found.render("he"), shabbat: isoDate(saturday) } : null;
}

/** Gregorian date of a Hebrew date, e.g. (15, "Nisan", 5787). */
export function fromHebrew(day: number, month: string, year: number): { date: CivilDate; info: HebrewDateInfo } {
  let hd: HDate;
  try {
    hd = new HDate(day, month, year);
  } catch (error) {
    throw new Error(`Could not read the Hebrew date ${day} ${month} ${year}: ${(error as Error).message}`);
  }
  const date = fromJs(hd.greg());
  return { date, info: hebrewDate(date) };
}
