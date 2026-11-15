# zmanim-mcp

A Model Context Protocol (MCP) server that gives AI assistants calculated
zmanim, Shabbat times and Hebrew calendar data. It uses the same solar and
zmanim calculations as the [Kavaná](https://kavana.jonyy.com/) siddur app.
There is no AI in the server: every answer is deterministic math.

## Public endpoint

    https://zmanim.kavana-ai.workers.dev/mcp

No account or API key. Setup steps for Claude, ChatGPT, Claude Code, Cursor
and GitHub Copilot are at <https://kavana.jonyy.com/mcp/>. The short version
for Claude Code:

    claude mcp add --transport http zmanim https://zmanim.kavana-ai.workers.dev/mcp

The endpoint is stateless Streamable HTTP (POST only), limited to 60 requests
a minute per client address.

## Meta Muse and other personal agents

Muse builds custom integrations from a chat instruction. Send it this prompt
(based on third-party guides, not tested against Muse):

> Build a custom integration to the Zmanim MCP server at
> https://zmanim.kavana-ai.workers.dev/mcp. It is a remote MCP server over
> streamable HTTP. Without authentication it offers four read-only tools:
> get_zmanim, get_shabbat_times, get_hebrew_date, and convert_hebrew_date. I
> want you to be able to answer questions about zmanim, Shabbat times, and the
> Hebrew calendar from any future conversation. Connect to it, test every tool
> end to end, show me the results, and save the integration as a reusable
> skill. It needs no credentials.

Other agents that connect through chat (Claude Duet, Dot and similar) can be
given the endpoint URL with the same description.

## Weekly Shabbat reminder

In an assistant that supports scheduled tasks, send this after setup (replace
the city):

> Create a recurring task for every Friday at 9:00 AM in my time zone. Each
> time it runs, call the get_shabbat_times tool of the zmanim MCP server for
> [your city] and send me four lines: the candle-lighting time, the Havdalah
> time, the parasha, and any holiday on that Shabbat. State the
> candle-lighting and Havdalah offsets that were used. If the server cannot be
> reached, say so and do not estimate the times.

## Tools

| Tool | Answers |
| --- | --- |
| `get_zmanim` | The 13 zmanim for a date and place, each with the rule behind it |
| `get_shabbat_times` | Candle-lighting, Havdalah, parasha, holidays on that Shabbat |
| `get_hebrew_date` | Hebrew date, what falls on it, parasha, upcoming holidays |
| `convert_hebrew_date` | Civil date of a Hebrew date (birthdays, yahrzeits) |

A place is a city name ("Panama City, Panama") or latitude, longitude and an
IANA timezone. City names are resolved through the Open-Meteo geocoding API;
the city name is the only thing sent. Coordinates need no outside service.

## Defaults

- Dawn: Rav Ovadia Yosef, 72 seasonal minutes (`posen`, `chabad`, `fixed72` available)
- Nightfall: sun 8.5° below the horizon (`7.083deg`, `6deg`, `13.5min` available)
- Candle-lighting: 18 minutes before sunset. Havdalah: 40 minutes after
- Deadlines round down to the minute, beginnings round up
- Sea-level horizon unless an elevation is given. Terrain is not modeled

Every response states the method used. The equations are documented at
<https://kavana.jonyy.com/calculations/>.

## Run it yourself

Requires Node.js 20 or later.

    npm install
    npm test          # builds, then runs the test suite
    npm start         # local stdio server

Add the local server to Claude Code:

    claude mcp add zmanim -- node "$PWD/dist/index.js"

Deploy your own copy to Cloudflare Workers:

    npm run dev       # local HTTP server on http://localhost:8787/mcp
    npm run deploy

## Layout

| File | Purpose |
| --- | --- |
| `src/solar.ts` | NOAA solar equations: sunrise, sunset, sun-angle times |
| `src/zmanim.ts` | Zmanim and Shabbat times from those solar events |
| `src/calendar.ts` | Hebrew dates, holidays and parasha via `@hebcal/core` |
| `src/location.ts` | City lookup and time zone validation |
| `src/server.ts` | The four MCP tools |
| `src/index.ts` | Local stdio entry point |
| `src/worker.ts` | Cloudflare Workers entry point (public HTTP endpoint) |

The tests check sunrise and sunset against `@hebcal/core`'s independent
implementation to within 60 seconds across six cities and six dates.

## Disclaimer

Results are calculations, not halachic rulings. Confirm the applicable method
and local practice with a community luach or a rabbi.

## Credits

- Hebrew calendar: [@hebcal/core](https://github.com/hebcal/hebcal-es6) (GPL-2.0-or-later)
- City lookup: [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api), data from GeoNames (CC BY 4.0)
- Solar equations: NOAA Solar Calculator, after Jean Meeus, *Astronomical Algorithms*

## License

GPL-2.0-or-later. See [LICENSE](LICENSE). The Hebrew calendar dependency,
`@hebcal/core`, is under the same license.
