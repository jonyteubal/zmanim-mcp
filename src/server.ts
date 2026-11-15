import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { events, fromHebrew, hebrewDate, isoDate, parasha, parseIsoDate, weekdayName } from "./calendar.js";
import { assertTimeZone, resolvePlace, type Place } from "./location.js";
import { addDays, civilDateAt, localMidnight } from "./solar.js";
import { computeZmanim, displayInstant, formatTime, nextShabbat } from "./zmanim.js";

const NOTE = "Calculated times, accurate to about a minute at sea-level horizon. Terrain is not modeled. For practical halachic questions, follow your community's luach and rabbi.";

const place = {
  location: z.string().optional().describe("City name, optionally with country or region: \"Panama City, Panama\", \"Jerusalem\", \"Brooklyn, New York\"."),
  latitude: z.number().min(-90).max(90).optional().describe("Decimal degrees. Use with longitude and timezone instead of location."),
  longitude: z.number().min(-180).max(180).optional().describe("Decimal degrees, negative for west."),
  timezone: z.string().optional().describe("IANA time zone such as \"America/Panama\". Required with coordinates."),
};
const dateField = z.string().optional().describe("Civil date as YYYY-MM-DD. Defaults to today at that place.");

const placeSummary = (p: Place) => ({ name: p.name, latitude: p.latitude, longitude: p.longitude, timezone: p.timeZone });

