// ============================================================================
// Contract test — the frontend service and the server module must agree on
// the API paths.
//
// WHY THIS EXISTS: the presence / exam / lesson / finance frontends called
// paths WITHOUT the '/v1' prefix the server exposes ('/scan' vs '/v1/scan').
// Every one of those calls answered 404 — the modules looked alive (the
// health probe was green) but did nothing. This test parses the server
// routes and the frontend call sites, so a mismatch fails the build.
//
// The module stays autonomous: the test only reads the module's own files.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SERVER_FILE = join(__dirname, '../../server/presenceModule.ts');
const SERVICE_FILE = join(__dirname, '../presence.service.ts');

/** Routes declared by the server module: app.get('/v1/scan', …) */
function serverRoutes(src: string): string[] {
    const out: string[] = [];
    const re = /app\.(?:get|post|put|delete)\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) out.push(m[1]);
    return out;
}

/**
 * Paths called by the frontend service, in the two shapes the modules use:
 *   - inline: fetch(`${resolveApiBase(opts?.apiBase)}/v1/scan`)
 *   - argument: request('/v1/solde/:id', …) / this.request(`/v1/today`)
 */
function frontendPaths(src: string): string[] {
    const out: string[] = [];
    let m: RegExpExecArray | null;
    const inline = /`\$\{(?:resolveApiBase|baseUrl)\([^)]*\)\}([^`]*)`/g;
    while ((m = inline.exec(src))) out.push(m[1]);
    const arg = /request(?:<[^>]*>)?\(\s*['"`]([^'"`]+)['"`]/g;
    while ((m = arg.exec(src))) out.push(m[1]);
    return out.map(toRoutePattern).filter(Boolean);
}

/**
 * Normalizes a raw call site to a comparable route pattern:
 *   '/v1/schedule/${classId}'      → '/v1/schedule/:param'
 *   '/v1/today${q}'                → '/v1/today'   (query suffix)
 *   '/v1/solde/:studentId'         → '/v1/solde/:param'
 */
function toRoutePattern(raw: string): string {
    let s = raw.replace(/^\$\{(?:resolveApiBase|baseUrl)\([^)]*\)\}/, '');
    s = s.replace(/\$\{[^}]+\}/g, (match, offset: number, full: string) =>
        full.slice(0, offset).endsWith('/') ? ':param' : '');
    s = s.split('?')[0];
    s = s.replace(/:[^/]+/g, ':param');
    s = s.replace(/\/$/, '');
    return s;
}

describe('presence-sms module — frontend/server path contract', () => {
    const routes = serverRoutes(readFileSync(SERVER_FILE, 'utf8'));
    const calls = frontendPaths(readFileSync(SERVICE_FILE, 'utf8'));

    it('the server declares the expected routes', () => {
        expect(routes).toContain('/v1/health');
        expect(routes).toContain('/v1/scan');
        expect(routes).toContain('/v1/absences');

    });

    it('every frontend call hits a declared server route', () => {
        expect(calls.length).toBeGreaterThan(0);
        const missing = calls.filter((call) =>
            !routes.some((route) => toRoutePattern(route) === call));
        expect(missing, `frontend calls paths the server does not expose: ${missing.join(', ')}`).toEqual([]);
    });

    it('no frontend call escapes the module namespace', () => {
        for (const call of calls) {
            expect(call.startsWith('/v1/'), `"${call}" must start with /v1/`).toBe(true);
        }
    });
});
