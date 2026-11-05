#!/usr/bin/env node
// ============================================================================
// KUMA Module Installer — generic (reads module.json for id/name/version)
// Usage: node scripts/install.mjs [--zip] [--apply-schema]
// ============================================================================
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(path.join(MODULE_ROOT, 'module.json'), 'utf8'));
const args = new Set(process.argv.slice(2));

console.log(`\n${manifest.name} v${manifest.version}\n`);

// ── ZIP distribution ────────────────────────────────────────────────────────
if (args.has('--zip')) {
    const { execSync: exec } = await import('node:child_process');
    const outName = `${manifest.id}-${manifest.version}.zip`;
    const outPath = path.join(path.dirname(MODULE_ROOT), outName);
    exec(
        `cd "${path.dirname(MODULE_ROOT)}" && zip -qr "${outName}" "${path.basename(MODULE_ROOT)}" ` +
        `-x "*/node_modules/*" "*/.git/*" "*/__tests__/*" "*.zip"`,
        { stdio: 'inherit' }
    );
    const size = existsSync(outPath) ? (readFileSync(outPath).length / 1024).toFixed(1) : '?';
    console.log(`✓ ${outPath} (${size} KB)`);
    process.exit(0);
}

// ── Host detection ──────────────────────────────────────────────────────────
function findHost() {
    let dir = path.dirname(MODULE_ROOT);
    for (let i = 0; i < 4; i++) {
        if (existsSync(path.join(dir, 'backend', 'package.json')) && existsSync(path.join(dir, 'kuma-school-frontent-update'))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

const hostRoot = findHost();
if (hostRoot) {
    const pkg = JSON.parse(readFileSync(path.join(hostRoot, 'backend', 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    console.log(`✓ Host detected: ${hostRoot}`);
    for (const dep of Object.keys(manifest.requires || {})) {
        if (dep.startsWith('d1') || dep.startsWith('auth')) continue;
        console.log(`${deps[dep] ? '✓' : '✗'} ${dep} ${deps[dep] ? 'found' : 'MISSING'} in backend/package.json`);
    }

    // TypeScript/Vite/esbuild resolve bare imports (hono, react, lucide-react…) by
    // walking up from the importing file. Give the module a node_modules directory
    // of per-package symlinks so embedded mode type-checks & builds.
    const feNodeModules = path.join(hostRoot, 'kuma-school-frontent-update', 'node_modules');
    const beNodeModules = path.join(hostRoot, 'backend', 'node_modules');
    const linkDir = path.join(MODULE_ROOT, 'node_modules');
    const wanted = { hono: beNodeModules, react: feNodeModules, 'lucide-react': feNodeModules, 'pdf-lib': beNodeModules };
    const { mkdirSync, symlinkSync, statSync } = await import('node:fs');
    try { mkdirSync(linkDir, { recursive: true }); } catch { /* exists */ }
    let linked = 0;
    for (const [pkgName, fromDir] of Object.entries(wanted)) {
        const target = path.join(fromDir, pkgName);
        const dest = path.join(linkDir, pkgName);
        if (!existsSync(target) || existsSync(dest)) continue;
        try { symlinkSync(path.relative(linkDir, target), dest, 'dir'); linked++; } catch { /* non-fatal */ }
    }
    if (linked) console.log(`✓ linked ${linked} package(s) into module node_modules (TS/Vite resolution)\n`);
} else {
    console.log('ℹ No host codebase detected — standalone deployment is a perfect fit.\n');
}

// ── Embedded install instructions ───────────────────────────────────────────
console.log('── EMBEDDED INSTALL (2 lines in the host) ─────────────────────────────');
console.log('1) backend/src/index.ts — mount the sub-app:');
console.log(`   import { create${manifest.name.split('—')[1]?.trim().split(' ')[0] || 'Module'} } from '../../modules/${path.basename(MODULE_ROOT)}/server/${path.basename(MODULE_ROOT).replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Module';`);
console.log(`   app.route('${manifest.mountPath}', createXxxModule());`);
console.log('2) schema (idempotent, module-owned tables only):');
console.log(`   npx wrangler d1 execute <DB> --remote --file modules/${path.basename(MODULE_ROOT)}/server/schema.sql\n`);

console.log('── STANDALONE INSTALL (zero host code) ────────────────────────────────');
console.log(`   cd modules/${path.basename(MODULE_ROOT)}/server/standalone`);
console.log('   npx wrangler d1 execute <DB> --remote --file ../schema.sql');
console.log('   npx wrangler deploy\n');

console.log(`── API contract (stable) ──`);
console.log(`   ${manifest.mountPath}/v1/*\n`);

// ── Apply schema to remote D1 ───────────────────────────────────────────────
if (args.has('--apply-schema') && hostRoot) {
    const db = process.env.KUMA_D1_NAME || 'kuma-school-production-db';
    console.log(`── Applying schema to D1 "${db}" (remote) ──`);
    execSync(
        `cd "${path.join(hostRoot, 'backend')}" && npx wrangler d1 execute ${db} --env production --remote --file "${path.join(MODULE_ROOT, 'server', 'schema.sql')}"`,
        { stdio: 'inherit' }
    );
    execSync(
        `cd "${path.join(hostRoot, 'backend')}" && npx wrangler d1 execute ${db} --env production --remote --command "INSERT OR IGNORE INTO d1_migrations (name) VALUES ('module:${manifest.id}@${manifest.version}');"`,
        { stdio: 'inherit' }
    );
    console.log('✓ Schema applied + migration tracker row inserted.');
}

console.log('✨ Ready.\n');
