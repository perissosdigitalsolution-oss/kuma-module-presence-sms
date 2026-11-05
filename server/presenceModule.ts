// ============================================================================
// KUMA Module: Pointage & Notifications — Hono sub-app (mountable, self-contained).
//
// Embedded mode (host worker):
//   import { createPresenceModule } from '../../modules/presence-sms/server/presenceModule';
//   app.route('/api/v1/modules/presence', createPresenceModule());
//
// Standalone mode: server/standalone/index.ts mounts the SAME factory.
// Only external dependency: hono (peer dependency of the module).
// ============================================================================
import { Hono, type Context } from 'hono';

const ALLOWED_ROLES = new Set([
    'admin', 'director', 'directeur', 'directrice', 'founder', 'fondatrice',
    'manager', 'gestionnaire', 'teacher', 'enseignant',
]);

/** Minimal D1 surface used by the module (works with Cloudflare D1). */
export interface ModuleDB {
    prepare(sql: string): {
        bind(...vals: unknown[]): {
            first<T = Record<string, unknown>>(): Promise<T | null>;
            all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
            run(): Promise<unknown>;
        };
        first<T = Record<string, unknown>>(): Promise<T | null>;
        all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    };
    batch(stmts: unknown[]): Promise<unknown>;
}

interface ModPayload { sub?: string; role?: string; schoolId?: string; tenantId?: string; email?: string }

/** Hono generic env: Bindings (D1) + Variables (auth context set by host/standalone middleware). */
export type ModEnv = {
    Bindings: { DB: ModuleDB; [k: string]: unknown };
    Variables: { tenantId: string; jwtPayload: ModPayload | null };
};

type ModContext = Context<ModEnv>;

function resolveContext(c: ModContext): { tenantId: string; role: string; userId: string } {
    const payload = (c.get('jwtPayload') || {}) as ModPayload;
    const tenantId = String(c.get('tenantId') || payload.schoolId || payload.tenantId || 'default');
    return { tenantId, role: String(payload.role || '').toLowerCase(), userId: String(payload.sub || '') };
}

function genId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

const SESSION_TYPES = ['entry', 'exit', 'break_start', 'break_end'] as const;
type SessionType = typeof SESSION_TYPES[number];

