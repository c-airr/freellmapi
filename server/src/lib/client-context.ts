import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { classifyClientAgent, type ClientAgent } from './client-classifier.js';

export interface ClientContext {
  ip: string | null;
  userAgent: string | null;
  agent: ClientAgent | null;
  // The named fallback chain (profile) that routed this request — `auto:<name>`
  // or the active chain behind plain `auto`. Set by resolveRoutingChain, read
  // by logRequest so per-chain usage (projects) can be attributed. Not caller
  // identity, so it is recorded even when client logging is opted out.
  chain?: RoutingChainRef | null;
}

export interface RoutingChainRef {
  profileId: number;
  name: string;
}

// Request-scoped caller identity, readable from anywhere below the middleware
// without threading parameters through every logRequest() call site (the chat
// proxy, responses, anthropic, fusion, embeddings and media paths all log).
const storage = new AsyncLocalStorage<ClientContext>();

// Resolve the client IP. With Express's `trust proxy` disabled (the default),
// this is the socket peer address and a spoofed X-Forwarded-For from a LAN
// client is ignored. When TRUST_PROXY (#1024) opts into trusting a reverse
// proxy, `req.ip` walks the configured trusted-proxy chain and returns the
// first untrusted address — instead of trusting the leftmost caller-supplied
// X-Forwarded-For value, which would let any direct caller spoof it.
function resolveClientIp(req: Request): string | null {
  const raw = req.ip ?? req.socket.remoteAddress ?? null;
  // Normalize IPv4-mapped IPv6 ("::ffff:192.168.0.5" -> "192.168.0.5").
  return raw?.replace(/^::ffff:/i, '') ?? null;
}

// Privacy opt-out: REQUEST_ANALYTICS_LOG_CLIENT=false stores nulls instead of
// the caller's IP/UA. Read per request (not at module load) so tests and
// embedders can toggle it without re-importing.
function clientLoggingEnabled(): boolean {
  return process.env.REQUEST_ANALYTICS_LOG_CLIENT !== 'false';
}

export function clientContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!clientLoggingEnabled()) {
    storage.run({ ip: null, userAgent: null, agent: null }, next);
    return;
  }
  const ua = req.headers['user-agent'];
  storage.run({
    ip: resolveClientIp(req),
    userAgent: typeof ua === 'string' ? ua.slice(0, 256) : null,
    agent: classifyClientAgent(req),
  }, next);
}

export function getClientContext(): ClientContext {
  return storage.getStore() ?? { ip: null, userAgent: null, agent: null };
}

// Record which named chain is routing the current request. No-op outside an
// HTTP request (no store), so background callers of the router are unaffected.
export function setRoutingChain(chain: RoutingChainRef | null): void {
  const store = storage.getStore();
  if (store) store.chain = chain;
}
