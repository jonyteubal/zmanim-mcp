import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { events, fromHebrew, hebrewDate, isoDate, parasha, parseIsoDate, weekdayName } from "./calendar.js";
import { assertTimeZone, resolvePlace, type CitySource, type Place } from "./location.js";
import { addDays, civilDateAt, localMidnight } from "./solar.js";
import { findBlessing, getPrayer, getPsalm, listPrayers, type TextSource } from "./texts.js";
import { computeZmanim, displayInstant, formatTime, nextShabbat } from "./zmanim.js";

// Every tool only reads, and none contacts an outside service.
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const NOTE = "Calculated times, accurate to about a minute at sea-level horizon. Terrain is not modeled. For practical halachic questions, follow your community's luach and rabbi.";

const place = {
  location: z.string().optional().describe("City name, optionally with country or region: \"Panama City, Panama\", \"Jerusalem\", \"Lakewood, New Jersey\". Matched against a built-in list of about 34,000 cities; add the region when several cities share a name."),
  latitude: z.number().min(-90).max(90).optional().describe("Decimal degrees. Use with longitude and timezone instead of location."),
  longitude: z.number().min(-180).max(180).optional().describe("Decimal degrees, negative for west."),
  timezone: z.string().optional().describe("IANA time zone such as \"America/Panama\". Required with coordinates."),
};
const dateField = z.string().optional().describe("Civil date as YYYY-MM-DD. Defaults to today at that place.");

const placeSummary = (p: Place) => ({
  name: p.name, latitude: p.latitude, longitude: p.longitude, timezone: p.timeZone,
  other_places_with_this_name: p.otherMatches,
});

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

/** One server per connection. `cities` supplies the bundled city list and `texts` the prayer text files. */
export function createServer(cities: CitySource, texts: TextSource) {
const server = new McpServer({ name: "kavana-zmanim", version: "0.5.0" });

server.registerTool("get_zmanim", {
  title: "Zmanim for a day",
  annotations: READ_ONLY,
  description: "Halachic times of day (alot, misheyakir, sunrise, latest Shema and tefillah, chatzot, mincha, plag, sunset, nightfall) for one date and place. Defaults follow the Sephardic method of Rav Ovadia Yosef. Each result names the calculation method that was applied.",
  inputSchema: {
    ...place,
    date: dateField,
    dawn: z.enum(["ovadia", "posen", "chabad", "fixed72"]).optional().describe("Morning convention for alot, misheyakir and the Magen Avraham day. ovadia (default): 72 seasonal minutes. posen: 16.1 degrees. chabad: 16.9 degrees. fixed72: 72 clock minutes."),
    nightfall: z.enum(["8.5deg", "7.083deg", "6deg", "13.5min"]).optional().describe("Tzeit hakochavim: sun 8.5 (default), 7.083 or 6 degrees below the horizon, or 13.5 seasonal minutes after sunset."),
    elevation_meters: z.number().min(0).max(9000).optional().describe("Observer elevation; moves sunrise and sunset only. Default 0."),
  },
}, (args) => guard(async () => {
  const p = await resolvePlace(args, cities);
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
  annotations: READ_ONLY,
  description: "Candle-lighting and Havdalah for the coming Shabbat (or the Shabbat of the week containing a given date), with the parasha and any holiday that falls on it. The result states the candle-lighting and Havdalah offsets that were applied.",
  inputSchema: {
    ...place,
    date: z.string().optional().describe("Any civil date (YYYY-MM-DD) in the week wanted. Defaults to now; on Saturday night after Havdalah it moves to next week."),
    candle_minutes: z.number().int().min(0).max(90).optional().describe("Minutes before Friday's sunset. Default 18. Jerusalem's custom is 40, Haifa 30."),
    havdalah_minutes: z.number().int().min(0).max(120).optional().describe("Minutes after Saturday's sunset. Default 40. Use 0 for the sun 8.5 degrees below the horizon; 72 for Rabbenu Tam."),
  },
}, (args) => guard(async () => {
  const p = await resolvePlace(args, cities);
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
    holiday_caution: holidays.some((e) => e.yomTov) ? "A Yom Tov falls on or next to this Shabbat, so candle-lighting and Havdalah practice differ (for example lighting from an existing flame, or no Havdalah until the festival ends). The times above are the ordinary Shabbat calculation." : undefined,
    note: NOTE,
  };
}));

server.registerTool("get_hebrew_date", {
  title: "Hebrew date and calendar",
  annotations: READ_ONLY,
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
  annotations: READ_ONLY,
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

const traditionField = z.enum(["sephardic", "ashkenaz", "sefard"]).optional().describe("Prayer tradition (nusach). sephardic (default) is Edot HaMizrach; ashkenaz; sefard is Nusach Sefard.");

server.registerTool("list_prayers", {
  title: "Prayers in the siddur",
  description: "The catalog of prayers whose text this server holds, grouped by service (Shacharit, Mincha, Arvit, Shabbat, blessings), for one tradition. Returns the prayer ids that get_prayer accepts.",
  annotations: READ_ONLY,
  inputSchema: { tradition: traditionField },
}, (args) => guard(() => listPrayers(texts, args.tradition)));

server.registerTool("get_prayer", {
  title: "Text of a prayer",
  description: "The Hebrew text of a prayer from the siddur, with English where the source provides it: for example shema, amidah, modeh ani, alenu, birkat hamazon, kiddush, havdalah, bedtime shema, traveler's prayer. Long prayers are returned in parts; next_offset gives the position of the next part.",
  annotations: READ_ONLY,
  inputSchema: {
    prayer: z.string().describe("Prayer name or id from list_prayers, for example \"shema\", \"amidah\", \"birkat hamazon\"."),
    service: z.string().optional().describe("Service, when the prayer appears in several: shacharit, mincha, arvit, shabbat_eve, shabbat_day, shabbat_mincha, extras. Default: the first service that has it, starting with weekday Shacharit."),
    tradition: traditionField,
    offset: z.number().int().min(0).optional().describe("Paragraph to start from. Use the next_offset of the previous reply to continue a long prayer."),
    include_english: z.boolean().optional().describe("Include the English translation where available. Default true."),
  },
}, (args) => guard(() => getPrayer(texts, args)));

server.registerTool("get_psalm", {
  title: "Text of a Psalm",
  description: "One chapter of Tehillim (Psalms) in Hebrew with vowels, with the JPS 1917 English translation.",
  annotations: READ_ONLY,
  inputSchema: {
    chapter: z.number().int().min(1).max(150).describe("Chapter number, 1 to 150."),
    include_english: z.boolean().optional().describe("Include the English translation. Default true."),
  },
}, (args) => guard(() => getPsalm(texts, args.chapter, args.include_english)));

server.registerTool("find_blessing", {
  title: "Blessing for a food",
  description: "The blessing (beracha) said before and after a food or drink, in Hebrew with transliteration and English, from a guide of common foods following Sephardic practice. With no food named, returns all the blessings before and after eating.",
  annotations: READ_ONLY,
  inputSchema: {
    food: z.string().optional().describe("A food or drink, in English or Spanish (\"banana\", \"rice\", \"wine\", \"pizza\"), or a blessing name (\"hamotzi\", \"shehakol\")."),
  },
}, (args) => guard(() => findBlessing(texts, args.food)));

return server;
}
