import assert from "node:assert/strict";
import { test } from "node:test";
import { Location, Zmanim } from "@hebcal/core";
import { events, fromHebrew, hebrewDate, isoDate, parasha, parseIsoDate } from "../dist/calendar.js";
import { resolvePlace } from "../dist/location.js";
import { SolarCalculator, localMidnight } from "../dist/solar.js";
import { computeZmanim, displayInstant, formatTime, nextShabbat } from "../dist/zmanim.js";

const PLACES = [
  ["Panama", 8.9824, -79.5199, "America/Panama"],
  ["Jerusalem", 31.7683, 35.2137, "Asia/Jerusalem"],
  ["New York", 40.7128, -74.006, "America/New_York"],
  ["Sydney", -33.8688, 151.2093, "Australia/Sydney"],
  ["London", 51.5074, -0.1278, "Europe/London"],
  ["Honolulu", 21.3069, -157.8583, "Pacific/Honolulu"],
];
const DATES = ["2026-01-15", "2026-03-29", "2026-06-21", "2026-09-25", "2026-11-01", "2026-12-21"];

// Independent check: hebcal's NOAA implementation must agree within a minute.
test("sunrise and sunset agree with hebcal everywhere", () => {
  for (const [name, lat, lon, tz] of PLACES) {
    for (const text of DATES) {
      const date = parseIsoDate(text);
      const solar = new SolarCalculator(lat, lon, tz);
      const theirs = new Zmanim(new Location(lat, lon, false, tz, name, "XX"), new Date(date.year, date.month - 1, date.day), false);
      for (const [label, ours, ref] of [["sunrise", solar.sunrise(date), theirs.sunrise()], ["sunset", solar.sunset(date), theirs.sunset()]]) {
        const diff = Math.abs(ours - ref.getTime()) / 1000;
        assert.ok(diff < 60, `${name} ${text} ${label} differs by ${diff.toFixed(0)}s`);
        const local = formatTime(ours, tz);
        assert.ok(label === "sunrise" ? local < "09:00" : local > "15:30", `${name} ${text} ${label} at ${local}`);
      }
    }
  }
});

test("Panama matches the app's test: sunset in the 18:00 hour, zmanim in order", () => {
  const z = computeZmanim(parseIsoDate("2026-09-25"), 8.9824, -79.5199, "America/Panama");
  const at = Object.fromEntries(z.zmanim.map((x) => [x.id, x.at]));
  assert.equal(formatTime(at.shkia, "America/Panama").slice(0, 2), "18");
  assert.ok(at.netz < at.chatzot && at.chatzot < at.shkia && at.shkia < at.tzeit);
  assert.ok(at.shemaMGA < at.shemaGRA);
  assert.deepEqual(z.zmanim.map((x) => x.at), [...z.zmanim.map((x) => x.at)].sort((a, b) => a - b));
  assert.equal(z.zmanim.length, 13);
  // Ovadia: alot is 1.2 seasonal hours before sunrise.
  assert.ok(Math.abs((at.netz - at.alot) / 60000 - 1.2 * z.shaahZmanitMinutes) < 1e-6);
});

test("dawn and nightfall methods change only what they should", () => {
  const args = [parseIsoDate("2026-06-21"), 40.7128, -74.006, "America/New_York"];
  const pick = (r, id) => r.zmanim.find((x) => x.id === id).at;
  const ovadia = computeZmanim(...args);
  const fixed = computeZmanim(...args, { dawn: "fixed72" });
  const posen = computeZmanim(...args, { dawn: "posen" });
  assert.equal(pick(fixed, "netz") - pick(fixed, "alot"), 72 * 60000);
  assert.equal(pick(ovadia, "shemaGRA"), pick(posen, "shemaGRA"));
  assert.notEqual(pick(ovadia, "alot"), pick(posen, "alot"));
  assert.ok(pick(computeZmanim(...args, { nightfall: "6deg" }), "tzeit") < pick(ovadia, "tzeit"));
  assert.ok(pick(computeZmanim(...args, { elevationMeters: 800 }), "netz") < pick(ovadia, "netz"));
});

test("polar day gives no zmanim; high latitude drops only the angle-based ones", () => {
  assert.equal(computeZmanim(parseIsoDate("2026-06-21"), 69.6492, 18.9553, "Europe/Oslo"), null);
  const london = computeZmanim(parseIsoDate("2026-06-21"), 51.5074, -0.1278, "Europe/London", { dawn: "posen" });
  assert.ok(london.unavailable.includes("Alot HaShachar"));
  assert.ok(london.zmanim.some((x) => x.id === "shkia"));
});

