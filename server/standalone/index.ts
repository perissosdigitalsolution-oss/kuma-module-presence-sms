// ============================================================================
// KUMA Module: Pointage & Notifications — STANDALONE Worker (zero host code).
//   cd modules/presence-sms/server/standalone
//   npx wrangler d1 execute <your-db> --remote --file ../schema.sql
//   npx wrangler secret put JWT_SECRET
//   npx wrangler deploy
// ============================================================================
import { Hono } from 'hono';
import { createPresenceModule } from '../presenceModule';

interface Env { DB: D1Database; JWT_SECRET: string }

const app = new Hono<{ Bindings: Env }>();

// ── CORS (module may be consumed cross-origin by any school frontend) ──────
app.use('/api/*', async (c, next) => {
    const origin = c.req.header('Origin') || '*';
    await next();
    c.header('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
});

// ── Minimal HS256 JWT verification (same algorithm as the host platform) ───
async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${h}.${p}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (s !== expected) return null;
    try {
        const payload = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;
        if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
        return payload;
    } catch {
        return null;
    }
}

// ── Auth middleware: sets the SAME context vars the host platform sets ─────
app.use('/api/v1/*', async (c, next) => {
    if (c.req.path.endsWith('/v1/health')) return next();
    const header = c.req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return c.json({ error: 'Unauthorized' }, 401);
    const payload = await verifyJwt(token, c.env.JWT_SECRET);
    if (!payload || !payload.sub) return c.json({ error: 'Unauthorized' }, 401);
    c.set('jwtPayload' as never, payload as never);
    c.set('tenantId' as never, String(payload.schoolId || payload.tenantId || 'default') as never);
    await next();
});

app.route('/api/v1/modules/presence', createPresenceModule());

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;