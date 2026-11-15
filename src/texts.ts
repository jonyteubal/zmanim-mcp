// Prayer texts, Psalms and the blessings guide. Each prayer section is its own
// small JSON file under assets/texts, so a request reads only what it needs.
import { normalize } from "./location.js";

/** Returns the text of a file under assets/texts, or null when it does not exist. */
export type TextSource = (path: string) => Promise<string | null>;

export type Tradition = "sephardic" | "ashkenaz" | "sefard";

interface IndexSection { id: string; title: string; paragraphs: number }
interface IndexService { id: string; title: string; sections: IndexSection[] }
interface Index {
  traditions: Record<Tradition, { name: string; source: string; services: IndexService[] }>;
  tehillim: { chapters: number; source: string };
}
interface Paragraph { he: string; en?: string; kind?: "heading" | "instruction" | "blessing" }
interface Blessing { id: string; name: string; short: string; when: string; he: string; tr: string; en: string; after?: string }
interface Food { name: string; es: string; before: string; after: string; note: string | null }
interface Blessings { before: Blessing[]; after: Blessing[]; foods: Food[] }

const cache = new Map<string, Promise<unknown>>();
function load<T>(source: TextSource, path: string): Promise<T> {
  let pending = cache.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = source(path).then((text) => {
      if (text === null) throw new Error(`The text file ${path} is missing from this server.`);
      return JSON.parse(text) as T;
    });
    // Only the two small shared files stay in memory; prayers are read per request.
    if (path === "index.json" || path === "berachot.json") cache.set(path, pending);
  }
  return pending;
}

