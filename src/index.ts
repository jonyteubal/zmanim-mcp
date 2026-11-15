#!/usr/bin/env node
// Local entry point: one client over stdio.
import { readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const cities = () => readFileSync(new URL("../data/cities.txt", import.meta.url), "utf8");
await createServer(cities).connect(new StdioServerTransport());