function reply(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

async function guard(run: () => Promise<unknown>) {
  try {
    return reply(await run());
  } catch (error) {
    return { content: [{ type: "text" as const, text: (error as Error).message }], isError: true };
  }
}

/** One server per connection. `fetcher` lets a host add caching to the city lookup. */
export function createServer(fetcher: typeof fetch = fetch) {
const server = new McpServer({ name: "kavana-zmanim", version: "0.2.0" });

server.registerTool("get_zmanim", {
  title: "Zmanim for a day",
  description: "Halachic times of day (alot, misheyakir, sunrise, latest Shema and tefillah, chatzot, mincha, plag, sunset, nightfall) for one date and place. Defaults follow the Sephardic method of Rav Ovadia Yosef. Always tell the user which method the times use.",
  inputSchema: {
    ...place,
    date: dateField,
    dawn: z.enum(["ovadia", "posen", "chabad", "fixed72"]).optional().describe("Morning convention for alot, misheyakir and the Magen Avraham day. ovadia (default): 72 seasonal minutes. posen: 16.1 degrees. chabad: 16.9 degrees. fixed72: 72 clock minutes."),
    nightfall: z.enum(["8.5deg", "7.083deg", "6deg", "13.5min"]).optional().describe("Tzeit hakochavim: sun 8.5 (default), 7.083 or 6 degrees below the horizon, or 13.5 seasonal minutes after sunset."),
    elevation_meters: z.number().min(0).max(9000).optional().describe("Observer elevation; moves sunrise and sunset only. Default 0."),
  },
}, (args) => guard(async () => {
  const p = await resolvePlace(args, fetcher);
  const date = args.date ? parseIsoDate(args.date) : civilDateAt(Date.now(), p.timeZone);
  const result = computeZmanim(date, p.latitude, p.longitude, p.timeZone, {
    dawn: args.dawn, nightfall: args.nightfall, elevationMeters: args.elevation_meters,
  });
  if (!result) throw new Error(`The sun does not rise and set at ${p.name} on ${isoDate(date)}, so zmanim cannot be calculated there. Ask a rabbi how the community keeps time.`);
  return {
    place: placeSummary(p),
    date: isoDate(date),
    weekday: weekdayName(date),
    hebrew_date: hebrewDate(date).english,
    method: { dawn: result.method.dawn, nightfall: result.method.nightfall, elevation_meters: result.method.elevationMeters },
    seasonal_hour_minutes: Math.round(result.shaahZmanitMinutes * 10) / 10,
    zmanim: result.zmanim.map((z) => ({
      id: z.id, name: z.name, meaning: z.plain,
      time: formatTime(displayInstant(z.at, z.deadline), p.timeZone),
      kind: z.deadline ? "deadline" : "start",
      rule: z.rule,
    })),
    unavailable: result.unavailable,
    note: NOTE,
  };
}));

server.registerTool("get_shabbat_times", {
  title: "Shabbat candle-lighting and Havdalah",
  description: "Candle-lighting and Havdalah for the coming Shabbat (or the Shabbat of the week containing a given date), with the parasha and any holiday that falls on it. State the offsets used when answering.",
  inputSchema: {
    ...place,
    date: z.string().optional().describe("Any civil date (YYYY-MM-DD) in the week wanted. Defaults to now; on Saturday night after Havdalah it moves to next week."),
    candle_minutes: z.number().int().min(0).max(90).optional().describe("Minutes before Friday's sunset. Default 18. Jerusalem's custom is 40, Haifa 30."),
    havdalah_minutes: z.number().int().min(0).max(120).optional().describe("Minutes after Saturday's sunset. Default 40. Use 0 for the sun 8.5 degrees below the horizon; 72 for Rabbenu Tam."),
  },
}, (args) => guard(async () => {
  const p = await resolvePlace(args, fetcher);
  const reference = args.date ? localMidnight(parseIsoDate(args.date), p.timeZone) : Date.now();
  const shabbat = nextShabbat(reference, p.latitude, p.longitude, p.timeZone, args.candle_minutes ?? 18, args.havdalah_minutes ?? 40);
  if (!shabbat) throw new Error(`The sun does not set at ${p.name} that week, so candle-lighting cannot be calculated. Ask a rabbi how the community keeps Shabbat.`);
  const reading = parasha(shabbat.saturday, p.israel);
  const holidays = events(shabbat.friday, shabbat.saturday, p.israel).filter((e) => !e.categories.includes("omer"));
  return {
    place: placeSummary(p),
    candle_lighting: { date: isoDate(shabbat.friday), weekday: "Friday", time: formatTime(displayInstant(shabbat.candleLighting, true), p.timeZone), rule: shabbat.candleRule },
    havdalah: { date: isoDate(shabbat.saturday), weekday: "Saturday", time: formatTime(displayInstant(shabbat.havdalah, false), p.timeZone), rule: shabbat.havdalahRule },
    parasha: reading ? { name: reading.name, hebrew: reading.hebrew } : null,
    hebrew_date_of_shabbat: hebrewDate(shabbat.saturday).english,
    holidays,
    holiday_caution: holidays.some((e) => e.yomTov) ? "A Yom Tov falls on or next to this Shabbat, so candle-lighting and Havdalah practice differ (for example lighting from an existing flame, or no Havdalah until the festival ends). Mention this." : undefined,
    note: NOTE,
  };
}));

server.registerTool("get_hebrew_date", {
  title: "Hebrew date and calendar",
  description: "The Hebrew date for a civil date, what falls on it (holidays, fasts, Rosh Chodesh, omer count), the week's parasha, and optionally the holidays coming up. Use this for questions like \"what is today's Hebrew date\" or \"when is Chanukah\".",
  inputSchema: {
    date: z.string().optional().describe("Civil date as YYYY-MM-DD. Defaults to today in the given timezone."),
    timezone: z.string().optional().describe("IANA time zone used to decide what \"today\" is. Default UTC."),
    after_sunset: z.boolean().optional().describe("True if it is already after sunset there: the Hebrew date is then the next day's."),
    israel: z.boolean().optional().describe("True for the Israel calendar (one-day festivals, Israel parasha schedule). Default false, the diaspora calendar."),
    days_ahead: z.number().int().min(0).max(400).optional().describe("Also list everything in the calendar for this many days after the date. Default 0."),
  },
}, (args) => guard(async () => {
  const civil = args.date ? parseIsoDate(args.date) : civilDateAt(Date.now(), assertTimeZone(args.timezone ?? "UTC"));
  const day = args.after_sunset ? addDays(civil, 1) : civil;
  const israel = args.israel ?? false;
  const ahead = args.days_ahead ?? 0;
  const reading = parasha(day, israel);
  return {
    civil_date: isoDate(civil),
    weekday: weekdayName(civil),
    hebrew_date: hebrewDate(day),
    counted_after_sunset: args.after_sunset ?? false,
    today: events(day, day, israel),
    parasha: reading,
    upcoming: ahead > 0 ? events(addDays(day, 1), addDays(day, ahead), israel).filter((e) => !e.categories.includes("omer")) : undefined,
    calendar: israel ? "Israel" : "Diaspora",
    note: "The Hebrew day begins at sunset of the previous civil evening. Entries named \"Erev ...\" or \"Chanukah: N Candles\" are listed on the civil date whose evening starts them: the candle is lit that night.",
  };
}));

server.registerTool("convert_hebrew_date", {
  title: "Hebrew date to civil date",
  description: "The civil (Gregorian) date of a Hebrew date, for birthdays, yahrzeits and holidays. The Hebrew day begins the evening before the returned date.",
  inputSchema: {
    day: z.number().int().min(1).max(30),
    month: z.string().describe("Hebrew month name: Nisan, Iyyar, Sivan, Tamuz, Av, Elul, Tishrei, Cheshvan, Kislev, Tevet, Shvat, Adar, Adar I, Adar II."),
    year: z.number().int().min(1).max(9999).describe("Hebrew year, for example 5787."),
  },
}, (args) => guard(async () => {
  const { date, info } = fromHebrew(args.day, args.month, args.year);
  return {
    civil_date: isoDate(date),
    weekday: weekdayName(date),
    hebrew_date: info,
    begins: `At sunset on ${weekdayName(addDays(date, -1))}, ${isoDate(addDays(date, -1))}`,
  };
}));

return server;
}
