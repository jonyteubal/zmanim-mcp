// Public entry point: a stateless Streamable HTTP endpoint on Cloudflare Workers.
// Every POST gets a fresh server, so there are no sessions to store or expire.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import cities from "../data/cities.txt";
import { createServer } from "./server.js";

interface Env {
  /** Optional Workers rate-limit binding, keyed by client address. */
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

const DOCS = "https://kavana.jonyy.com/mcp/";
// Ownership proofs requested by connector directories: path -> plain-text body.
const WELL_KNOWN: Record<string, string> = {
  "/.well-known/muse-challenge/2081c4591bfbe3af1fdc306c1f91637d6418961c79ff6247c542599aec5c6f11":
    "muse-challenge=2081c4591bfbe3af1fdc306c1f91637d6418961c79ff6247c542599aec5c6f11",
};
const MAX_BODY_BYTES = 64 * 1024;
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function rpcError(status: number, message: string, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }), {
    status, headers: { "Content-Type": "application/json", ...CORS, ...extra },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const proof = WELL_KNOWN[url.pathname];
    if (proof && (request.method === "GET" || request.method === "HEAD")) {
      return new Response(request.method === "HEAD" ? null : proof + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/" || url.pathname === "") {
      return Response.json({
        name: "kavana-zmanim",
        description: "MCP server for zmanim, Shabbat times and the Hebrew calendar.",
        endpoint: `${url.origin}/mcp`,
        transport: "Streamable HTTP (stateless, POST only)",
        documentation: DOCS,
      }, { headers: CORS });
    }
    if (url.pathname !== "/mcp") return rpcError(404, `Not found. The MCP endpoint is ${url.origin}/mcp. See ${DOCS}`);
    if (request.method !== "POST") return rpcError(405, "This server is stateless: send JSON-RPC with POST.", { Allow: "POST, OPTIONS" });
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return rpcError(413, "Request body too large.");
    if (env.LIMITER) {
      const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
      if (!(await env.LIMITER.limit({ key })).success) return rpcError(429, "Too many requests. Limit: 60 per minute.", { "Retry-After": "60" });
    }
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await createServer(() => cities).connect(transport);
    const response = await transport.handleRequest(request);
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(CORS)) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  },
};
