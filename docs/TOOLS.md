# Tool documentation

Server: `https://zmanim.kavana-ai.workers.dev/mcp`
Transport: MCP over Streamable HTTP, stateless, POST only, JSON responses.
Authentication: none. There are no accounts, scopes, or credentials.

## Summary

| Tool | Classification | Sensitive | Side effects | Calls outside the server |
| --- | --- | --- | --- | --- |
| `get_zmanim` | Read | No | None | None |
| `get_shabbat_times` | Read | No | None | None |
| `get_hebrew_date` | Read | No | None | None |
| `convert_hebrew_date` | Read | No | None | None |

Every tool is a pure calculation. No tool creates, changes, or deletes data,
changes permissions, sends anything, or acts on a user's behalf. The MCP
annotations on every tool are `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`. The same input returns the same output, apart from
"today" and "the coming Shabbat" when no date is given.

## Setup

Add the endpoint URL to any MCP client that supports Streamable HTTP. No
configuration, key, or sign-in is needed. To test without a client:

    curl -s https://zmanim.kavana-ai.workers.dev/mcp \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_shabbat_times","arguments":{"location":"Miami"}}}'

## Place inputs (shared by `get_zmanim` and `get_shabbat_times`)

Give either `location`, or all three of `latitude`, `longitude`, `timezone`.

| Input | Type | Notes |
| --- | --- | --- |
| `location` | string | City name, optionally with country or region: "Panama City, Panama". Matched against a built-in list of about 34,000 cities. When several cities share the name, the most populous is used and the others are listed in `place.other_places_with_this_name` |
| `latitude` | number | -90 to 90 |
| `longitude` | number | -180 to 180, negative for west |
| `timezone` | string | IANA name such as "America/Panama". Required with coordinates |

## `get_zmanim`

Halachic times of day for one date and place.

Inputs (all optional except the place):

| Input | Type | Default | Values |
| --- | --- | --- | --- |
| `date` | string | Today at that place | YYYY-MM-DD |
| `dawn` | string | `ovadia` | `ovadia`, `posen`, `chabad`, `fixed72` |
| `nightfall` | string | `8.5deg` | `8.5deg`, `7.083deg`, `6deg`, `13.5min` |
| `elevation_meters` | number | 0 | 0 to 9000 |

Output (JSON text): `place` (name, latitude, longitude, timezone), `date`,
`weekday`, `hebrew_date`, `method` (dawn, nightfall, elevation),
`seasonal_hour_minutes`, `zmanim` (up to 13 entries, each with `id`, `name`,
`meaning`, `time` as local HH:mm, `kind` of `deadline` or `start`, and the
`rule` used), `unavailable` (names of times the sun does not reach that day),
and `note`.

## `get_shabbat_times`

Candle-lighting and Havdalah for the coming Shabbat, or for the Shabbat of the
week containing `date`.

| Input | Type | Default | Values |
| --- | --- | --- | --- |
| `date` | string | Now | YYYY-MM-DD, any day in the week wanted |
| `candle_minutes` | integer | 18 | 0 to 90, minutes before Friday's sunset |
| `havdalah_minutes` | integer | 40 | 0 to 120, minutes after Saturday's sunset. 0 selects the sun 8.5° below the horizon |

Output: `place`, `candle_lighting` and `havdalah` (each with `date`, `weekday`,
`time`, `rule`), `parasha` (name in English and Hebrew, or null when a holiday
reading replaces it), `hebrew_date_of_shabbat`, `holidays` on that Friday and
Saturday, `holiday_caution` when a Yom Tov is adjacent, and `note`.

## `get_hebrew_date`

The Hebrew date of a civil date and what falls on it.

| Input | Type | Default | Values |
| --- | --- | --- | --- |
| `date` | string | Today in `timezone` | YYYY-MM-DD |
| `timezone` | string | UTC | IANA name, used only to decide "today" |
| `after_sunset` | boolean | false | true returns the next Hebrew day |
| `israel` | boolean | false | true uses the Israel calendar |
| `days_ahead` | integer | 0 | 0 to 400, also list the following days |

Output: `civil_date`, `weekday`, `hebrew_date` (English, Hebrew, day, month,
year), `today` (holidays, fasts, Rosh Chodesh, omer count), `parasha`,
`upcoming` when `days_ahead` is set, `calendar` (Israel or Diaspora), `note`.

## `convert_hebrew_date`

The civil date of a Hebrew date.

| Input | Type | Required | Values |
| --- | --- | --- | --- |
| `day` | integer | Yes | 1 to 30 |
| `month` | string | Yes | Nisan, Iyyar, Sivan, Tamuz, Av, Elul, Tishrei, Cheshvan, Kislev, Tevet, Shvat, Adar, Adar I, Adar II |
| `year` | integer | Yes | Hebrew year, for example 5787 |

Output: `civil_date`, `weekday`, `hebrew_date`, and `begins` (the evening on
which that Hebrew day starts).

## Status handling and errors

A successful call returns one text content item holding a JSON document. A
failed call returns `isError: true` with a plain-language message and no
partial data. The server never estimates a value it cannot calculate.

| Situation | Message begins |
| --- | --- |
| No place given | "Give a location (a city name) or latitude, longitude and timezone." |
| Coordinates without a time zone | "With coordinates, also give the IANA timezone" |
| Invalid time zone | "... is not a valid IANA time zone." |
| City not found | "No place found for ..." |
| City exists but not in the region given | "No place named ... matches ... Found: ..." |
| Invalid date | "... is not a date in YYYY-MM-DD form." |
| Polar day or night | "The sun does not rise and set at ..." |
| Invalid Hebrew date | "Could not read the Hebrew date ..." |

Input that fails schema validation (wrong type, out of range) is rejected by
the MCP layer before the tool runs.

HTTP level: `405` for methods other than POST and OPTIONS, `404` for paths
other than `/mcp`, `413` for request bodies over 64 KB, `429` with
`Retry-After: 60` when the rate limit is exceeded.

## Rate limits

60 requests per minute per client IP address. There is no daily quota and no
per-user limit, since there are no users or accounts.

## Data handling

- Data received: place, date, and calculation options. Nothing else.
- Storage: none. Requests and results are not written to a database or logs.
- Third parties: Cloudflare hosts the server and sees request metadata such as
  the IP address. No other service is contacted: city names are matched
  against a list built into the server.
- No credentials, payment data, or personal accounts are involved.
- Privacy notice: <https://kavana.jonyy.com/privacy/#mcp>

## Limits of the results

Times are calculated for a sea-level horizon unless an elevation is given, and
terrain is not modeled. Results are calculations, not halachic rulings.