// Common names an assistant or a person may use, mapped to the ids in the index.
const PRAYER_ALIASES: Record<string, string> = {
  "amida": "amidah", "shemoneh esrei": "amidah", "shmoneh esrei": "amidah", "shemone esre": "amidah", "standing prayer": "amidah",
  "aleinu": "alenu", "kriat shema": "shema", "shma": "shema", "the shema": "shema",
  "benching": "birkat hamazon", "bentching": "birkat hamazon", "grace after meals": "birkat hamazon", "birkat hamazon": "birkat hamazon",
  "havdala": "havdalah", "kiddush levana": "moon", "birkat halevana": "moon", "tefilat haderech": "traveler",
  "travelers prayer": "traveler", "traveler prayer": "traveler", "wayfarers prayer": "traveler", "asher yatzar": "birkot hashachar", "netilat yadayim": "birkot hashachar",
  "sefirat haomer": "omer", "counting the omer": "omer", "candle lighting": "candles", "shabbat candles": "candles",
  "lecha dodi": "kabbalat", "kabbalat shabbat": "kabbalat", "morning blessings": "birkot hashachar", "pesukei dezimra": "pesukei",
  "bedtime shema": "bedtime shema", "kriat shema al hamita": "bedtime shema", "al hamichya": "al hamichya", "mussaf": "musaf",
};
const SERVICE_ALIASES: Record<string, string> = {
  "morning": "shacharit", "shaharit": "shacharit", "weekday morning": "shacharit", "afternoon": "mincha", "minha": "mincha",
  "evening": "arvit", "maariv": "arvit", "night": "arvit", "friday night": "shabbat eve", "kabbalat shabbat": "shabbat eve",
  "shabbat morning": "shabbat day", "saturday morning": "shabbat day", "shabbat afternoon": "shabbat mincha", "motzaei shabbat": "shabbat mincha",
  "blessings": "extras", "other": "extras",
};
const key = (text: string) => normalize(text).replace(/['’]/g, "").replace(/[_\-·.,:;"!?()/]/g, " ").replace(/\s+/g, " ").trim();

function tradition(index: Index, name: Tradition | undefined) {
  const id = name ?? "sephardic";
  const book = index.traditions[id];
  if (!book) throw new Error(`Unknown tradition "${name}". Use sephardic, ashkenaz, or sefard.`);
  return { id, book };
}

/** The catalog: services and the prayers in each, for one tradition. */
export async function listPrayers(source: TextSource, name?: Tradition) {
  const index = await load<Index>(source, "index.json");
  const { id, book } = tradition(index, name);
  return {
    tradition: id, tradition_name: book.name,
    services: book.services.map((service) => ({
      service: service.id, title: service.title,
      prayers: service.sections.map((section) => ({ prayer: section.id, title: section.title, paragraphs: section.paragraphs })),
    })),
    psalms: `Chapters 1 to ${index.tehillim.chapters} are available through get_psalm.`,
    other_traditions: (Object.keys(index.traditions) as Tradition[]).filter((other) => other !== id),
    source: book.source,
  };
}

export interface PrayerRequest {
  prayer: string;
  service?: string;
  tradition?: Tradition;
  offset?: number;
  include_english?: boolean;
}

/** About 7,000 characters of text per reply keeps a long prayer readable and within tool-result limits. */
const PAGE_CHARACTERS = 7000;

export async function getPrayer(source: TextSource, request: PrayerRequest) {
  const index = await load<Index>(source, "index.json");
  const { id, book } = tradition(index, request.tradition);
  const wanted = key(request.prayer);
  if (!wanted) throw new Error("Give the prayer's name, for example \"shema\", \"amidah\", or \"birkat hamazon\".");
  const target = key(PRAYER_ALIASES[wanted] ?? wanted);

  const all = book.services.flatMap((service) => service.sections.map((section) => ({ service, section })));
  const exact = all.filter(({ section }) => key(section.id) === target || key(section.title) === target);
  const partial = exact.length ? exact : all.filter(({ section }) => key(section.id).includes(target) || key(section.title).includes(target));
  if (!partial.length) {
    throw new Error(`No prayer named "${request.prayer}" in the ${book.name} siddur. Call list_prayers to see what is available.`);
  }
  let matches = partial;
  if (request.service) {
    const service = key(SERVICE_ALIASES[key(request.service)] ?? request.service);
    matches = partial.filter((match) => key(match.service.id) === service || key(match.service.title) === service);
    if (!matches.length) {
      throw new Error(`"${request.prayer}" is not in the "${request.service}" service. It appears in: ${[...new Set(partial.map((match) => match.service.title))].join(", ")}.`);
    }
  }
  const { service, section } = matches[0];
  const file = await load<{ paragraphs: Paragraph[] }>(source, `${id}/${service.id}.${section.id}.json`);

  const offset = Math.max(0, Math.floor(request.offset ?? 0));
  if (offset >= file.paragraphs.length) throw new Error(`offset ${offset} is past the end: this prayer has ${file.paragraphs.length} paragraphs.`);
  const english = request.include_english ?? true;
  const page: (Paragraph & { n: number })[] = [];
  let characters = 0;
  for (let n = offset; n < file.paragraphs.length; n++) {
    const paragraph = file.paragraphs[n];
    const size = paragraph.he.length + (english && paragraph.en ? paragraph.en.length : 0);
    if (page.length && characters + size > PAGE_CHARACTERS) break;
    characters += size;
    page.push({ n, he: paragraph.he, en: english ? paragraph.en : undefined, kind: paragraph.kind });
  }
  const next = offset + page.length;
  const others = matches.slice(1).map((match) => `${match.section.title} (${match.service.title})`);
  return {
    prayer: section.id, title: section.title,
    service: service.id, service_title: service.title,
    tradition: id, tradition_name: book.name,
    total_paragraphs: file.paragraphs.length,
    paragraphs: page,
    next_offset: next < file.paragraphs.length ? next : null,
    also_available: others.length ? others.slice(0, 8) : undefined,
    source: book.source,
    note: "Hebrew text as printed in the source siddur. Text in parentheses and entries of kind \"instruction\" are directions, not words to recite. English is given where the source provides it. Customs differ between communities.",
  };
}

export interface ServiceRequest {
  service: string;
  /** 0 = Sunday ... 6 = Saturday, for the civil date being prayed. */
  weekday: number;
  /** Names of what falls on that Hebrew date (holidays, Rosh Chodesh, fasts), as the calendar reports them. */
  occasions: string[];
  yomTov: boolean;
  tradition?: Tradition;
  position?: string;
  include_english?: boolean;
}

const DAILY: Record<string, "shacharit" | "mincha" | "arvit"> = {
  shacharit: "shacharit", shaharit: "shacharit", morning: "shacharit", "morning prayer": "shacharit", "morning prayers": "shacharit",
  mincha: "mincha", minha: "mincha", afternoon: "mincha", "afternoon prayer": "mincha",
  arvit: "arvit", maariv: "arvit", evening: "arvit", night: "arvit", "evening prayer": "arvit",
};

/** Which part of the siddur a daily service uses on a given weekday. */
function serviceForDay(daily: "shacharit" | "mincha" | "arvit", weekday: number): { id: string; reason?: string } {
  if (weekday === 6 && daily === "shacharit") return { id: "shabbat_day", reason: "It is Shabbat, so this is the Shabbat morning service, including Musaf." };
  if (weekday === 6 && daily === "mincha") return { id: "shabbat_mincha", reason: "It is Shabbat, so this is Shabbat Mincha." };
  if (weekday === 5 && daily === "arvit") return { id: "shabbat_eve", reason: "It is Friday night, so this is Kabbalat Shabbat and the Shabbat evening service." };
  if (weekday === 6 && daily === "arvit") return { id: "arvit", reason: "Saturday night uses weekday Arvit. Havdalah is available with get_prayer (prayer \"havdalah\")." };
  return { id: daily };
}

/** Widely shared changes for special days. The printed text is not altered; these tell the reader what to look for. */
function dayNotes(occasions: string[], yomTov: boolean, daily: string): string[] {
  const has = (pattern: RegExp) => occasions.some((name) => pattern.test(name));
  const notes: string[] = [];
  if (yomTov) notes.push("Today is a Yom Tov. This server holds the weekday and Shabbat services only; the festival Amidah, Hallel and other festival prayers are not included, so use a machzor or festival siddur.");
  if (has(/Rosh Chodesh/i)) notes.push("Rosh Chodesh: Ya'aleh VeYavo is added in the Amidah, Hallel and Musaf are said in the morning, and Tachanun (Vidui) is omitted.");
  if (has(/Chanukah/i)) notes.push("Chanukah: Al HaNissim is added in the Amidah, Hallel is said in the morning, and Tachanun (Vidui) is omitted.");
  if (has(/^Purim|Shushan Purim/i)) notes.push("Purim: Al HaNissim is added in the Amidah and Tachanun (Vidui) is omitted.");
  if (has(/Tzom|Ta'anit|Tish'a B'Av|Asara B'Tevet/i) && !has(/Yom Kippur/i)) notes.push("Fast day: Aneinu is added in the Amidah, with other additions that depend on the fast and the community.");
  if (has(/Omer/i) && daily === "arvit") notes.push("The Omer is counted tonight after Arvit (get_prayer with prayer \"omer\").");
  if (has(/Chol hamoed/i)) notes.push("Chol HaMoed: Ya'aleh VeYavo is added in the Amidah, Hallel and Musaf are said, and Tachanun (Vidui) is omitted.");
  return notes;
}

/** A whole service for a given day, in order, returned in parts. */
export async function getService(source: TextSource, request: ServiceRequest) {
  const index = await load<Index>(source, "index.json");
  const { id, book } = tradition(index, request.tradition);
  const wanted = key(request.service);
  const daily = DAILY[wanted];
  const chosen = daily ? serviceForDay(daily, request.weekday)
    : { id: key(SERVICE_ALIASES[wanted] ?? wanted).replace(/ /g, "_") };
  const service = book.services.find((entry) => entry.id === chosen.id);
  if (!service) throw new Error(`Unknown service "${request.service}". Use shacharit, mincha, or arvit (chosen for the day automatically), or one of: ${book.services.map((entry) => entry.id).join(", ")}.`);

  const [sectionText, paragraphText] = (request.position ?? "0:0").split(":");
  const startSection = Number(sectionText), startParagraph = Number(paragraphText ?? 0);
  if (!Number.isInteger(startSection) || !Number.isInteger(startParagraph) || startSection < 0 || startParagraph < 0 || startSection >= service.sections.length) {
    throw new Error(`position "${request.position}" is not valid. Use the next_position value from the previous reply.`);
  }
  const english = request.include_english ?? true;
  const parts: { prayer: string; title: string; paragraphs: (Paragraph & { n: number })[] }[] = [];
  let characters = 0;
  let next: string | null = null;
  outer: for (let s = startSection; s < service.sections.length; s++) {
    const section = service.sections[s];
    const file = await load<{ paragraphs: Paragraph[] }>(source, `${id}/${service.id}.${section.id}.json`);
    const from = s === startSection ? startParagraph : 0;
    if (from > file.paragraphs.length) throw new Error(`position "${request.position}" is past the end of ${section.title}.`);
    const page: (Paragraph & { n: number })[] = [];
    for (let n = from; n < file.paragraphs.length; n++) {
      const paragraph = file.paragraphs[n];
      const size = paragraph.he.length + (english && paragraph.en ? paragraph.en.length : 0);
      if (characters > 0 && characters + size > PAGE_CHARACTERS) {
        if (page.length) parts.push({ prayer: section.id, title: section.title, paragraphs: page });
        next = `${s}:${n}`;
        break outer;
      }
      characters += size;
      page.push({ n, he: paragraph.he, en: english ? paragraph.en : undefined, kind: paragraph.kind });
    }
    if (page.length) parts.push({ prayer: section.id, title: section.title, paragraphs: page });
  }
  return {
    service: service.id, service_title: service.title,
    chosen_because: chosen.reason,
    tradition: id, tradition_name: book.name,
    day_notes: dayNotes(request.occasions, request.yomTov, daily ?? service.id),
    order: service.sections.map((section, n) => ({ position: `${n}:0`, prayer: section.id, title: section.title, paragraphs: section.paragraphs })),
    text: parts,
    next_position: next,
    source: book.source,
    note: "The service in printed order. Continue from next_position until it is null, or jump to any prayer with its position from \"order\". Text in parentheses and entries of kind \"instruction\" are directions. The text is not adjusted for the day: day_notes lists the usual changes. Customs differ between communities.",
  };
}

export async function getPsalm(source: TextSource, chapter: number, includeEnglish = true) {
  const index = await load<Index>(source, "index.json");
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > index.tehillim.chapters) {
    throw new Error(`Psalm chapters run from 1 to ${index.tehillim.chapters}.`);
  }
  const file = await load<{ title: string; verses: Paragraph[] }>(source, `tehillim/${chapter}.json`);
  return {
    chapter, title: file.title,
    verses: file.verses.map((verse, n) => ({ verse: n + 1, he: verse.he, en: includeEnglish ? verse.en : undefined })),
    source: index.tehillim.source,
  };
}

/** The blessing before and after a food, or the list of blessings when no food is named. */
export async function findBlessing(source: TextSource, query?: string) {
  const data = await load<Blessings>(source, "berachot.json");
  const blessing = (id: string) => [...data.before, ...data.after].find((entry) => entry.id === id);
  const show = (entry: Blessing | undefined) => entry && {
    id: entry.id, name: entry.name, for: entry.short, when: entry.when, hebrew: entry.he, transliteration: entry.tr, english: entry.en,
  };
  const note = "A general guide following Sephardic practice. Amounts, mixtures and local custom change the ruling; ask a rabbi about a specific case.";
  const wanted = key(query ?? "");
  if (!wanted) {
    return { before_eating: data.before.map(show), after_eating: data.after.map(show), foods_covered: data.foods.map((food) => food.name), note };
  }
  // Whole words only, so "water" does not match "watermelon"; a final "s" is ignored.
  const singular = (word: string) => (word.length > 3 ? word.replace(/s$/, "") : word);
  const words = wanted.split(" ").map(singular);
  const hit = (text: string) => { const hay = new Set(key(text).split(" ").map(singular)); return words.every((word) => hay.has(word)); };
  const foods = data.foods.filter((food) => hit(food.name) || hit(food.es));
  const named = [...data.before, ...data.after].filter((entry) => hit(entry.name) || key(entry.id) === wanted || hit(entry.short));
  if (!foods.length && !named.length) {
    return {
      query, found: false,
      message: `"${query}" is not in the guide. The guide covers the foods listed here; for anything else, ask a rabbi.`,
      foods_covered: data.foods.map((food) => food.name), note,
    };
  }
  return {
    query, found: true,
    foods: !foods.length ? undefined : foods.map((food) => ({ food: food.name, spanish: food.es, before: show(blessing(food.before)), after: show(blessing(food.after)), note: food.note ?? undefined })),
    blessings: foods.length ? undefined : named.map(show),
    note,
  };
}
