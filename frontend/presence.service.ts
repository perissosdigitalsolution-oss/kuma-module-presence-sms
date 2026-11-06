// ============================================================================
// KUMA Module: Pointage — API Client Autonome
// ============================================================================
const MODULE_API_PATH = '/api/v1/modules/presence';
const DEFAULT_TOKEN_KEY = 'kuma_token';

/**
 * API base resolution — per-site correctness, NO foreign fallback:
 *   1. an explicit apiBase (injected by the host) always wins
 *   2. local proxy-served (localhost / LAN) → the local Worker (:8787),
 *      because the module routes live on the Worker (the NestJS gateway
 *      does not mount them)
 *   3. VITE_API_URL (build-time, set per site) → absolute
 *   4. otherwise → same-origin relative
 * A module that WRITES (pointage, notifications) must never silently
 * target another school's API: there is deliberately no hardcoded
 * worker URL here.
 */
export function resolveApiBase(apiBase?: string): string {
    if (apiBase) return apiBase.replace(/\/$/, '');
    if (typeof window === 'undefined') return MODULE_API_PATH;
    const host = window.location.hostname;
    const isProxyServed = host === 'localhost' || host === '127.0.0.1' || host === '::1'
        || host.startsWith('192.168.') || host.startsWith('10.')
        || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (isProxyServed) return `${window.location.protocol}//${host}:8787${MODULE_API_PATH}`;
    const envBase = (import.meta.env.VITE_API_URL || '').replace(/\/api\/v1$/, '');
    return envBase ? `${envBase}${MODULE_API_PATH}` : MODULE_API_PATH;
}

/**
 * Token resolver — injectable (the host passes its own provider), default:
 * the KUMA platform key `kuma_token`. The old `authToken` key was never
 * written by the platform, so every module call was unauthenticated.
 */
export function resolveToken(getToken?: () => string | null): string {
    if (getToken) return getToken() || '';
    try { return localStorage.getItem(DEFAULT_TOKEN_KEY) || ''; } catch { return ''; }
}

export interface PresenceOptions {
    /** Explicit module API base (host injects it). */
    apiBase?: string;
    /** Token provider (host injects it). */
    getToken?: () => string | null;
}

interface ScanData {
    studentId: string;
    classId: string;
    sessionType: 'entry' | 'exit' | 'break_start' | 'break_end';
    method?: 'auto' | 'mobile' | 'rfid' | 'manual';
    scannedBy?: string;
}

export const PresenceService = {
    async scan(data: ScanData, opts?: PresenceOptions): Promise<{ success: boolean; sessionId: string }> {
        const res = await fetch(`${resolveApiBase(opts?.apiBase)}/v1/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolveToken(opts?.getToken)}`
            },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async getAbsences(date?: string, opts?: PresenceOptions): Promise<any[]> {
        // NOTE: a leading '/' path passed to `new URL(path, base)` REPLACES the
        // base path — the /api/v1/modules/presence prefix was being dropped
        // (the call answered 404). The path is now appended to the base.
        const url = new URL(`${resolveApiBase(opts?.apiBase)}/v1/absences`);
        if (date) url.searchParams.set('date', date);

        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${resolveToken(opts?.getToken)}` }
        });
        const data = await res.json();
        return data.success ? data.absences : [];
    },

    async detectAbsences(opts?: PresenceOptions): Promise<{ success: boolean; detectedCount: number }> {
        const res = await fetch(`${resolveApiBase(opts?.apiBase)}/v1/detect-absences`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resolveToken(opts?.getToken)}` }
        });
        return res.json();
    },

    async sendNotification(data: {
        studentIds: string[];
        type: 'absence' | 'late' | 'early_departure' | 'custom';
        message: string;
        sentVia?: 'sms' | 'whatsapp' | 'email' | 'all';
    }, opts?: PresenceOptions): Promise<{ success: boolean; notificationId: string }> {
        const res = await fetch(`${resolveApiBase(opts?.apiBase)}/v1/notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolveToken(opts?.getToken)}`
            },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async getSchedule(classId: string, opts?: PresenceOptions): Promise<any[]> {
        const res = await fetch(`${resolveApiBase(opts?.apiBase)}/v1/schedule/${classId}`, {
            headers: { 'Authorization': `Bearer ${resolveToken(opts?.getToken)}` }
        });
        const data = await res.json();
        return data.success ? data.schedule : [];
    },

    async saveSchedule(classId: string, blocks: { dayOfWeek: number; startTime: string; endTime: string; sessionName?: string }[], opts?: PresenceOptions): Promise<{ success: boolean; inserted: number }> {
        const res = await fetch(`${resolveApiBase(opts?.apiBase)}/v1/schedule/${classId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${resolveToken(opts?.getToken)}`
            },
            body: JSON.stringify(blocks)
        });
        return res.json();
    }
};

export type { ScanData };
