# KUMA Module — Pointage & Notifications (Côte d'Ivoire) 🇨🇮

**Version 1.0.0 · API v1 · Module Autonome**

Pointage électronique des présences (RFID/Mobile) et notifications automatiques aux parents. Conçu pour l'Afrique de l'Ouest.

---

## 🏗️ Architecture Autonome

```
modules/presence-sms/           ← Structure atomique
├── module.json                ✅ Manifest autonome
├── README.md                  ✅ Documentation
├── registry.json              ✅ Métadonnées hub
├── server/
│   ├── presenceModule.ts      ✅ Factory Hono exportée
│   ├── schema.sql             ✅ Tables mod_presence_* seulement
│   ├── standalone/index.ts    ✅ Worker indépendant
│   └── __tests__/test.ts      ✅ Tests Vitest
├── frontend/
│   ├── PresenceScanner.tsx    ✅ Component React autonome
│   └── presence.service.ts    ✅ Service API client
├── scripts/
│   └── install.mjs            ✅ CLI d'installation + ZIP
└── .github/workflows/
    └── release.yml            ✅ CI/CD auto-génération
```

## 📦 Installation

### Path A : Embed dans Worker existant
```bash
npx wrangler d1 execute <YOUR_DB> --remote --file modules/presence-sms/server/schema.sql
# backend/src/index.ts
import { createPresenceModule } from '../../modules/presence-sms/server/presenceModule';
app.route('/api/v1/modules/presence', createPresenceModule());
```

### Path B : Worker autonome
```bash
cd modules/presence-sms/server/standalone
npx wrangler deploy
```

## 🔌 API v1

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | Probe de capacité |
| POST | `/scan` | teacher | Enregistrer un pointage |
| GET | `/absences` | admin | Liste absences non justifiées |
| POST | `/detect-absences` | teacher | Détection automatique |
| POST | `/notification` | admin | Envoi notification parent |
| GET | `/schedule/:classId` | teacher | Horaires classe |
| POST | `/schedule/:classId` | teacher | Sauvegarder horaires |

## 💡 Bridge Mode

- Mirror `mod_presence_sessions` → `attendance` (core)
- Notifications → `activity_logs`, envoi SMS via passerelle locale
- Détection absences → alerte parents automatiquement

## 🧪 Tests
```bash
npx vitest run src/__tests__/presence.test.ts
```

## 📄 License
MIT — Libre utilisation dans vos écoles KSP.