// ============================================================================
// KUMA Module: Pointage — API Client Autonome
// ============================================================================
function defaultApiBase(): string {
    if (typeof window === 'undefined') return '/api/v1/modules/presence';
    const host = window.location.hostname;
    const isProxyServed = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.');
    if (isProxyServed) return '/api/v1/modules/presence';
    return '(import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/v1$/, '') : 'https://kuma-school-backend-production.kumaschool88.workers.dev')/api/v1/modules/presence';
}
const DEFAULT_API_BASE = defaultApiBase();

interface ScanData {
    studentId: string;
    classId: string;
    sessionType: 'entry' | 'exit' | 'break_start' | 'break_end';
    method?: 'auto' | 'mobile' | 'rfid' | 'manual';
    scannedBy?: string;
}

export const PresenceService = {
    async scan(data: ScanData, apiBase?: string): Promise<{ success: boolean; sessionId: string }> {
        const url = apiBase || DEFAULT_API_BASE;
        const res = await fetch(`${url}/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async getAbsences(date?: string): Promise<any[]> {
        const url = new URL('/v1/absences', DEFAULT_API_BASE);
        if (date) url.searchParams.set('date', date);
        
        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
        });
        const data = await res.json();
        return data.success ? data.absences : [];
    },

    async detectAbsences(): Promise<{ success: boolean; detectedCount: number }> {
        const res = await fetch(`${DEFAULT_API_BASE}/detect-absences`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
        });
        return res.json();
    },

    async sendNotification(data: {
        studentIds: string[];
        type: 'absence' | 'late' | 'early_departure' | 'custom';
        message: string;
        sentVia?: 'sms' | 'whatsapp' | 'email' | 'all';
    }): Promise<{ success: boolean; notificationId: string }> {
        const res = await fetch(`${DEFAULT_API_BASE}/notification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(data)
        });
        return res.json();
    },

    async getSchedule(classId: string): Promise<any[]> {
        const res = await fetch(`${DEFAULT_API_BASE}/schedule/${classId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}` }
        });
        const data = await res.json();
        return data.success ? data.schedule : [];
    },

    async saveSchedule(classId: string, blocks: { dayOfWeek: number; startTime: string; endTime: string; sessionName?: string }[]): Promise<{ success: boolean; inserted: number }> {
        const res = await fetch(`${DEFAULT_API_BASE}/schedule/${classId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('authToken') || ''}`
            },
            body: JSON.stringify(blocks)
        });
        return res.json();
    }
};

export type { ScanData };