-- ============================================================================
-- KUMA Module: Pointage & Notifications v1.0.0 — Autonome & Bridge Mode
-- Tables mod_presence_* : isolation stricte, rollback sans impact core
-- ============================================================================

-- Sessions de pointage (entrée/sortie)
CREATE TABLE IF NOT EXISTS mod_presence_sessions (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK(session_type IN ('entry', 'exit', 'break_start', 'break_end')),
    datetime TEXT NOT NULL DEFAULT (datetime('now')),
    method TEXT DEFAULT 'auto' CHECK(method IN ('auto', 'mobile', 'rfid', 'manual')),
    scanned_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_mod_presence_student ON mod_presence_sessions(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_mod_presence_datetime ON mod_presence_sessions(datetime);
CREATE INDEX IF NOT EXISTS idx_mod_presence_class ON mod_presence_sessions(class_id);

-- Absences non justifiées détectées
CREATE TABLE IF NOT EXISTS mod_presence_absences (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    absence_date TEXT NOT NULL,
    reason TEXT CHECK(reason IN ('justified', 'unjustified', 'late', 'early_departure')),
    notified_parent BOOLEAN DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    foreign KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mod_absences_student ON mod_presence_absences(school_id, student_id);
CREATE INDEX IF NOT EXISTS idx_mod_absences_date ON mod_presence_absences(absence_date);

-- Notifications envoyées aux parents
CREATE TABLE IF NOT EXISTS mod_presence_notifications (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    student_ids TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('absence', 'late', 'early_departure', 'custom')),
    message TEXT NOT NULL,
    sent_via TEXT CHECK(sent_via IN ('sms', 'whatsapp', 'email', 'all')),
    sent_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_mod_presence_notif_pending ON mod_presence_notifications(school_id, sent_at) WHERE sent_at IS NULL;

-- Planification horaire classe
CREATE TABLE IF NOT EXISTS mod_presence_schedule (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    class_id TEXT NOT NULL,
    day_of_week INTEGER NOT NULL CHECK(day_of_week BETWEEN 1 AND 7),
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    session_name TEXT,
    UNIQUE(school_id, class_id, day_of_week, start_time)
);

CREATE INDEX IF NOT EXISTS idx_mod_schedule_class ON mod_presence_schedule(class_id);

-- Activity Log
CREATE TABLE IF NOT EXISTS mod_presence_activity_log (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL,
    action TEXT NOT NULL,
    category TEXT DEFAULT 'presence',
    details TEXT,
    user_id TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mod_presence_activity_timestamp ON mod_presence_activity_log(timestamp);