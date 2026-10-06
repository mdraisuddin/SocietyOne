# SocietyOne — Phase 1 MVP

**One App. One Community. Everything Connected.**

SocietyOne is a multi-tenant SaaS platform for gated communities and apartment societies, built first for Hyderabad and designed to expand across India. It brings residents (owners, tenants, family members), security guards, facility managers, society administrators and SocietyOne platform staff together in one product:

| App | Path | Who | Optimised for |
|---|---|---|---|
| **Resident App** | `/app` | Owners, tenants, family members | Android / iOS phones (installable PWA) |
| **Security App** | `/guard` | Security guards | Android phones and tablets at the gate, with offline queueing |
| **Management Portal** | `/admin` | Society admins, facility managers | Desktop and tablet |
| **Platform Portal** | `/platform` | SocietyOne super admins | Desktop |

After sign-in, each user is sent automatically to the interface for their role.

---

## Run it in your browser (nothing to install)

You need only a GitHub account. **GitHub Codespaces** runs SocietyOne and its database on GitHub's servers:

1. Open the repository on GitHub and switch to the branch that contains this code.
2. Click **Code → Codespaces → Create codespace on …**.
3. Wait 3–5 minutes the first time. The codespace installs everything, creates the database, loads the Green Meadows demo data, then builds and starts the app.
4. A browser tab opens on the app. If it doesn't, open the **Ports** tab and click the globe icon next to **4000 (SocietyOne)**.
5. Sign in with any [demo account](#demo-accounts).

Notes:
* The app link is private to your GitHub account. To show it to someone, right-click port 4000 → **Port Visibility → Public**. Anyone with the link can then open it.
* Codespaces stop after about 30 minutes idle. Reopen it from **github.com/codespaces**; your data is kept. To restart the app, run `npm start` in the terminal. To reset the demo data, run `npm run db:reset`.
* GitHub's free plan includes a monthly allowance of Codespaces hours. Delete the codespace when you're done to avoid using it up.
* To try it as a phone app, open the link on your phone and choose **Add to Home Screen**.

## Quick start (on your own computer)

Requirements: **Node.js 20+** and **PostgreSQL 14+**.

```bash
# 1. Install
npm install

# 2. Database (example for a local Postgres)
createuser -s societyone && psql -c "ALTER USER societyone PASSWORD 'societyone'"
createdb -O societyone societyone_dev
createdb -O societyone societyone_test      # for automated tests
cp server/.env.example server/.env          # adjust DATABASE_URL / APP_SECRET

# 3. Create the schema and load the Hyderabad demo society
npm run db:reset

# 4a. Development (API on :4000, web with hot reload on :5173)
npm run dev                                  # open http://localhost:5173

# 4b. Or production-style: one server for API + built web app
npm run build && npm start                   # open http://localhost:4000
```

### Demo accounts

Demo mode (`DEMO_MODE=true`; it is always off when `NODE_ENV=production`) shows the OTP on screen, because no SMS gateway is connected. The login page also lists the demo accounts, and tapping one signs you in.

| Role | How to sign in | Lands on |
|---|---|---|
| **Resident** — Ananya Sharma, owner of A-1204, Tower A | Mobile OTP: **98480 12345** | Resident App `/app` |
| Resident (family) — Rohit Sharma, A-1204 | Mobile OTP: **98480 12346** | Resident App |
| Resident (tenant) — Vikram Iyer, B-1204 | Mobile OTP: **90000 00004** | Resident App |
| **Security Guard** — Ramesh Yadav, Gate 1 | Mobile OTP: **90000 00003** | Security App `/guard` |
| Security Guard — Shaik Basha, Gate 2 | Mobile OTP: **90000 00006** | Security App |
| **Society Admin** — Kavitha Reddy | `admin@greenmeadows.in` / `GreenMeadows@2026` (or OTP **90000 00002**) | Management Portal `/admin` |
| Facility Manager — Mohammed Irfan | `fm@greenmeadows.in` / `GreenMeadows@2026` | Management Portal |
| **Super Admin** — SocietyOne platform | `superadmin@societyone.in` / `SocietyOne@2026` | Platform Portal `/platform` |
| Other society's admin (isolation demo) | `admin@lakeviewheights.in` / `Lakeview@2026` | Lakeview Heights portal |
| Other society's resident | Mobile OTP: **90000 00011** | Lakeview Heights resident app |

How the OTP works: enter the mobile number → **Get OTP**. The 6-digit code appears in a blue box → tap **Use code**. The API also logs it to the console (`[sms] OTP for …`).

### Demo data: Green Meadows Residential Society (Kondapur, Hyderabad 500084)

* 4 towers (A–D) × 20 floors × 8 flats = **640 flats**, about 86% occupied, **~1,675 residents** (owners, tenants, family members)
* 2 gates and 5 guards from a security agency, working day, night and rotational shifts
* 9 facilities: badminton and tennis courts, swimming pool, gym, clubhouse, function hall, BBQ area, meeting room, kids' play area. Each has its own opening hours, slot length, capacity and rules.
* ~1,230 gate entries over 30 days (guests, Swiggy/Zomato, Amazon/Flipkart/Blinkit/Zepto, couriers, Uber/Ola/Rapido, domestic staff), with **37 visitors today and 12 inside now**
* ~60 complaints across every status. Ananya's complaint **SOC-INC-1045** "Kitchen sink leakage" has a technician assigned.
* Upcoming visitor **Ahmed Khan** (today, 8:00 PM), a recurring housekeeping pass, and a **Badminton Court** booking for tomorrow, 7:00–8:00 PM
* Real-world announcements (HMWSSB water cut, Diwali, lift maintenance, AGM…) and Hyderabad emergency contacts (108, 100, 101, nearest hospital…)
* A second society, **Lakeview Heights**, to show that tenants are kept separate

---

## Try the critical workflows

1. **Visitor** — As Ananya: *Visitors → Invite visitor*. This creates a pass ID (`VIS-xxxxxx`), a QR code and a 6-digit passcode, which can be shared. As Ramesh (guard): *Scan QR* or *Enter passcode* → **CHECK IN**. Ananya gets a notification. Then *Inside now → Out*. The visit appears in Ananya's *History*.
2. **Unexpected visitor** — Guard: *New visitor* → flat A-1204 → **Request approval**. Ananya sees the request on Home → **Approve**. The guard's screen updates to *Approved* → **CHECK IN**.
3. **Delivery / cab / staff** — Guard: *Food delivery → Swiggy → A-1204*. The resident is told "Your Swiggy food delivery has arrived at Gate 1."
4. **Complaint** — Resident: *Complaints → Raise complaint*, with photos (compressed on the phone). Admin: *Complaints* → open it → assign → *Start work* → *Mark resolved*. Resident: *Yes, it's fixed* → rate 1–5.
5. **Facility** — Resident: *Facilities → Badminton Court → date → slot → Book*. Other residents now see that slot as *Booked*. Cancel it in *My bookings* and it becomes available again.
6. **Announcement** — Admin: *Announcements → New announcement*. Residents get a notification and see it on Home. Emergency notices are shown in red and reach guards too.

---

## Architecture

A **modular monolith**: one deployable unit with clean module boundaries, so future modules (SocietyOne Pay, AI, Secure, Services, Assets) can be added without rebuilding the core.

```
server/                      Node.js + TypeScript + Express 5 + PostgreSQL (pg, SQL migrations)
  src/config.ts              env-driven config (secrets never hard-coded in production)
  src/db/migrations/*.sql    normalised schema, FKs, indexes, triggers
  src/db/seed.ts             Hyderabad demo data
  src/core/                  cross-cutting platform services
    auth.ts                  sessions, tenant context, requireRole / requirePermission
    rbac.ts                  permission matrix per role
    audit.ts                 append-only audit writer (secrets scrubbed)
    notifications.ts         in-app + push channel architecture, preferences
    storage.ts               file storage adapter (local disk → S3/GCS later), magic-byte validation
    idempotency.ts           Idempotency-Key replay protection (offline guard sync)
    validate.ts, errors.ts, time.ts (IST-aware), crypto.ts
  src/modules/               feature modules (each a router + its own queries)
    auth, profile, platform, society (+structure), people (residents, guards),
    visitors (resident + gate APIs), complaints, facilities (+bookings engine),
    community (announcements, emergency contacts), insights (dashboard, home, search, audit),
    notifications
  src/jobs.ts                idempotent scheduler: expiries, scheduled announcements, cleanup
  tests/                     Vitest + Supertest API tests against a real Postgres
web/                         React 19 + Vite + TanStack Query PWA
  src/apps/resident|guard|admin|platform   code-split per role (a guard never downloads the admin portal)
  src/lib/offline.ts         guard offline queue + cache
  public/sw.js               service worker: app-shell cache, web-push display
e2e/                         Playwright multi-role end-to-end tests
```

### Multi-tenancy

* Hierarchy: **Platform → Society → Tower → Floor → Flat → Resident** (`resident_flat_relationships` holds owner / tenant / family member).
* **Every operational table has a `society_id` column.** Composite foreign keys such as `(flat_id, society_id) → flats(id, society_id)` make it **impossible in the database** to link a record to a flat, tower, visitor or gate from another society.
* The tenant comes from the **server-side session**, never from the URL or request body. Every query is filtered on `society_id`, so fetching another society's record ID returns `404`.
* One person can belong to several societies or hold several roles (`society_users`) and switch between them.

### Security

| Area | Implementation |
|---|---|
| Authentication | Indian mobile + 6-digit OTP (5-min expiry, HMAC-hashed at rest, 5 attempts max, 30 s resend cooldown, 5/hour cap, per-IP limiter, no account enumeration). Email/password for admins only (bcrypt, login rate limiting). Forgot/reset with single-use 30-min tokens; reset revokes all sessions. |
| Sessions | Random 256-bit tokens, stored as SHA-256, in `HttpOnly` + `SameSite=Lax` (+ `Secure` in production) cookies, or as a Bearer token for native apps. Users can list and revoke sessions. Removing a person or deactivating a society revokes access immediately. |
| CSRF | Cookie-authenticated mutations must send the `X-SocietyOne-Client` header. CORS is restricted to configured origins. |
| RBAC | Permission matrix (`core/rbac.ts`) checked on every route, plus flat ownership checks (residents can act only on their own flats). |
| Data minimisation | Guards see first name + surname initial and masked mobiles only — no financial, admin or contact data. Super admins get society-level aggregates only, never resident records. Residents never see other flats' data. |
| Validation | Zod schemas on every input, Indian mobile / PIN / vehicle formats, parameterised SQL everywhere, LIKE wildcards escaped, safe error messages that never leak SQL. |
| Uploads | Images only, checked by **magic bytes** (not extension), 5 MB cap, random server-side keys, served only to authorised members of the owning society, `nosniff`. |
| QR passes | Tokens are HMAC-signed with the server secret, so a forged or altered QR is rejected. |
| Headers | Helmet: strict CSP, frame-ancestors none, HSTS in production. `x-powered-by` removed. |
| Audit | `audit_logs` is **append-only, enforced by database triggers**: UPDATE, DELETE and TRUNCATE all fail. Records actor, role, action, record, old/new values, IP and user agent. Admins can read their own society's log; nobody can edit it. |
| Secrets | Loaded from the environment / secret manager. Production refuses to start without `APP_SECRET`. Demo mode is forced off in production. TLS terminates at the load balancer (`trust proxy` is set). |

### Notifications

Every event writes an **in-app notification** (the source of truth). Pluggable **channels** fan out from there: Web Push via VAPID is built in, and FCM/APNs/SMS can be added behind the same `PushChannel` interface. Per-category **preferences** (visitors, complaints, bookings, announcements) control in-app and push separately. Emergency announcements and visitor approval requests always get through. Events: visitor arrived / approval requested / approved-rejected / checked in / checked out / delivery arrived; complaint created / assigned / status changed / resolved / commented; booking confirmed / cancelled; new and emergency announcements (including scheduled ones).

### Performance on Indian mobile networks

* Code-split apps; gzip compression; immutable, hashed static assets with long cache lifetimes; service-worker app shell.
* The home screen loads in **one API call** (`/home`). Lightweight polling endpoints (`/notifications/summary`). Debounced search. TanStack Query caching with `offlineFirst`.
* Photos are compressed **on the phone** (≤1600 px JPEG) before upload. The ~130 KB QR decoder is fetched only on devices without the native `BarcodeDetector`.
* **Security App offline mode:** today's expected visitors are cached on the device, so passcodes can be verified offline. Check-ins, check-outs and deliveries are queued with idempotency keys and replayed automatically when the connection returns. The server de-duplicates replays (`Idempotency-Key` + `client_ref`).

### Ready for the next phases

* **SLA:** complaints already store `sla_policy_id`, `first_response_at` and `resolution_due_at` (target hours per priority). The dashboard flags overdue complaints.
* **Pay / Accounting:** `society_subscriptions`, flat/area data and the module layout leave room to add billing tables without touching existing ones.
* **Secure** (ANPR, RFID, boom barriers): gate entries are modelled as generic `visitor_entries` per gate, with a device-agnostic API and idempotent ingestion.
* **Notifications channels** (SMS/WhatsApp) plug into `core/notifications.ts`. **Storage** moves to S3/GCS through `core/storage.ts`. Jobs move to a queue worker without changing the business logic.

Not in Phase 1, by design: maintenance payments, accounting, marketplace, AI assistant, WhatsApp, ANPR, CCTV, IoT, boom barriers, RFID, vendor marketplace, advanced asset management.

---

## Testing

```bash
npm test                 # API tests: auth, RBAC, tenant isolation, audit immutability, all critical workflows
npm run test:e2e         # Playwright: the critical workflows driven through the real UI with multiple role sessions
```

* The API tests (`server/tests`) run against a real PostgreSQL database (`societyone_test`), which is reset and seeded for each run.
* The E2E tests (`e2e/`) build the web app, reset and seed `societyone_e2e`, start the server on port 4100, and drive Resident, Guard, Admin and Super Admin browsers side by side. If your Playwright version doesn't match the installed Chromium, set `PW_CHROMIUM_PATH`.

## Configuration (`server/.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `APP_SECRET` | Signs QR passes and OTP hashes (**required in production**) |
| `CORS_ORIGINS` | Allowed browser origins in development |
| `UPLOAD_DIR` | Local file storage path |
| `DEMO_MODE` | Show OTP / reset links on screen (ignored in production) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (`npx web-push generate-vapid-keys`) |

## Production notes

* Run behind HTTPS (TLS at the load balancer or reverse proxy). Set `NODE_ENV=production`, a strong `APP_SECRET`, and real SMS (DLT-registered template) and email providers at the marked integration points in `modules/auth.ts`.
* Keep the database in an Indian region (for example AWS Mumbai or Hyderabad) to meet data-residency expectations under India's DPDP Act. Personal data collected is limited to what each workflow needs.
* For more than one instance, move `jobs.ts` to a dedicated worker or queue and the rate-limit store to Redis.