export function createPresenceModule() {
    const app = new Hono<ModEnv>();

    // ── GET /v1/health — unauthenticated capability probe ───────────────────
    app.get('/v1/health', (c: ModContext) => c.json({
        module: 'kuma-module-presence-sms',
        version: '1.0.0',
        status: 'ready',
        capabilities: ['scan', 'absence-detection', 'parent-notifications', 'class-schedule'],
        time: new Date().toISOString(),
    }));

    // ── POST /v1/scan — record a check-in/out (staff only) ──────────────────
    app.post('/v1/scan', async (c: ModContext) => {
        try {
            const { tenantId, role, userId } = resolveContext(c);
            if (!ALLOWED_ROLES.has(role)) return c.json({ error: 'Forbidden' }, 403);

            const body = await c.req.json<{
                studentId: string; classId: string; sessionType: SessionType;
                method?: 'auto' | 'mobile' | 'rfid' | 'manual';
            }>();
            if (!body.studentId || !body.classId || !SESSION_TYPES.includes(body.sessionType)) {
                return c.json({ error: 'studentId, classId and a valid sessionType (entry|exit|break_start|break_end) are required' }, 400);
            }

            const sessionId = genId('pres');
            await c.env.DB.prepare(`
                INSERT INTO mod_presence_sessions (id, school_id, class_id, student_id, session_type, datetime, method, scanned_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                sessionId, tenantId, body.classId, body.studentId,
                body.sessionType, new Date().toISOString(), body.method || 'manual', userId
            ).run();

            return c.json({ success: true, sessionId }, 201);
        } catch (e) {
            console.error('[presence-module] scan error:', e);
            return c.json({ error: 'Failed to record scan' }, 500);
        }
    });

    // ── GET /v1/absences?date=YYYY-MM-DD ────────────────────────────────────
    app.get('/v1/absences', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);

            const { results } = await c.env.DB.prepare(`
                SELECT * FROM mod_presence_absences
                WHERE school_id = ? AND absence_date = ?
                ORDER BY created_at DESC
            `).bind(tenantId, date).all();

            return c.json({ success: true, date, absences: results || [] });
        } catch (e) {
            console.error('[presence-module] absences error:', e);
            return c.json({ error: 'Failed to fetch absences' }, 500);
        }
    });

    // ── POST /v1/detect-absences — flag students with no entry today ────────
    app.post('/v1/detect-absences', async (c: ModContext) => {
        try {
            const { tenantId, role } = resolveContext(c);
            if (!ALLOWED_ROLES.has(role)) return c.json({ error: 'Forbidden' }, 403);

            const body = await c.req.json<{ date?: string; classId?: string }>().catch(() => ({}) as { date?: string; classId?: string });
            const date = (body && body.date) || new Date().toISOString().slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);

            // Students enrolled in the school/class who have NO entry scan for the date.
            let sql = `
                SELECT s.id AS student_id, s.class_id
                FROM students s
                WHERE s.school_id = ?1
                  AND s.status = 'active'
                  AND NOT EXISTS (
                    SELECT 1 FROM mod_presence_sessions ps
                    WHERE ps.student_id = s.id AND date(ps.datetime) = ?2 AND ps.session_type = 'entry'
                  )`;
            const binds: unknown[] = [tenantId, date];
            if (body && body.classId) { sql += ' AND s.class_id = ?3'; binds.push(body.classId); }

            const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
            const absentees = results || [];

            if (absentees.length > 0) {
                const stmts = absentees.map((a) =>
                    c.env.DB.prepare(`
                        INSERT INTO mod_presence_absences (id, school_id, student_id, class_id, absence_date, reason, notified_parent, notes)
                        VALUES (?, ?, ?, ?, ?, 'unjustified', 0, 'Auto-detected')
                    `).bind(genId('abs'), tenantId, (a as { student_id: string }).student_id, (a as { class_id: string }).class_id, date)
                );
                await c.env.DB.batch(stmts);
            }

            return c.json({ success: true, date, detectedCount: absentees.length });
        } catch (e) {
            console.error('[presence-module] detect error:', e);
            return c.json({ error: 'Failed to detect absences' }, 500);
        }
    });

    // ── POST /v1/notification — queue parent notifications (staff only) ─────
    app.post('/v1/notification', async (c: ModContext) => {
        try {
            const { tenantId, role, userId } = resolveContext(c);
            if (!ALLOWED_ROLES.has(role)) return c.json({ error: 'Forbidden' }, 403);

            const body = await c.req.json<{
                studentIds: string[]; type: 'absence' | 'late' | 'early_departure' | 'custom';
                message: string; sentVia?: 'sms' | 'whatsapp' | 'email' | 'all';
            }>();
            if (!Array.isArray(body.studentIds) || body.studentIds.length === 0 || !body.message) {
                return c.json({ error: 'studentIds (non-empty) and message are required' }, 400);
            }
            if (!['absence', 'late', 'early_departure', 'custom'].includes(body.type)) {
                return c.json({ error: 'type must be absence|late|early_departure|custom' }, 400);
            }

            const notifId = genId('notif');
            await c.env.DB.prepare(`
                INSERT INTO mod_presence_notifications (id, school_id, student_ids, type, message, sent_via, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                notifId, tenantId, JSON.stringify(body.studentIds), body.type,
                body.message, body.sentVia || 'sms', new Date().toISOString(), userId
            ).run();

            return c.json({ success: true, notificationId: notifId, status: 'queued' }, 201);
        } catch (e) {
            console.error('[presence-module] notification error:', e);
            return c.json({ error: 'Failed to queue notification' }, 500);
        }
    });

    // ── GET /v1/schedule/:classId ───────────────────────────────────────────
    app.get('/v1/schedule/:classId', async (c: ModContext) => {
        try {
            const { tenantId } = resolveContext(c);
            const classId = c.req.param('classId');

            const { results } = await c.env.DB.prepare(`
                SELECT * FROM mod_presence_schedule WHERE school_id = ? AND class_id = ?
                ORDER BY day_of_week, start_time
            `).bind(tenantId, classId).all();

            return c.json({ success: true, classId, schedule: results || [] });
        } catch (e) {
            console.error('[presence-module] schedule error:', e);
            return c.json({ error: 'Failed to fetch schedule' }, 500);
        }
    });

    // ── POST /v1/schedule/:classId — replace the weekly schedule ────────────
    app.post('/v1/schedule/:classId', async (c: ModContext) => {
        try {
            const { tenantId, role } = resolveContext(c);
            if (!ALLOWED_ROLES.has(role)) return c.json({ error: 'Forbidden' }, 403);

            const classId = c.req.param('classId');
            const blocks = await c.req.json<Array<{ dayOfWeek: number; startTime: string; endTime: string; sessionName?: string }>>();
            if (!Array.isArray(blocks)) return c.json({ error: 'a schedule array is required' }, 400);
            if (blocks.some((b) => !b.dayOfWeek || b.dayOfWeek < 1 || b.dayOfWeek > 7 || !b.startTime || !b.endTime)) {
                return c.json({ error: 'each block needs dayOfWeek (1-7), startTime, endTime' }, 400);
            }

            await c.env.DB.prepare('DELETE FROM mod_presence_schedule WHERE school_id = ? AND class_id = ?')
                .bind(tenantId, classId).run();

            if (blocks.length > 0) {
                const stmts = blocks.map((b) =>
                    c.env.DB.prepare(`
                        INSERT INTO mod_presence_schedule (id, school_id, class_id, day_of_week, start_time, end_time, session_name)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `).bind(genId('sched'), tenantId, classId, b.dayOfWeek, b.startTime, b.endTime, b.sessionName || null)
                );
                await c.env.DB.batch(stmts);
            }

            return c.json({ success: true, classId, inserted: blocks.length });
        } catch (e) {
            console.error('[presence-module] schedule save error:', e);
            return c.json({ error: 'Failed to save schedule' }, 500);
        }
    });

    return app;
}