test("display rounding: deadlines down, beginnings up", () => {
  assert.equal(displayInstant(90_000, true), 60_000);
  assert.equal(displayInstant(90_000, false), 120_000);
  assert.equal(displayInstant(120_000, false), 120_000);
});

test("Shabbat times: offsets, week selection, after Havdalah", () => {
  const tz = "America/Panama";
  const at = (text, hour) => localMidnight(parseIsoDate(text), tz) + hour * 3600_000;
  const solar = new SolarCalculator(8.9824, -79.5199, tz);
  const wed = nextShabbat(at("2026-11-11", 12), 8.9824, -79.5199, tz);
  assert.equal(isoDate(wed.friday), "2026-11-13");
  assert.equal(wed.candleLighting, solar.sunset(wed.friday) - 18 * 60000);
  assert.equal(wed.havdalah, solar.sunset(wed.saturday) + 40 * 60000);
  assert.equal(isoDate(nextShabbat(at("2026-11-13", 20), 8.9824, -79.5199, tz).friday), "2026-11-13");
  assert.equal(isoDate(nextShabbat(at("2026-11-14", 10), 8.9824, -79.5199, tz).friday), "2026-11-13");
  assert.equal(isoDate(nextShabbat(at("2026-11-14", 23), 8.9824, -79.5199, tz).friday), "2026-11-20");
  assert.equal(isoDate(nextShabbat(at("2026-11-15", 9), 8.9824, -79.5199, tz).friday), "2026-11-20");
  const angle = nextShabbat(at("2026-11-11", 12), 8.9824, -79.5199, tz, 40, 0);
  assert.equal(angle.havdalah, solar.sunBelowHorizon(angle.saturday, 8.5, "set"));
  assert.equal(angle.candleLighting, solar.sunset(angle.friday) - 40 * 60000);
});

test("Hebrew calendar", () => {
  const pesach = hebrewDate(parseIsoDate("2026-04-02"));
  assert.deepEqual([pesach.day, pesach.month, pesach.year], [15, "Nisan", 5786]);
  assert.equal(isoDate(fromHebrew(15, "Nisan", 5786).date), "2026-04-02");
  assert.equal(isoDate(fromHebrew(10, "Tishrei", 5787).date), "2026-09-21");
  const day = events(parseIsoDate("2026-09-21"), parseIsoDate("2026-09-21"), false);
  assert.ok(day.some((e) => e.name === "Yom Kippur" && e.yomTov));
  const year = events(parseIsoDate("2026-09-01"), parseIsoDate("2027-08-31"), false);
  assert.equal(year.filter((e) => /^Chanukah: \d Candles?$/.test(e.name)).length, 8);
  assert.ok(parasha(parseIsoDate("2026-11-15"), false).name.includes("Vayetzei"));
  assert.throws(() => parseIsoDate("2026-02-30"));
  assert.throws(() => parseIsoDate("tomorrow"));
});

test("place lookup: coordinates, hints, failures", async () => {
  const direct = await resolvePlace({ latitude: 31.7683, longitude: 35.2137, timezone: "Asia/Jerusalem" });
  assert.equal(direct.israel, true);
  await assert.rejects(resolvePlace({ latitude: 8.98, longitude: -79.5 }), /timezone/);
  await assert.rejects(resolvePlace({ latitude: 8.98, longitude: -79.5, timezone: "Panama" }), /IANA/);
  await assert.rejects(resolvePlace({}), /location/);
  const results = [
    { name: "Panama City", latitude: 30.16, longitude: -85.66, timezone: "America/Chicago", country: "United States", country_code: "US", admin1: "Florida" },
    { name: "Panamá", latitude: 8.99, longitude: -79.52, timezone: "America/Panama", country: "Panama", country_code: "PA", admin1: "Panamá" },
  ];
  let asked = "";
  const fake = async (url) => { asked = String(url); return { ok: true, json: async () => ({ results }) }; };
  const hinted = await resolvePlace({ location: "Panama City, Panama" }, fake);
  assert.equal(hinted.timeZone, "America/Panama");
  assert.match(asked, /name=Panama%20City&/);
  assert.equal((await resolvePlace({ location: "Panama City, Florida" }, fake)).timeZone, "America/Chicago");
  await assert.rejects(resolvePlace({ location: "Nowhereville" }, async () => ({ ok: true, json: async () => ({}) })), /No place found/);
  await assert.rejects(resolvePlace({ location: "Offline" }, async () => { throw new Error("network down"); }), /latitude, longitude and timezone/);
});
