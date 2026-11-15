#!/usr/bin/env node
// Local entry point: one client over stdio.
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const cities = () => readFileSync(new URL("../data/cities.txt", import.meta.url), "utf8");
const texts = (path: string) => readFile(new URL(`../assets/texts/${path}`, import.meta.url), "utf8").catch(() => null);
await createServer(cities, texts).connect(new StdioServerTransport());
