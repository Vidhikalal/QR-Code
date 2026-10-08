# Passline v2 — Implementation Plan (NFC badges, profiles, networking, leaderboards)

> **Status:** Ready to build · **Owner:** Ade · **Written:** 2026-10-08
> **Builds on:** `SPEC.md` v0.2 and the code at commit `ff241f9` ("updated the README").
> **Reference SQL:** `docs/v2/reference-sql/01…07_*.sql`. Every function in this plan exists there and was run on PostgreSQL 16 on top of the repo's real migrations. The scenario and concurrency checks marked ✓ in §15 passed (see §15.0).

---

## 0. How Claude Code uses this document

1. **Read order at the start of every v2 session:** `CLAUDE.md` → this file → the `SPEC.md` sections a task touches.
2. **Precedence.** For anything v2 changes, **this plan wins over `SPEC.md`**. When a slice lands, move its decisions into `SPEC.md` (new sections, changelog entry v0.3) in the same PR. When the last slice lands, `SPEC.md` is complete again and this file becomes history.
3. **Slices.** Build in the order of §16. One slice per branch. Plan mode first (CLAUDE.md "Workflow for every task"), tests first, then code. Each slice lists its exit tests.
4. **Reference SQL is a starting point, not scripture.** Copy each file into `supabase/migrations/` as a new timestamped migration in the slice that first needs it (§16 says which). You MAY restructure it. You MUST keep its behaviour: the result codes, the lock order and the constraints, because the tests in §15 pin them down. If you change behaviour, stop and say why.
5. **`(?)` items are open team questions.** Build them behind the defaults in §2.2 and the feature flags in §2.3. Never block a slice on a `(?)`.
6. **Stop and ask** when this plan contradicts `CLAUDE.md`, the code, or a device/API behaviour you observe (§17 lists what is unverified).

---

## 1. What v2 is, in one page

Passline v1 emails each accepted applicant a QR pass and scans it at the door, meals, workshops and custom checkpoints. v2 keeps all of that and adds:

| Area | v1 | v2 |
|---|---|---|
| Identity inside the event | QR pass on a phone for every scan | QR pass **once** at the door; then a **single-event NFC badge** for everything else |
| Event setup | `pnpm event:create` in a terminal | **Platform admins** create events, checkpoints, limits and points in the dashboard; events list and switcher |
| Participant presence | A pass page | A **profile** (nickname, links, bio…) editable from a **permanent edit link**; a **badge page** anyone can open by tapping the badge |
| Meals | Hard "once per meal" | **Unlimited servings with a soft warning** ("Served 1× already, at 12:41. Serve again?") and a **Seconds open** switch |
| Workshops/activities | Attendance | Attendance **+ points** per checkpoint |
| Networking | — | Tap a badge → **Connect**; counts only when **mutual**; organizer connections earn a bonus |
| Leaderboards | — | **Activity** and **networking** boards; projector screen that refreshes **hourly**; freeze at the end |
| After the event | Export | **Recap email** with stats, connections link and the **badge unlock password** |
| Organizers | Staff accounts | Staff accounts **plus their own badge and profile**, labelled **Organizer**, with optional "Ask me about…" topics |

Unchanged and still non-negotiable: the Google Form → Sheet → Apps Script bridge, the email outbox, the duplicate-proof `record_scan()` decision path, deny-all RLS, and every invariant I-1…I-15.

---

## 2. Decisions

### 2.1 Decided (do not re-litigate)

| # | Decision | Notes |
|---|---|---|
| D1 | Keep **Google Forms + Sheet** for applications | The Forms REST API cannot submit responses, so a custom front-end on top of Forms is not viable. A native form is a possible later project, not v2. |
| D2 | **Two codes:** the emailed **QR pass** proves acceptance at the door; the **NFC badge** is used everywhere inside | The pass is shown once. |
| D3 | Badges are **NTAG21x stickers/cards** holding the URL `https://<ME_HOST>/t/<publicId>` | `publicId` = 12 base64url chars (9 random bytes, 72 bits). |
| D4 | Badges are **single-event**. Not collected afterwards. | A tag row belongs to one event forever. Reuse across events is **out of scope**. |
| D5 | Tags are **password-protected** (not permanently locked) with **one shared password per event** | Announced in the recap email so owners can unlock and reuse their badge. Never use `NDEFReader.makeReadOnly()`: that lock is permanent. |
| D6 | **A badge identifies, never authorizes** | Check-ins need a staff session; edits need the owner's session. Tapping a badge never records anything by itself. |
| D7 | Owner sign-in = a **permanent "Edit my profile" link** in their email | Exchanged for an httpOnly session cookie. Logging out affects one device. The link keeps working until the owner rotates it. Recovery: "This is me", "Email me a sign-in link", staff 2-minute sign-in code. |
| D8 | The edit-link key is a **different secret from the QR pass token** | The QR is semi-public (shown at the door, screenshotted). |
| D9 | **Every** pass email carries a **fresh edit key**; older keys stay valid | Hashes only, so a key can't be re-sent; several active keys per person are allowed. "Get a new link" revokes all. |
| D10 | **One photo**, visible **only to staff at checkpoints** | Never on the public profile. |
| D11 | Meals: **no maximum**; first serving green; repeats amber with **Serve again**; organizer **Seconds open** switch removes the warning | Every serving counts in analytics. Meals are worth 0 points (constraint). |
| D12 | **Staff tap every badge.** No self-service stations. | |
| D13 | Workshops keep an optional **capacity**, set when the checkpoint is created | |
| D14 | Networking counts **mutual** connections only; **connecting with an organizer earns a bonus** (default +2) | |
| D15 | "My connections" shows **nickname + LinkedIn** + a link to their badge page | |
| D16 | Leaderboard names: **nickname**, else **first name + last initial** | |
| D17 | Projector shows the **top 3**, refreshing **hourly** (configurable 0/15/30/60 min) | Each person sees their own points live on `/me`. |
| D18 | **Everything is created from the dashboard** by a **platform admin**: events, checkpoints, limits, points; organizers invited by email | |
| D19 | **Organizers get badges** with the **Organizer** label and optional **"Ask me about…"** topics | |
| D20 | Phones first: **Android Chrome reads/writes tags in-page (Web NFC)**; **iPhone** taps open the badge page in Safari; **laptop USB readers later**, through the same lookup by chip serial | |
| D21 | Activity points are **configurable per checkpoint** | |
| D22 | One app, **two hostnames**: `admin.<domain>` (staff) and `me.<domain>` (participants, badges). Domain and hosting decided later. | Single host (`localhost:3000`) in development. |

### 2.2 Open questions `(?)` and the defaults to build now

| Q | Question | Default built now | Where it lives |
|---|---|---|---|
| Q1 | Can organizers compete for prizes? | **No** (`events.organizers_compete = false`) | Event settings toggle |
| Q2 | Mentors, judges, volunteers: badges, labels, Discord, mentor directory? | `badge_role` supports `mentor`, `judge`, `volunteer`; **UI hidden** behind `FEATURE_EXTRA_BADGE_ROLES` | §18.3 |
| Q3 | Profiles editable forever, including after the event? | **Yes**, until retention deletes them | — |
| Q4 | How long do profiles stay online after the event? | **30 days** after `ends_at` (`events.profile_retention_days`) | Event settings |
| Q5 | How customizable is the recap email? | Organizer-written **message with placeholders** + a fixed stats block | §12.4 |
| Q6 | Which activities, how many points, repeatable? | Points per checkpoint; **once per person** (meals excepted) | §18.5 |
| Q7 | Scavenger hunt? | **Off** (`FEATURE_HUNT`), design in §18.1 | — |
| Q8 | Staff shifts? Restricted to assigned checkpoint? | **Off** (`FEATURE_SHIFTS`), design in §18.2 | — |
| Q9 | Printed QR backup on each badge? | **Supported** by the scanner and the print sheet; printing is the organizers' call | §11.5 |
| Q10 | Yves's NFC device: what is it, does it change networking? | Not modelled. Networking stays phone-tap. | §17 A-NFC-7 |
| Q11 | BearHacks code: ideas or base? | Not used | — |

### 2.3 Feature flags

Server-side env flags, parsed in `lib/env.ts` (zod, default `false`): `FEATURE_EXTRA_BADGE_ROLES`, `FEATURE_HUNT`, `FEATURE_SHIFTS`. A flagged-off feature has no routes (404) and no UI. Its tables may exist.

---

## 3. Glossary additions

| Term | Meaning |
|---|---|
| **Badge** / **tag** | An NFC chip registered to one event. `tags.public_id` is in the URL written on it; `tags.uid` is the chip's serial number. |
| **Assignment** | The link between a badge and a person. At most one **active** assignment per badge and per person. |
| **Retired badge** | A badge that was replaced (lost/broken). It can never be assigned again. |
| **Badge holder** | Any `participants` row that wears a badge: applicants, walk-ins and staff (`badge_role`). |
| **Profile** | The public, owner-editable part of a badge holder (`profiles`). Never contains email, photo, dietary notes or history. |
| **Edit key** | Secret in the "Edit my profile" link (`/edit#<key>`). Stored as sha256 in `profile_keys`. |
| **Participant session** | httpOnly cookie on the ME host; stored as sha256 in `participant_sessions`. |
| **Sign-in code** | 2-minute single-use secret shown as a QR: staff hand-off, or an organizer hopping to their own profile. |
| **Station** | The checkpoint a staff member is currently working (`staff_stations`). |
| **Serving** | One live meal scan. `scans.serving_no` numbers them 1, 2, 3… per person per meal. |
| **Mutual connection** | Both people tapped each other's badge and pressed Connect. |
| **As-of time** | The moment a leaderboard is computed for: the start of the current refresh window, or the freeze time. |
| **ADMIN host / ME host** | `admin.<domain>` serves staff pages; `me.<domain>` serves passes, profiles and badge pages. |

---

## 4. Principles and new invariants

Add these to `CLAUDE.md` under "Non-negotiable invariants" in slice V0. Each has tests (§15).

- **I-16 A badge identifies, never authorizes.** `tags.public_id` and `tags.uid` are public. No endpoint grants access, signs anyone in or records a check-in because a request carries a badge id. Authorization comes from a staff session (Supabase) or a participant session (cookie), checked server-side.
- **I-17 GET never mutates.** Badge pages, pass pages and edit-link pages are opened by link previews, prefetchers and OS NFC handlers. Every state change is a `POST`/`PATCH`/`DELETE` triggered by a deliberate user action (or by the in-page Web NFC reader on the staff scanner).
- **I-18 Edit keys, session values and sign-in codes are secrets** with the I-3 rules: sha256 only in the DB; never logged; the edit key and sign-in code travel only in a URL **fragment** or a POST body; the session value only in an `HttpOnly` cookie.
- **I-19 The public profile has one shape.** Everything shown to non-staff about a badge holder goes through `toPublicProfile()` in `lib/profile/public.ts` (pure, unit-tested). It can never contain email, photo, dietary notes, status, scans, points of others beyond the leaderboard, or staff notes.
- **I-20 One decision path per action, in SQL.** Scans → `record_scan()`; badge links → `assign_tag()` / `unassign_tag()`; connections → `record_connection()`; sessions → `open_profile_session()` / `redeem_signin_code()` / `session_participant()`. No read-then-write in TypeScript.
- **I-21 Lock order is checkpoint → participant → tag.** Any new SQL that locks more than one of these follows it (deadlock freedom).
- **I-22 Points are derived, never stored.** Leaderboards and personal points are computed from scans and connections as of a time (`points_as_of()`). No counters to drift.
- **I-23 Host separation.** Staff pages answer only on the ADMIN host; participant pages only on the ME host (single host in dev). The staff actions the badge page needs (`/api/scan`, `/api/tags/*`, `/api/stations`, sign-in codes, hide profile) are served on both hosts and authorize exactly as on the ADMIN host. Every mutation on the ME host verifies `Origin` equals the ME origin.

The three existing principles extend naturally: the browser still never touches tables (I-5), RLS is still deny-all (I-6), and server time is still authoritative (I-7).

---

## 5. Architecture

```
                                       ┌──────────────── ADMIN host (admin.<domain>) ───────────────┐
 Google Form → Sheet → Apps Script ──► │ /api/ingest/sheet                                          │
                                       │ /login /auth/callback /onboarding                          │
 Staff phone / laptop ───────────────► │ /admin  (events list)   /admin/new   /admin/[slug]/…        │
   camera (QR pass, printed badge QR)  │ /scan/[slug]  camera + Web NFC (Android) + manual          │
   Web NFC (Android)                   │ /admin/[slug]/screen  (projector, staff session)           │
                                       └────────────────────────────────────────────────────────────┘
                                                     │ route handlers → service-role client → SQL functions
                                                     ▼
                                              Postgres (Supabase) ◄── outbox drainer ──► Email provider
                                                     ▲
                                       ┌──────────────── ME host (me.<domain>) ─────────────────────┐
 Participant phone ──────────────────► │ /p#token        pass page (unchanged)                      │
   email links                         │ /edit#key       → session cookie → /me                     │
   badge taps (OS opens URL)           │ /signin         email me a link / redeem #code             │
 Anyone tapping a badge ─────────────► │ /t/[publicId]   badge page, shaped per viewer              │
 Staff iPhone tapping a badge ───────► │                 (staff panel if the Supabase cookie says so)│
                                       │ /me  /me/connections                                       │
                                       └────────────────────────────────────────────────────────────┘
```

### 5.1 Hosts and routing

| Env | Value (prod example) | Dev |
|---|---|---|
| `NEXT_PUBLIC_APP_ORIGIN` | `https://me.yourclub.ca` (**ME origin**: QR payloads, tag URLs, edit links) | `http://localhost:3000` |
| `NEXT_PUBLIC_ADMIN_ORIGIN` | `https://admin.yourclub.ca` | `http://localhost:3000` |
| `AUTH_COOKIE_DOMAIN` | `.yourclub.ca` | empty (host-only) |

- `proxy.ts` (Next 16 "proxy") gains a host check **before** the existing session refresh. When the two origins differ:
  - ME host: allow `/p`, `/edit`, `/signin`, `/me/**`, `/t/**`, `/api/me/**`, `/api/t/**`, `/api/pass/**`, `/api/signin/**`, the badge-page staff APIs (I-23), static assets. Everything else → 404.
  - ADMIN host: allow everything except the ME-only paths above → 404.
  - When the origins are equal (dev), no host filtering.
- **Staff sign-in must be visible on the ME host** so a staff iPhone tapping a badge gets the staff panel. Set the Supabase SSR cookie `domain` to `AUTH_COOKIE_DOMAIN` in every `createServerClient`/`createBrowserClient` call (`proxy.ts`, `lib/auth/session.ts`, the login form). Verify with test T-HOST-04 and assumption A-HOST-1.
- Read `node_modules/next/dist/docs/` for the Next 16 proxy API before editing `proxy.ts` (CLAUDE.md warns this version differs from training data).

### 5.2 Participant session cookie

| Property | Value |
|---|---|
| Name | `__Host-pl_me` when the ME origin is `https:`; `pl_me` on `http://localhost` (the `__Host-` prefix requires `Secure`) |
| Value | 32 random bytes, base64url. DB stores `sha256hex(value)`. |
| Flags | `HttpOnly`, `Secure` (prod), `SameSite=Lax`, `Path=/`, **no `Domain`** (host-only on the ME host) |
| Lifetime | `PARTICIPANT_SESSION_DAYS` (default 30). Server-side expiry in `participant_sessions.expires_at`. |
| Validity | `session_participant()` also requires the person to be `accepted` and not deleted, so a withdrawal signs them out everywhere at once. |

Helpers in `lib/participant/session.ts`: `readParticipant(request)`, `setParticipantCookie(response, value)`, `clearParticipantCookie(response)`. Handlers receive `ReadParticipant` as a dependency (like `Authenticate`) so integration tests can inject sessions.

### 5.3 New and changed modules

```
lib/
  badge/      parse-tag-url.ts (pure), uid.ts (pure), view.ts (pure: viewer matrix), handlers.ts
  nfc/        web-nfc.ts (NfcReader interface + Web NFC impl), keyboard-wedge.ts (later)
  participant/session.ts, handlers.ts
  profile/    public.ts (toPublicProfile, pure), schema.ts (zod, mirrors SQL checks), handlers.ts
  connections/handlers.ts
  leaderboard/as-of.ts (pure), handlers.ts
  events/     handlers.ts (create, list, join, settings)
  tags/       handlers.ts (reserve, confirm, import, assign, unassign)
  recap/      template.ts, handlers.ts
  domain/     scanned-text.ts (extended: pass | badge), scan-codes.ts (+3 codes)
app/
  (staff)/admin/page.tsx (events list), admin/new/page.tsx, admin/[slug]/{badges,settings,recap,screen}/…
  (me)/edit/page.tsx, signin/page.tsx, me/page.tsx, me/connections/page.tsx, t/[publicId]/page.tsx
  api/me/**, api/t/**, api/signin/**, api/tags/**, api/stations/route.ts, api/staff/hop/route.ts,
  api/admin/events/**, api/admin/[slug]/{tags,settings,recap,leaderboard}/**
```

---

## 6. Data model changes

All new tables: deny-all RLS (no policies). All new functions: `revoke all … from public, anon, authenticated`, `grant execute … to service_role`, `set search_path = public, pg_temp`. The reference files already do this; T-SEC-02/07/08 enumerate the catalog, so they cover new objects automatically.

| File | First needed in | Contents |
|---|---|---|
| `02_v2_admin_events.sql` | V1 | `platform_admins`; new `events` settings columns; `consume_platform_admin`, `is_platform_admin`, `create_event`, `join_event_as_admin`, `list_events_for` |
| `03_v2_profiles.sql` | V2 | `participants.badge_role`, `participants.staff_user_id`, `source` gains `'staff'`; `profiles`, `profile_keys`, `participant_sessions`, `signin_codes`; session and key functions; `ensure_staff_attendee` |
| `06_v2_outbox.sql` | V2 | `email_outbox.kind` gains `profile_link`, `recap`; generated `kind_group`; per-kind-group in-flight index; `request_profile_link`, `enqueue_recaps`; re-created `ingest_sheet_row`, `enqueue_pass` |
| `04_v2_tags.sql` | V4 | `tags`, `tag_assignments`; `_find_tag`, `register_tag`, `assign_tag`, `unassign_tag`, `tag_view` |
| `01_v2_enum_values.sql` | V5 | `scan_method` gains `'nfc'` (its own migration: a new enum value must commit before use) |
| `05_v2_scans.sql` | V5 | `checkpoints.points`, `checkpoints.seconds_open`; `scans.tag_id`, `scans.serving_no`; `scans_one_live` re-keyed; **new `record_scan` signature**; re-created `add_walk_in`; `staff_stations` + `set_staff_station` |
| `07_v2_networking.sql` | V6 | `connection_taps`; `_display_name`, `record_connection`, `my_connections`, `points_as_of`, `leaderboard` |

The slice order 02 → 03 → 06 → 04 → 01 → 05 → 07 was applied to a fresh database and is clean.

### 6.1 `scan_method += 'nfc'`

`'nfc'` means "identified by a badge": an NFC tap, the badge's printed QR, or a USB reader. `scans.tag_id` records which badge, and `scans_nfc_has_tag` enforces `(method = 'nfc') = (tag_id is not null)`.

### 6.2 Platform admins and event settings

- `platform_admins(email PK, user_id UNIQUE NULL)`. Bootstrapped with `pnpm admin:add <email>` (new script, service role, refuses to run without `--yes` against a non-local URL). `consume_platform_admin(user, verified_email)` links `user_id` at sign-in, next to `consume_staff_invites`.
- **Admins are not super-users in SQL.** `record_scan()` and friends still check `event_staff`. `create_event()` makes the creating admin an organizer. For any other event the UI offers **Join as organizer** (`join_event_as_admin`). This keeps every existing authorization path unchanged.
- New `events` columns: `created_by`, `organizers_compete` (Q1), `organizer_connection_bonus` (0–100, default 2), `leaderboard_refresh_minutes` (0, 15, 30, 60; default 60; 0 = live), `leaderboard_frozen_at`, `badge_unlock_password` (4–32 chars), `recap_message` (≤ 2000), `profile_retention_days` (default 30, Q4).
- `create_event()` returns `CREATED | FORBIDDEN | INVALID_TIMEZONE | INVALID_DATES | SLUG_TAKEN`. It validates the IANA zone in Postgres (`now() at time zone p_timezone`), creates the event, its single **Door** checkpoint (closed), and the admin's organizer row, in one transaction.

### 6.3 Badge holders and profiles

- `participants.badge_role ∈ {participant, organizer, mentor, judge, volunteer}`, default `participant`. `participants.staff_user_id` links an organizer's badge row to their staff account (unique per event).
- `ensure_staff_attendee(event, user)` creates (or adopts, if they also applied with the same email) the organizer's badge row with `source = 'staff'`, `status = 'accepted'`, and a profile pre-filled with their display name. Idempotent. Returns `OK | FORBIDDEN | PROFILE_INCOMPLETE`.
- `profiles` (1:1 with participants, created lazily by the first edit key or by `ensure_staff_attendee`):

  | Column | Rule (DB check; mirror in `lib/profile/schema.ts`) |
  |---|---|
  | `nickname` | 1–40 chars |
  | `pronouns` | ≤ 30 |
  | `program`, `year_label` | ≤ 80, ≤ 30 |
  | `bio` | ≤ 280 |
  | `linkedin_url` | `^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$` (pre-filled from the form) |
  | `github_url` | `^https://(www\.)?github\.com/[A-Za-z0-9-]{1,39}/?$` |
  | `website_url` | `https://` only, 4–200 chars, no spaces, `<`, `>` or `"` |
  | `discord_handle` | `^[a-z0-9_.]{2,32}$` (Q2) |
  | `ask_me_about` | ≤ 5 labels, each 1–30 chars, trimmed (organizers/mentors) |
  | `visibility` | `public` (default) or `hidden` |
  | `hidden_by_staff_at` | Organizer abuse switch; wins over `visibility` |
- **Hidden profile** = the badge page shows only the display name and a "This profile is private" line. Connecting still works; "My connections" omits their LinkedIn. Leaderboards still show the display name.

### 6.4 Edit keys, sessions, sign-in codes

| Function | Returns | Rule |
|---|---|---|
| `issue_profile_key(participant, key_hash)` | key id | Adds a key; never revokes others (D9). Creates the profile row on first use, copying the form's LinkedIn. |
| `rotate_profile_keys(participant, new_key_hash)` | key id | Owner's **Get a new link**: revokes every key **and every session**, then adds one key. |
| `open_profile_session(key_hash, session_hash, ttl)` | `OPENED | KEY_NOT_FOUND | KEY_REVOKED | NOT_ELIGIBLE` | Creates a session (`via = 'edit_link'`). |
| `issue_signin_code(participant, code_hash, purpose, created_by)` | `ISSUED | NOT_ELIGIBLE | FORBIDDEN` | `staff_handoff`: creator must be staff on the event. `organizer_hop`: creator must be that badge row's `staff_user_id`. 2-minute expiry. Audited. |
| `redeem_signin_code(code_hash, session_hash, ttl)` | `OPENED | CODE_INVALID | NOT_ELIGIBLE` | Single use via a conditional `UPDATE … WHERE used_at IS NULL AND expires_at > now()`. Expired, used and unknown codes all return `CODE_INVALID`. |
| `session_participant(session_hash)` | participant id or null | Valid = not revoked, not expired, person accepted and not deleted. Updates `last_seen_at` at most every 5 minutes. |
| `end_profile_session(session_hash)` | — | Sign out this device. |

### 6.5 Tags

- `tags(id, event_id, public_id UNIQUE, uid UNIQUE NULL, label, registered_by, registered_at, retired_at, retire_reason ∈ {replaced, damaged})`.
  - `public_id`: `^[A-Za-z0-9_-]{12}$`, minted by the server.
  - `uid`: the chip serial normalized to uppercase hex without separators, `^[0-9A-F]{8,20}$` (`normalizeUid()`, §11.3). Nullable until confirmed (reserve → write → confirm).
  - `label`: optional printed code like `B-0412`, assigned sequentially per event at reserve time.
- `tag_assignments(id, event_id, tag_id, participant_id, assigned_by, assigned_at, ended_at, ended_by, end_reason ∈ {replaced, unassigned, participant_removed})`.
  - Composite FKs `(tag_id, event_id)` and `(participant_id, event_id)` make a cross-event link impossible.
  - Partial unique indexes: one active assignment **per tag** and **per participant**.
- `_find_tag(public_id, uid)` looks a tag up by whichever identifier the reader produced (phones give the URL; USB readers give only the serial).
- `register_tag(event, staff, public_id, uid, label)` → `REGISTERED | ALREADY_REGISTERED | UID_CONFLICT | PUBLIC_ID_CONFLICT | FORBIDDEN` (organizers only). Calling it with `uid = null` reserves; calling again with the uid confirms.
- `assign_tag(event, staff, participant, public_id, uid, replace = false)`:

  | Code | When |
  |---|---|
  | `ASSIGNED` (+`replaced`, `participant`) | Linked. With `replace = true` the person's previous badge is ended (`replaced`) and **retired**. |
  | `ALREADY_ASSIGNED` | Same badge, same person (idempotent retry) |
  | `TAG_IN_USE` (+`holder`) | Badge is someone else's |
  | `PARTICIPANT_HAS_TAG` (+`currentTag`) | Person already wears another badge and `replace` is false |
  | `TAG_NOT_FOUND`, `TAG_WRONG_EVENT`, `TAG_RETIRED` | Badge problems |
  | `NOT_FOUND`, `NOT_ACCEPTED` | Person problems |
  | `FORBIDDEN` | Caller isn't staff on the event |

  Locks the participant, then the tag (I-21), and re-reads the tag under the lock.
- `unassign_tag(assignment, staff)` → `UNASSIGNED | ALREADY_ENDED | NOT_FOUND | FORBIDDEN`. For "wrong badge picked up": the badge stays usable. Volunteers: their own link, within 120 s. Organizers: any.
- `tag_view(public_id)` returns the tag, its event (slug, name, `ends_at`, retention days), the active assignment and the last holder. Viewer-specific shaping happens in TypeScript (§8).

### 6.6 Scans, servings, points, stations

- `checkpoints.points` (0–1000; **meals must be 0**), `checkpoints.seconds_open` (meals only).
- `scans.serving_no` (≥ 1). `scans_one_live` becomes `UNIQUE (participant_id, checkpoint_id, serving_no) WHERE voided_at IS NULL`. Non-meal checkpoints always write `serving_no = 1`, so "once per checkpoint" is unchanged for them. Meal servings are numbered over **all** rows including voided ones, so a number is never reused.
- **`record_scan` new signature** (the 7-argument version is dropped; `add_walk_in` is re-created to call the new one):

  ```sql
  record_scan(p_checkpoint_id uuid, p_staff_user_id uuid, p_method scan_method,
              p_token_hash text, p_participant_id uuid, p_tag_public_id text, p_tag_uid text,
              p_client_scan_id uuid, p_client_scanned_at timestamptz, p_confirm_repeat boolean default false)
  ```

  The SPEC §8 step order is preserved. v2 changes:

  | Step | v2 change |
  |---|---|
  | 4 resolve | `nfc`: find the tag → `NOT_FOUND` if unknown; tag from another event → `WRONG_EVENT` (no participant data); no active assignment → `TAG_REPLACED` (+ last holder, `retiredAt`) if retired, else `TAG_UNASSIGNED` (+ `tagId`, `tagLabel`) |
  | 9 serialize | Meals also lock the **participant** row (after the checkpoint lock, I-21) |
  | 10 already scanned | Replay check first (same `client_scan_id` → `ACCEPTED replayed`, or `CLIENT_ID_CONFLICT` for another staff member). Then: non-meal → `ALREADY_SCANNED` as before. Meal with live servings → **`REPEAT_SERVING`** (+ `servedCount`, `previous`) unless `p_confirm_repeat` or `seconds_open` |
  | 13 insert | `serving_no` = next number for meals, 1 otherwise. `ACCEPTED` now includes `servingNo` and `points` |

  `ScanCode` (`lib/domain/scan-codes.ts`) gains `REPEAT_SERVING`, `TAG_UNASSIGNED`, `TAG_REPLACED`: 15 codes total. T-SCAN-23 (set equality with the SQL source) must be updated in the same commit.
- `staff_stations(user_id, event_id, checkpoint_id)` + `set_staff_station(user, checkpoint)` → `SET | FORBIDDEN | CHECKPOINT_NOT_FOUND`. The scanner's checkpoint picker writes it. The badge page reads it, because the scanner (ADMIN origin) and the badge page an iPhone opens (ME origin) cannot share `localStorage`.

### 6.7 Outbox

- `kind ∈ {pass_issued, pass_reissued, profile_link, recap}`. Generated column `kind_group` = `'pass'` for the two pass kinds, else the kind.
- `outbox_one_inflight` becomes `UNIQUE (participant_id, kind_group) WHERE status IN ('pending','sending')`, so a pending pass email no longer blocks a profile-link or recap email.
- `ingest_sheet_row` and `enqueue_pass` are re-created **with only their `ON CONFLICT` target changed** to `(participant_id, kind_group)`. Diff them against the originals in review: nothing else may change. T-ING-04/24 and T-MAIL-11 must stay green.
- `request_profile_link(participant)` → `QUEUED | IN_FLIGHT | NOT_ELIGIBLE`.
- `enqueue_recaps(event, organizer)` → number queued (−1 = not an organizer): everyone eligible, not a test row, with a live door scan, who has no pending/sent recap. Safe to press twice.

### 6.8 Connections and leaderboards

- `connection_taps(event_id, from_participant_id, to_participant_id, via_tag_id, created_at)`, PK `(from, to)`, `from <> to`, composite same-event FKs. A pair is **mutual** when both directions exist. Mutual time = the later of the two taps.
- `record_connection(from_participant, tag_public_id)`:

  | Code | When |
  |---|---|
  | `PENDING` / `MUTUAL` | New tap; `MUTUAL` if the other person had already tapped back |
  | `ALREADY_PENDING` / `ALREADY_MUTUAL` | Repeat tap |
  | `SELF` | Their own badge |
  | `NOT_FOUND`, `WRONG_EVENT`, `TAG_UNASSIGNED`, `TAG_REPLACED` | Badge problems |
  | `NOT_CHECKED_IN` | A **participant** without a live door scan (stops pre-event farming with shared links). Staff badge holders are exempt. |
  | `NOT_ELIGIBLE` | Tapper withdrawn or deleted |

  A transaction-scoped advisory lock on the pair makes the reported status exact when two people tap each other at the same moment (one `PENDING`, one `MUTUAL`, verified 40/40).
- `my_connections(participant)` → `{ mutual: [{participantId, displayName, badgeRole, linkedinUrl|null, badgePublicId|null, mutualAt}], pendingOut }`, newest first. LinkedIn is omitted for hidden profiles.
- `points_as_of(event, as_of)` per badge holder: `activity` = sum of checkpoint points over live scans at or before `as_of`; `networking` = 1 per mutual connection (other side not deleted, not a test row) + the event's organizer bonus when the other side is an organizer (and the scorer isn't).
- `leaderboard(event, kind, as_of, limit)` → `rank, participant_id, display_name, points, reached_at`. Eligible: accepted, not deleted, not test, `badge_role = participant` (organizers only when `organizers_compete`). Zero scores omitted. Order: points desc, then **whoever reached the score first**, then name. `rank()` gives ties the same rank.

---

## 7. Flows

### F13 — Platform admin bootstrap
1. `pnpm admin:add ade@yourclub.ca` inserts into `platform_admins`.
2. The admin signs in on the ADMIN host (magic link). `/auth/callback` calls `consume_platform_admin` and `consume_staff_invites`.
3. `/admin` shows **all events** and a **New event** button (admins only).

### F14 — Create and configure an event
1. `/admin/new`: name, slug (auto-suggested from the name, editable), venue, start, end, timezone (default `America/Toronto`). Server validates with zod, then `create_event()`.
2. Redirect to `/admin/<slug>/checkpoints`, which now has **points** (non-meal), **capacity** (sessions/custom), **requires check-in**, and for meals the **Seconds open** switch.
3. `/admin/<slug>/settings`: leaderboard refresh, organizer bonus, organizers compete (Q1), badge unlock password, retention days (Q4), recap message (Q5).
4. `/admin/<slug>/staff`: invite organizers and volunteers by email (unchanged mechanism).
5. Connect the Google Sheet (unchanged; README).

### F15 — Organizer onboarding and badge profile
1. The invited organizer signs in from the email link; first time sets a display name (unchanged).
2. In the admin nav, **My badge profile** → `POST /api/staff/hop {slug}`:
   1. `ensure_staff_attendee(event, user)` → their badge row.
   2. Mint a code, `issue_signin_code(row, sha256(code), 'organizer_hop', user)`.
   3. Respond `{ url: ME_ORIGIN + '/signin#' + code }`; the browser navigates there.
3. `/signin` redeems the code (`POST /api/me/session/code`) → session cookie → `/me`. They fill in their profile and "Ask me about…" topics.
4. Their badge is linked like anyone's (door, or the Badges page).

### F16 — Acceptance email (changed)
The drainer handles `pass_issued`/`pass_reissued` as before (`issue_pass` commits before send, I-10) **and** generates an edit key: `issue_profile_key(participant, sha256(key))`, also committed before the send. The email gains a second button, **Set up your profile** → `${ME_ORIGIN}/edit#${key}` (§12.1).

### F17 — Opening the edit link
1. `/edit` is a static client page. It reads `location.hash`, immediately calls `history.replaceState(null, '', '/edit')` (so the key leaves the address bar and history), then `POST /api/me/session {key}`.
2. Server: rate-limit (30/min/IP), `open_profile_session(sha256(key), sha256(newSessionValue), ttl)`.
   - `OPENED` → set cookie, return `{ next: '/me' }`.
   - `KEY_REVOKED` → "This link was replaced. Use your newest email, or ask for a new link." + **Email me a link**.
   - `KEY_NOT_FOUND` / `NOT_ELIGIBLE` → generic "This link doesn't work" + **Email me a link**.
3. **In-app browser banner.** If the user agent looks like an embedded browser (Gmail, Outlook, Instagram, LinkedIn, Facebook…: `lib/participant/in-app-browser.ts`, pure, unit-tested on a UA fixture list), `/me` shows a persistent banner: *"Open this page in Safari/Chrome so your badge recognizes you"* with app-specific steps. The cookie lives in that embedded browser, not in the one a badge tap opens (A-SESS-2).

### F18 — Recovery
| Situation | Path | Notes |
|---|---|---|
| Own badge shows read-only | Badge page → **This is me** → `POST /api/t/<id>/this-is-me` → `request_profile_link(holder)` | Always answers "If this is your badge, we emailed you a link." The email goes only to the holder's address. Rate-limited 3/h per badge, 20/h per IP. |
| Lost the email, has the address | `/signin` → event + email → `POST /api/signin/request` | Same generic answer whether or not the email exists (no enumeration). 3/h per address, 20/h per IP. |
| Lost access to email | Staff opens their badge page or Participants row → **Show sign-in code** (`issue_signin_code(…,'staff_handoff')`) → a QR of `${ME_ORIGIN}/signin#<code>`, valid 2 minutes | The participant scans it with their camera. Staff are looking at them and their photo. |
| Link forwarded / leaked | `/me` → **Get a new link** → `rotate_profile_keys` + emails the new link | Signs out every device, including this one. Confirm dialog says so. |
| Sign out this device | `/me` → **Sign out** → `DELETE /api/me/session` | Other devices stay signed in. |

The `profile_link` email (§12.2) carries a **new** key (`issue_profile_key`), so it works even if older emails are lost.

### F19 — Registering badges (before the event)
**A. Register page on an Android phone** (`/admin/<slug>/badges/register`, organizers, Chrome on Android, HTTPS):
1. **Start** (user gesture) → `NDEFReader.scan()`.
2. On each `reading` event (`serialNumber`, `message`):
   1. If a record is a URL that parses as one of **our** tag URLs → `ALREADY_REGISTERED` toast with its label. Done.
   2. Else `POST /api/admin/<slug>/tags/reserve` → `{ publicId, label, url }` (server mints `publicId` from 9 random bytes; `register_tag(…, uid = null)`).
   3. `await ndef.write({ records: [{ recordType: 'url', data: url }] })` while the tag is still in the field.
   4. `POST …/tags/confirm { publicId, uid: normalizeUid(serialNumber) }` → `register_tag(…, uid)`.
   5. Green toast "B-0412 registered". Counter increments.
   - A write failure (tag moved, or already **password-protected**) shows "Hold the badge still and tap again". The reserved row stays unconfirmed (uid null) and is listed as "reserved, not written". The next tap reserves a new id; unconfirmed reservations older than 1 hour are hidden from counts.
3. Afterwards, set the **shared password** on each tag with NFC Tools (A-NFC-3). The app cannot set NTAG passwords through Web NFC.

**B. Vendor pre-encoded tags:** upload the vendor's CSV (`url` or `public_id`, `uid`, optional `label`) on `/admin/<slug>/badges` → `register_tag` per row → per-row report (`REGISTERED`, `UID_CONFLICT`…). The vendor writes `https://<ME_HOST>/t/<id>` with ids **we** generate and send them (`GET …/tags/export-ids?count=200` produces the list). Requires the final domain (A-DOM-1).

### F20 — Door: pass, then badge
**Android door station (fastest):**
1. Scanner on the Door checkpoint, camera mode. The QR pass decodes → `record_scan(…'qr'…)` → **ADMIT**.
2. If the response's participant has no active badge, the result screen switches to **"Tap a blank badge"** (Web NFC reading, 30 s timeout, **Skip** button). The server adds `hasBadge: boolean` and `badgeLabel` to door `ACCEPTED` responses.
3. On a tap → `POST /api/tags/assign { eventSlug, participantId, tagPublicId?, tagUid? }` → `assign_tag`.
   - `ASSIGNED` → green "**B-0412** linked to **Ada**". Back to camera.
   - `TAG_IN_USE` → red "That badge belongs to Sam: pick another".
   - `PARTICIPANT_HAS_TAG` → amber "Ada already has B-0012. **Replace it?** (old badge stops working)" → resend with `replace: true`.
   - `TAG_RETIRED` → red "This badge was deactivated: pick another".
4. **Undo link** (120 s, own links) → `unassign_tag`.

**iPhone door station:**
1. Scan the QR pass (camera) → ADMIT. The screen says "Now tap a blank badge on this phone".
2. Tapping the badge opens `/t/<id>` in Safari. The staff panel for an **unassigned** badge shows **Assign to Ada Lovelace (admitted by you 14 s ago)**: the most recent door `ACCEPTED` by this staff member in the last 2 minutes whose person has no badge. One tap → `assign_tag`. A search box covers everyone else.

**Walk-ins / no pass:** manual search or **Add walk-in** (unchanged) → door scan → assign a badge the same way.

### F21 — Checkpoint scanning with badges
- **Android:** scanner → **NFC** mode (§10.1). Each tap → `POST /api/scan { method: 'nfc', tagPublicId, tagUid, … }` → result screen. No extra button press.
- **iPhone:** tapping opens `/t/<id>`. The staff panel shows the staff member's **station** (from `staff_stations`) and a large **Check in to Lunch** button → `POST /api/scan` (I-17: never on GET). The result appears in the panel. Close the tab and tap the next badge.
- **Printed QR backup / laptop webcam:** the camera scanner accepts tag URLs (`parseScannedText` returns `{ kind: 'badge', publicId }`) → same request as NFC.
- **USB keyboard-wedge reader (later):** hidden input catches `<uid><Enter>` → `{ method: 'nfc', tagUid }` (§11.4).

### F22 — Meals and seconds
1. First serving → green **SERVE** (+ dietary notes).
2. Same person again → amber **SERVED 1× ALREADY · last 12:41 by Maya** with **Serve again** and **Don't serve**. **Serve again** re-submits with `confirmRepeat: true` and a **new** `clientScanId` → green **SERVE (2nd serving)**.
3. Organizer flips **Seconds open** (checkpoint page or dashboard) → repeats go straight to green, still numbered.
4. Undo a serving → `void_scan` (unchanged). The next serving gets a fresh number.

### F23 — Lost or broken badge
Staff, from the person's badge page (by search) or the Participants row, choose **Replace badge** → tap a new badge → `assign_tag(…, replace = true)`. The old badge is retired: scanning it shows red **OLD BADGE · replaced 12:41** with the person's name, and its badge page tells the public "This badge is no longer active".

### F24 — Networking
1. A signed-in participant taps another badge → `/t/<id>` → public profile + **Connect**.
2. `POST /api/me/connections { tagPublicId }` → `record_connection`.
   - `PENDING` → "Sent! It counts once Sam taps your badge too."
   - `MUTUAL` → "You're connected with Sam."
   - Others map to friendly text (§10.4).
3. `/me/connections`: mutual list (nickname, LinkedIn button, link to their badge page), plus "Waiting on N people to tap you back".
4. Not signed in → the button reads **Sign in to connect** → `/signin`.
5. Rate limit: 120 connect requests/h per participant.

### F25 — Leaderboards and the projector
- `lib/leaderboard/as-of.ts`: `leaderboardAsOf({ now, startsAt, refreshMinutes, frozenAt })`. Refresh 0 → `now`. Otherwise floor `now` to the refresh window counted from `startsAt` (UTC arithmetic, DST-safe). Then `min(that, frozenAt)` when frozen.
- `/admin/<slug>/screen` (staff session; open on the projector laptop): top 3 per board, the time of the next refresh, auto-reload when it passes. Large type, high contrast, no personal data beyond display names.
- `/me` shows the participant's own **live** activity and networking points and their rank as of the **projector's** as-of time (so the projector stays the suspenseful reveal).
- **Freeze** button (organizers) sets `leaderboard_frozen_at = now()`. Unfreeze is allowed and audited.

### F26 — After the event
1. Close checkpoints; freeze leaderboards; award prizes.
2. `/admin/<slug>/recap`: edit the message (placeholders §12.4), preview it for a sample attendee, then **Send recaps** (enabled only after `ends_at` and once a badge unlock password is set) → `enqueue_recaps`.
3. The retention job (existing `/api/retention`, extended in V8) runs daily. After `ends_at + profile_retention_days` it deletes profiles, connection taps, sign-in codes and sessions, and revokes edit keys (`retention`). Tags and anonymous aggregates remain. Badge pages then say "This badge was used at {event}". The existing photo and PII retention rules (SPEC §15) are unchanged.

---

## 8. The badge page `/t/[publicId]`

A **server component** on the ME host. It renders on `GET` and **never writes** (I-17). Every action on it is a `POST` from a button.

### 8.1 Resolving the viewer

```ts
type Viewer =
  | { kind: 'anonymous' }
  | { kind: 'participant'; participantId: string; eventId: string }      // valid pl_me cookie
  | { kind: 'staff'; userId: string; eventId: string; role: StaffRole;    // Supabase session + event_staff
      participantId?: string };                                          // their own badge row, if any
```

Resolution in `lib/badge/handlers.ts`: `tag_view(publicId)` → if the Supabase session belongs to staff **of the tag's event**, viewer = staff (a staff member of another event is just a participant/anonymous viewer here). Otherwise use the participant cookie. The pure function `badgeView(tagView, holder, profile, viewer, now)` in `lib/badge/view.ts` returns a discriminated union that the page renders. **All "who sees what" logic lives in that pure function** and is covered by the T-BADGE matrix tests.

### 8.2 What each viewer sees

| Badge state | Anonymous | Participant of the same event | Owner | Staff of the event |
|---|---|---|---|---|
| Unknown `publicId` | 404 "Not a Passline badge" | same | — | same |
| Registered, never linked | "This badge isn't activated yet." | same | — | **Assign panel**: "Assign to {last person you admitted, N s ago}" + search |
| Linked, profile public | Public profile + **Sign in to connect** | Public profile + **Connect** / connection status | Own profile + **Edit**, points, **Get a new link**, **Sign out** | **Staff panel** (below) + public profile |
| Linked, profile hidden (owner or staff) | Display name + "This profile is private" | same + **Connect** | Own profile + note "Only you can see this" | Staff panel + "Hidden by owner/staff" |
| Retired (replaced/damaged) | "This badge is no longer active." | same | "This badge was replaced; your new one is B-0412." | "Deactivated {time}. Current badge: B-0412 (Ada)." + link |
| After retention | "This badge was used at {event}." | same | same | same + "Profile deleted on {date}" |

The staff panel:
- **Header:** photo (signed URL, 300 s), full name, badge role, status, badge label.
- **Involvement:** door time; servings per meal (with times); workshops and activities; points; connection count. Read by one SQL function `holder_involvement(participant)` (add in V5; read-only, same grants).
- **Station action:** the current station from `staff_stations` with one big button, e.g. **Check in to Lunch** → `POST /api/scan` with `method: 'nfc'` and this badge. If the staff member has no station: a picker.
- **Actions:** Serve again (after `REPEAT_SERVING`), Undo my last scan (120 s), Replace badge, Resend pass, Show sign-in code, Hide profile (organizers), Unlink badge (organizers, or own link ≤ 120 s).

Staff tapping **their own** badge get both the owner view and the staff panel.

### 8.3 Public profile shape (I-19)

```ts
interface PublicProfile {
  displayName: string;            // nickname, else "First L."
  badgeRole: 'participant' | 'organizer' | 'mentor' | 'judge' | 'volunteer';
  label: 'Organizer' | 'Mentor' | 'Judge' | 'Volunteer' | null;
  pronouns?: string; program?: string; yearLabel?: string; bio?: string;
  links: { linkedin?: string; github?: string; website?: string };
  discord?: string;               // only when FEATURE_EXTRA_BADGE_ROLES (Q2)
  askMeAbout: string[];           // organizers/mentors only
  eventName: string;
}
```

Rendering rules:
- Every text field renders as text (React escaping). There is no HTML or Markdown in profiles.
- Links: `rel="noopener noreferrer nofollow ugc"`, `target="_blank"`. Only `https:` URLs pass the DB checks.
- Never call or preview a profile link server-side (no unfurling, no LinkedIn fetching: CLAUDE.md "must not do").

---

## 9. API contracts

All bodies: zod `.strict()`. Domain outcomes: HTTP 200 + `code`. HTTP errors only for transport, auth or validation (unchanged convention).

### 9.1 Changed: `POST /api/scan` (staff; ADMIN host, and ME host for the badge page)

```ts
// Request: exactly one identifier group
{ checkpointId: uuid, method: 'qr' | 'manual' | 'nfc',
  token?: string,                  // qr
  participantId?: uuid,            // manual
  tagPublicId?: string,            // nfc: from the tag URL or the printed QR  (^[A-Za-z0-9_-]{12}$)
  tagUid?: string,                 // nfc: chip serial, any common format; normalized server-side
  confirmRepeat?: boolean,         // meals: "Serve again"
  clientScanId: uuid, clientScannedAt: ISO8601 }

// 200 adds:
{ servingNo?: number, servedCount?: number, points?: number,
  hasBadge?: boolean, badgeLabel?: string | null,   // door ACCEPTED only (F20)
  tagId?: uuid, tagLabel?: string | null,           // TAG_UNASSIGNED
  retiredAt?: string }                              // TAG_REPLACED
```

A zod `superRefine` enforces which fields go with which method. `nfc` requires `tagPublicId` or `tagUid` (both allowed: `publicId` wins). Rate limits are unchanged (120/min per staff; `NOT_FOUND` spikes alert).

### 9.2 New endpoints

| Endpoint | Host | Auth | Body → result |
|---|---|---|---|
| `GET /api/admin/events` | ADMIN | staff | `list_events_for` |
| `POST /api/admin/events` | ADMIN | platform admin | `{slug,name,venue,startsAt,endsAt,timezone}` → `create_event` |
| `POST /api/admin/events/[id]/join` | ADMIN | platform admin | → `join_event_as_admin` |
| `PATCH /api/admin/[slug]/settings` | ADMIN | organizer | event settings columns (§6.2) |
| `POST /api/admin/[slug]/tags/reserve` | ADMIN | organizer | `{}` → `{publicId,label,url}` |
| `POST /api/admin/[slug]/tags/confirm` | ADMIN | organizer | `{publicId,uid}` → `register_tag` code |
| `POST /api/admin/[slug]/tags/import` | ADMIN | organizer | CSV (≤ 1 MB, ≤ 2,000 rows) → per-row codes |
| `GET /api/admin/[slug]/tags/export-ids?count=` | ADMIN | organizer | Reserves N ids → CSV of `url,public_id,label` for a vendor |
| `GET /api/admin/[slug]/tags` | ADMIN | organizer | Counts + list (label, state, holder) |
| `POST /api/tags/assign` | ADMIN + ME | staff | `{eventSlug,participantId,tagPublicId?,tagUid?,replace?}` → `assign_tag` |
| `POST /api/tags/unassign` | ADMIN + ME | staff | `{assignmentId}` → `unassign_tag` |
| `POST /api/stations` | ADMIN + ME | staff | `{checkpointId}` → `set_staff_station` |
| `POST /api/participants/[id]/signin-code` | ADMIN + ME | staff | → `{url, expiresAt}` (QR rendered client-side) |
| `POST /api/admin/[slug]/participants/[id]/hide-profile` | ADMIN + ME | organizer | `{hidden:boolean}` |
| `POST /api/staff/hop` | ADMIN | staff | `{slug}` → `{url}` (F15) |
| `POST /api/admin/[slug]/leaderboard/freeze` | ADMIN | organizer | `{frozen:boolean}` |
| `GET /api/admin/[slug]/leaderboard?kind=&limit=` | ADMIN | staff | rows as of `leaderboardAsOf()` + `nextRefreshAt` |
| `POST /api/admin/[slug]/recap/preview` | ADMIN | organizer | `{participantId?}` → rendered HTML + text |
| `POST /api/admin/[slug]/recap/send` | ADMIN | organizer | → `{queued}`; 409 before `ends_at` or with no unlock password |
| `POST /api/me/session` | ME | — (key) | `{key}` → `open_profile_session`; sets the cookie (F17) |
| `POST /api/me/session/code` | ME | — (code) | `{code}` → `redeem_signin_code` |
| `DELETE /api/me/session` | ME | participant | sign out this device |
| `POST /api/me/rotate` | ME | participant | → `rotate_profile_keys` + queue `profile_link`; clears cookie |
| `GET/PATCH /api/me/profile` | ME | participant | `lib/profile/schema.ts` |
| `POST /api/me/photo` | ME | participant | Same pipeline and limits as `/api/pass/photo` (locked after door check-in) |
| `GET /api/me/connections` | ME | participant | `my_connections` |
| `POST /api/me/connections` | ME | participant | `{tagPublicId}` → `record_connection` |
| `GET /api/me/points` | ME | participant | own live points + rank as of the projector time |
| `POST /api/t/[publicId]/this-is-me` | ME | — | always `{code:'SENT_IF_OWNER'}` |
| `POST /api/signin/request` | ME | — | `{eventSlug,email}` → always `{code:'SENT_IF_REGISTERED'}` |

Every ME-host `POST/PATCH/DELETE` checks `Origin === NEXT_PUBLIC_APP_ORIGIN` (CSRF defence with `SameSite=Lax`). Every staff endpoint on the ME host uses the same `requireStaffBySlug()` as on the ADMIN host.

### 9.3 New rate limits (Postgres `rate_limit_hit`)

| Key | Limit |
|---|---|
| `me-session:ip:<ip>` (edit-link and code redemption) | 30/min |
| `this-is-me:tag:<id>` / `:ip:<ip>` | 3/h / 20/h |
| `signin-request:email:<sha256(email)>` / `:ip:<ip>` | 3/h / 20/h |
| `connect:p:<participantId>` | 120/h |
| `badge-page:ip:<ip>` | 120/min (slows enumeration; ids have 72 bits anyway) |
| `tags-reserve:user:<id>` | 600/h |

---

## 10. User interface

### 10.1 Scanner (`/scan/[slug]`)

- **Mode switch** under the checkpoint banner: **Camera** | **NFC** | **Search**. NFC appears only when `'NDEFReader' in window`. Otherwise show "Tap badges with this phone's own NFC (opens the badge page)" help for iPhones.
- **NFC mode:**
  - **Start NFC** button (user activation required) → `NfcReader.start()`. A pulsing "Ready: tap a badge" state, and the screen stays awake (existing wake lock).
  - Readings: dedupe the same serial within 3 s (reuse `lib/scanner/dedupe.ts`). Pause while a result is shown, as in camera mode.
  - A tag without our URL → amber **"Not a Passline badge"**, no request (mirrors `MALFORMED`).
- **Door checkpoint** adds the badge step (F20). `NDEFReader.scan()` needs a user gesture to start, so Android door stations press **Start NFC** once at the start of the shift; reading then stays on alongside the camera. A badge tapped while no "Tap a blank badge" prompt is showing is scanned as a normal Door scan: a linked badge gives `ALREADY_SCANNED` (re-entry) or `ACCEPTED`; an unlinked one gives `TAG_UNASSIGNED` → "Scan their pass first".
- Changing the checkpoint also calls `POST /api/stations` (fire-and-forget; failure shows a small warning).

### 10.2 Result screen additions (append to SPEC §10.2)

| Code / state | Color | Headline | Buttons / dismiss |
|---|---|---|---|
| ACCEPTED meal, `servingNo > 1` | green ✓ | **SERVE (2nd serving)** + name + dietary notes | auto 2.5 s |
| ACCEPTED session/custom with `points > 0` | green ✓ | **RECORDED · +10 pts** + name | auto 2.5 s |
| ACCEPTED door, `hasBadge = false` | green ✓ → amber prompt | **ADMIT** then "Tap a blank badge" | Skip |
| REPEAT_SERVING | amber ⟳ | **SERVED 1× ALREADY** · last 12:41 by Maya + photo | **Serve again** / **Don't serve** |
| TAG_UNASSIGNED | amber ! | **BADGE NOT LINKED** (B-0005) | At the door: link flow. Elsewhere: "Send to the door". Tap. |
| TAG_REPLACED | red ✕ | **OLD BADGE** · replaced 12:41 · {name} | tap |
| NFC tag not ours (client) | amber ? | **Not a Passline badge** | auto 1.5 s |
| Assign `ASSIGNED` | green ✓ | **B-0412 linked to Ada** | auto 2 s, Undo 120 s |
| Assign `TAG_IN_USE` | red ✕ | **Badge belongs to {holder}**: pick another | tap |
| Assign `PARTICIPANT_HAS_TAG` | amber ! | **Ada already has B-0012** | **Replace it** / Cancel |
| Assign `TAG_RETIRED` | red ✕ | **Deactivated badge**: pick another | tap |

I-1 still holds: green only when the server returned `ACCEPTED` or `ASSIGNED`/`ALREADY_ASSIGNED`.

### 10.3 Admin

| Page | Contents |
|---|---|
| `/admin` | Events list (name, dates in event time zone, your role). Admins: all events, **New event**, **Join as organizer** on events they don't staff. After login with no `next`, staff land here. |
| Admin nav | **Event switcher** (dropdown of `list_events_for`), **My badge profile** (F15) |
| `/admin/new` | Create event form (F14) |
| `/admin/[slug]/checkpoints` | + Points (hidden for meals), Seconds open switch (meals), capacity, requires check-in |
| `/admin/[slug]/badges` | Counts: registered / linked / unlinked / retired / reserved-not-written. Table with label, state, holder, linked at/by. **Register on this phone** (Android), **Import CSV**, **Export ids for vendor**, **Print sheet** (§11.5). |
| `/admin/[slug]/participants` | + badge column, **Replace badge**, **Show sign-in code**, **Hide profile**, badge role filter |
| `/admin/[slug]/settings` | Leaderboard refresh, organizer bonus, organizers compete (Q1), unlock password (masked, reveal button), retention days (Q4) |
| `/admin/[slug]` dashboard | + meals as **first servings vs seconds**, badge stats, leaderboards (live), connections made, **Seconds open** toggles |
| `/admin/[slug]/screen` | Projector (F25) |
| `/admin/[slug]/recap` | Message editor with placeholders, preview, send (F26) |

### 10.4 Participant (ME host)

| Page | Contents |
|---|---|
| `/edit` | Spinner while the key is exchanged; error states (F17) |
| `/signin` | Two cards: **Email me a link** (event + email) and, when the URL has `#code`, automatic redemption |
| `/me` | Profile form (§6.3 fields, live validation), photo (staff-only notice: "Only organizers see this at check-in"), visibility switch, my badge label, **live points** + rank, **Get a new link**, **Sign out**, in-app-browser banner |
| `/me/connections` | Mutual list: display name, organizer label, LinkedIn button, "View badge" link; pending count |
| `/t/[publicId]` | Badge page (§8) |

Connection result copy:

| Code | Text |
|---|---|
| `PENDING` | "Sent! It counts once {name} taps your badge too." |
| `MUTUAL` | "You're connected with {name}." |
| `ALREADY_PENDING` | "Waiting for {name} to tap your badge." |
| `ALREADY_MUTUAL` | "You're already connected." |
| `SELF` | "That's your own badge." |
| `NOT_CHECKED_IN` | "Check in at the door first." |
| `TAG_UNASSIGNED` / `TAG_REPLACED` / `NOT_FOUND` / `WRONG_EVENT` | "This badge can't be connected." |

Design: mobile-first, one column, tap targets ≥ 44 px, works at 320 px width, colour never the only signal (CLAUDE.md). Load the `frontend-design` guidance for the participant pages: they are the public face of the club.

---

## 11. NFC technical notes

### 11.1 What a badge holds
One NDEF **URI record**: `https://<ME_HOST>/t/<publicId>`. Nothing else: no name, no event, no secret. With a URI record, iPhones (XS and newer) read the tag in the background and offer to open the URL; Android opens it in the default browser when no page is actively reading.

### 11.2 `lib/nfc/web-nfc.ts`

```ts
export interface NfcTap { uid: string | null; url: string | null }     // uid normalized, url = first URL record
export interface NfcReader {
  start(onTap: (tap: NfcTap) => void, onError: (e: NfcError) => void): Promise<void>;  // needs user activation
  stop(): void;
  write(url: string): Promise<void>;                                   // Register page only
}
export type NfcError = 'unsupported' | 'permission-denied' | 'not-readable' | 'write-failed' | 'aborted';
```

Implementation notes for the Web NFC version (Chrome on Android):
- `const ndef = new NDEFReader(); await ndef.scan({ signal })`. Use an `AbortController` for `stop()`.
- Listen to `reading` (`event.serialNumber`, `event.message.records`) and `readingerror` → `not-readable`.
- Decode URL records with `new TextDecoder().decode(record.data)` when `record.recordType === 'url'`.
- `write`: `await ndef.write({ records: [{ recordType: 'url', data: url }] })`. A password-protected tag rejects the write → `write-failed`.
- **Never call `makeReadOnly()`** (D5).
- Wrap all access in feature detection. Unit-test the parsing and normalization; e2e uses a fake `NfcReader` injected through a test hook (Playwright cannot emulate NFC).

### 11.3 Pure helpers (unit-tested)

- `parseTagUrl(raw, meOrigin)` → `{ ok: true, publicId } | { ok: false }`. Accept exactly `${meOrigin}/t/<12 chars>` with an optional trailing slash. Reject other origins, query strings, fragments, and other lengths. Never throws.
- `normalizeUid(raw)` → uppercase hex without separators, or `null`. Accepts `04:a2:3b:…` (Web NFC), `04A23B…`, `04-A2-3B`, and spaces. Rejects odd lengths and lengths outside 8–20 hex chars. Decimal and byte-reversed formats from USB readers are handled in V9 once a reader is chosen (§11.4).
- `parseScannedText` (existing) gains a second success shape: `{ ok: true, kind: 'badge', publicId }` for tag URLs, alongside `{ ok: true, kind: 'pass', token }`. T-TOK-02…05 keep passing; add T-NFC-04.

### 11.4 USB readers (later, V9 or after)
Buy one keyboard-emulation reader, tap a known tag, record exactly what it types (byte order, hex/decimal, separators, trailing Enter). Then add `parseWedgeInput(raw, format)` with that format as a setting, and a hidden focused input on the scanner page in **Reader** mode. The server lookup by `uid` already exists.

### 11.5 Printed QR backup (Q9)
`/admin/[slug]/badges/print` renders a print-ready page: per badge, a QR of its URL plus the label, sized for the badge stock. The camera scanner already accepts these (§11.3), which also makes **dev testing possible without NFC hardware**: `pnpm seed` writes `.seed/badges/<Event>-<label>.png` for 60 demo badges and links 20 of them.

---

## 12. Email

### 12.1 Pass email (changed)
After the existing "Open your pass" button, add a section: **"Set up your profile"**, a button linking to `${ME_ORIGIN}/edit#${key}`, and one line: *"This link is personal. Anyone with it can edit your profile."* The plain-text part includes the link. T-MAIL-07 gains the edit link. Tracking stays off: link rewriting would leak the fragment.

### 12.2 `profile_link` email (new)
Subject: `Your {Event} profile link`. Body: greeting, one button to the edit link (fresh key), "If you didn't ask for this, you can ignore it." The drainer issues the key (committed) before sending.

### 12.3 Drainer changes
`lib/email/drain.ts` branches on `kind`:

| Kind | Before send (each committed first, I-10) | Template |
|---|---|---|
| `pass_issued`, `pass_reissued` | `issue_pass` + `issue_profile_key` | pass (§12.1) |
| `profile_link` | `issue_profile_key` | profile link |
| `recap` | `issue_profile_key` (for the connections link) | recap |

The cancellation rule extends: cancel if the participant is not eligible (not accepted or deleted).

### 12.4 Recap email (Q5 default)
- Subject: `Thanks for coming to {Event}!`
- Body: the organizer's `recap_message` with placeholders `{nickname}`, `{first_name}`, `{event}`, `{workshops}`, `{activities}`, `{connections}`, `{activity_points}`, `{networking_points}`. Unknown placeholders are a validation error in the editor.
- A fixed **stats block**.
- **See your connections** → `${ME_ORIGIN}/edit#${key}` with `?next=/me/connections` handled after sign-in.
- **Unlock your badge:** the shared password and 3 steps for NFC Tools (A-NFC-3 decides the exact menu names).
- Default message: *"Thanks for coming to {event}, {nickname}! You attended {workshops} workshops and made {connections} connections. We can't wait to see you at our next event."*

---

## 13. Analytics additions

| Metric | Definition |
|---|---|
| Meal servings | Live scans at meal M; split into **first servings** (`serving_no = 1`) and **seconds** (> 1) |
| Seconds rate | seconds ÷ first servings, per meal |
| Badge coverage | checked-in people with an active badge ÷ checked in |
| Badges | registered / linked / retired / reserved-not-written |
| Connections | mutual pairs; average per checked-in participant; % with ≥ 1 |
| Points | distribution per board (for prize planning) |

All metrics keep the SPEC §13 exclusions: voided scans, test rows, deleted rows. CSV exports gain `servings.csv` (one row per serving) and `connections_summary.csv` (counts per person, **not** who met whom).

---

## 14. Security and privacy

| Threat | Mitigation | Tests |
|---|---|---|
| Someone taps a badge to check themselves in | No endpoint records anything without a staff session (I-16); GET never mutates (I-17) | T-BADGE-09, T-SEC2-01 |
| Badge URL copied or shared in a group chat | It only shows the public profile. Connections need the tapper to be checked in **and** both sides to tap. | T-CONN-09 |
| Enumerating badge ids | 72-bit random ids; per-IP rate limit on badge pages | T-NFC-01, T-SEC2-03 |
| Rewriting badges during the event | Shared NTAG password (D5) | T-DEV2 (manual) |
| Stolen/forwarded edit link | Owner's **Get a new link** revokes all keys and sessions; keys only in fragments | T-PROF-07, T-SEC2-04 |
| Session theft via XSS | Cookie is `HttpOnly`; profiles render as text; CSP unchanged | T-SEC2-05 |
| CSRF on participant actions | `SameSite=Lax` + `Origin` check on every ME-host mutation | T-SEC2-06 |
| Email/registration enumeration | "This is me" and "Email me a link" always answer the same | T-SESS-08 |
| Staff action from the wrong event | Every SQL function checks `event_staff` for the object's event; composite FKs | T-TAG-07, T-SCAN2-07 |
| Leaking private data on the badge page | `toPublicProfile()` is the only shape (I-19); a test asserts no email, photo, dietary or status keys in public responses | T-BADGE-02 |
| Leaderboard reveals who met whom | Only counts are public; connection lists are visible only to the two people involved | T-LB-08 |

**Privacy notice:** the Google Form's collection notice must add the public badge profile (opt-in fields, owner-controlled), networking connections (visible only to the two people), points on public leaderboards (by nickname), and the retention period (Q4). Update `docs/launch-checklist.md`.

---

## 15. Test catalog (v2)

Layers as in SPEC §14: **U** unit, **I** integration (real local Postgres), **E** Playwright, **M** manual. Test names start with the ID. Existing suites (T-SCAN, T-CONC, T-ING, T-MAIL, T-SEC…) **must stay green**; update only the call sites the new `record_scan` signature forces.

### 15.0 What "✓" means
✓ = the scenario was executed against the reference SQL on PostgreSQL 16, on top of the repo's seven real migrations, and produced the expected result. Concurrency rows (✓ in §15.11) used genuinely parallel connections. **A ✓ is not a Vitest test.** Every row still has to be written as an automated test, and it should pass on first run against the copied SQL.

### 15.1 Fixture extension (`tests/fixtures/standard.ts`)
Keep everything existing. Add to **E1**:
- checkpoint **G** (custom, no check-in, **5 points**);
- **W** gets **10 points**;
- **L** stays a meal (0 points by constraint);
- badges **T1…T8** registered (T1–T3 linked to A, B, Org; the rest blank);
- an organizer badge row **Org** for org1 via `ensure_staff_attendee`.

Add to **E2**: badge **T9**.

Add a helper `tapBadge(staff, checkpoint, tag, opts)` that calls `record_scan` with `method = 'nfc'`.

### 15.2 Events and admins — `T-EVT`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-EVT-01 | Non-admin calls `create_event` | `FORBIDDEN` ✓ | I |
| T-EVT-02 | Timezone `Mars/Olympus` | `INVALID_TIMEZONE` ✓ | I |
| T-EVT-03 | `ends_at ≤ starts_at` | `INVALID_DATES` ✓ | I |
| T-EVT-04 | Valid create | `CREATED`; exactly one Door, closed; creator is organizer ✓ | I |
| T-EVT-05 | Same slug again | `SLUG_TAKEN` ✓ | I |
| T-EVT-06 | `consume_platform_admin(user, ' Admin@Club.ca ')` | links `user_id` ✓ | I |
| T-EVT-07 | `list_events_for` admin vs volunteer with no events | all events vs none ✓ | I |
| T-EVT-08 | `join_event_as_admin` by admin / non-admin | `JOINED` + organizer row / `FORBIDDEN` | I |
| T-EVT-09 | Settings PATCH: refresh 45, bonus 101, password 3 chars | 400 each | I |
| T-EVT-10 | Volunteer opens `/admin/new`; non-admin `POST /api/admin/events` | 403 | I+E |
| T-EVT-11 | Event switcher | lists only `list_events_for` results | E |
| T-EVT-12 | Meal with points 5; Seconds open on a custom checkpoint | rejected by constraint ✓ | I |

### 15.3 Hosts — `T-HOST`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-HOST-01 | Origins equal (dev) | every route reachable | I |
| T-HOST-02 | Origins differ | ME-only paths 404 on ADMIN; staff paths 404 on ME | I |
| T-HOST-03 | ME-host POST with `Origin: https://evil.example` | 403, no DB writes | I |
| T-HOST-04 | Staff signs in on ADMIN, opens a badge URL on ME | staff panel shown (cookie domain works) | E (Chromium `--host-resolver-rules="MAP *.passline.test 127.0.0.1"`) |

### 15.4 Profiles and keys — `T-PROF`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-PROF-01 | Two pass emails → two keys; open with each | both `OPENED` ✓ | I |
| T-PROF-02 | First key for someone with a form LinkedIn | profile created with that LinkedIn ✓ | I |
| T-PROF-03 | `github_url = http://…`; `website_url = javascript:…`; topic `"  spaces  "`; 6 topics; valid set | 4 rejections, then accepted ✓ | I |
| T-PROF-04 | Same table of cases through `lib/profile/schema.ts` | identical accept/reject as the DB | U |
| T-PROF-05 | `PATCH /api/me/profile` without a session; with one | 401; only own profile changes (no id in the API) | I |
| T-PROF-06 | `POST /api/me/photo` after door check-in | 409 `PHOTO_LOCKED` | I |
| T-PROF-07 | Rotate | old keys `KEY_REVOKED`; every session signed out; new key `OPENED` ✓ | I |
| T-PROF-08 | Hidden profile | badge page shows name only; `my_connections` omits LinkedIn ✓ | U+I |
| T-PROF-09 | Owner `public` + staff hidden | hidden wins | U |

### 15.5 Sessions and sign-in — `T-SESS`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-SESS-01 | Unknown key | `KEY_NOT_FOUND` ✓ | I |
| T-SESS-02 | Sign out device A | A signed out, B still signed in ✓ | I |
| T-SESS-03 | Participant withdrawn in the Sheet | every session signed out; keys `NOT_ELIGIBLE` ✓ | I |
| T-SESS-04 | Session past `expires_at` | signed out ✓ | I |
| T-SESS-05 | Cookie attributes | `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`; `__Host-` + `Secure` on https | I |
| T-SESS-06 | `/edit#key` | `replaceState` removes the hash before the POST; server and proxy logs never contain the key | E |
| T-SESS-07 | Staff hand-off: other-event staff; redeem twice; expired | `FORBIDDEN`; `OPENED` then `CODE_INVALID`; `CODE_INVALID` ✓ | I |
| T-SESS-08 | "This is me" and "Email me a link" for registered vs unknown | byte-identical response bodies; same timing class | I |
| T-SESS-09 | `organizer_hop` code by someone else / by the owner | `FORBIDDEN` / `ISSUED` ✓ | I |
| T-SESS-10 | In-app browser UA fixtures (Gmail iOS, Outlook, Instagram, LinkedIn, Safari, Chrome) | detected / not detected per fixture | U |
| T-SESS-11 | 31 session attempts in a minute from one IP | 31st → 429 | I |

### 15.6 Badges — `T-TAG`, `T-NFC`, `T-BADGE`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-TAG-01 | Link, then link again | `ASSIGNED`, `ALREADY_ASSIGNED` ✓ | I |
| T-TAG-02 | Someone else's badge | `TAG_IN_USE` + holder name ✓ | I |
| T-TAG-03 | Second badge for the same person | `PARTICIPANT_HAS_TAG` + current label ✓ | I |
| T-TAG-04 | Badge from E2 at E1 | `TAG_WRONG_EVENT` ✓ | I |
| T-TAG-05 | Unknown badge | `TAG_NOT_FOUND` ✓ | I |
| T-TAG-06 | Waitlisted person | `NOT_ACCEPTED` ✓ | I |
| T-TAG-07 | vol3 (E2 staff) links at E1 | `FORBIDDEN` ✓ | I |
| T-TAG-08 | Link by chip serial only | `ASSIGNED` ✓ | I |
| T-TAG-09 | Replace: without flag; with flag; reuse old badge; scan old badge | `PARTICIPANT_HAS_TAG`; `ASSIGNED replaced=true`; `TAG_RETIRED`; `TAG_REPLACED` + name ✓ | I |
| T-TAG-10 | Unlink: other volunteer; own ≤ 120 s; own at 121 s; then relink badge | `FORBIDDEN`; `UNASSIGNED` ✓; `FORBIDDEN`; badge reusable ✓ | I |
| T-TAG-11 | `register_tag`: volunteer; reserve; reserve again; confirm; confirm again; another id with an already-used chip; different chip for a confirmed id; id owned by E2 | `FORBIDDEN`, `REGISTERED`, `ALREADY_REGISTERED`, `REGISTERED`, `ALREADY_REGISTERED`, `UID_CONFLICT`, `PUBLIC_ID_CONFLICT`, `PUBLIC_ID_CONFLICT` ✓ | I |
| T-TAG-12 | Raw insert linking an E2 badge to an E1 person | FK violation ✓ | I |
| T-TAG-13 | CSV import with good, duplicate and malformed rows; 2,001 rows | per-row codes; 400 | I |
| T-TAG-14 | `export-ids?count=200` | 200 unique reserved ids, CSV via `toCsv()` | I |
| T-NFC-01 | Mint 10,000 public ids | unique, 12 chars, `[A-Za-z0-9_-]` | U |
| T-NFC-02 | `parseTagUrl`: exact URL, trailing slash, other origin, `http:` in prod, query, fragment, 11/13 chars | ok/ok/fail… never throws | U |
| T-NFC-03 | `normalizeUid`: `04:a2:3b:4c:5d:6e:7f`, `04A23B4C5D6E7F`, `04-a2-…`, spaces, odd length, 22 hex | normalized or `null` | U |
| T-NFC-04 | `parseScannedText` with a pass URL, a badge URL, a bare token, junk | `pass`, `badge`, `pass`, `MALFORMED` | U |
| T-NFC-05 | Door flow with a fake `NfcReader` | ADMIT → "Tap a blank badge" → "B-0004 linked to …" | E |
| T-NFC-06 | Register page with a fake reader: success; write failure | reserve→write→confirm; reserved row stays unconfirmed | E |
| T-BADGE-01 | `badgeView` for every cell of §8.2 | matches the table | U |
| T-BADGE-02 | Deep key scan of every non-staff response | no `email`, `photo*`, `dietary*`, `status`, `scans` keys | U+I |
| T-BADGE-03 | E2 staff opens an E1 badge | treated as non-staff | I |
| T-BADGE-04 | Unlinked badge, staff who admitted someone 14 s ago (no badge yet) | suggestion names that person; none after 2 min or once linked | I |
| T-BADGE-05 | Retired badge per viewer | texts per §8.2 | U |
| T-BADGE-06 | After retention | "This badge was used at …" for everyone | U+I |
| T-BADGE-07 | Organizer taps own badge | owner view + staff panel | U |
| T-BADGE-08 | Station button | posts `record_scan` for the station; no station → picker | E |
| T-BADGE-09 | 50 GETs of a badge page (anonymous, participant, staff) | zero rows written anywhere (I-17) | I |

### 15.7 Badge scans and meals — `T-SCAN2`, `T-MEAL`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-SCAN2-01 | Badge at G (no check-in, 5 pts) | `ACCEPTED`, `points = 5` ✓ | I |
| T-SCAN2-02 | Same again | `ALREADY_SCANNED` ✓ | I |
| T-SCAN2-03 | Badge at L before the door | `NOT_CHECKED_IN` ✓ | I |
| T-SCAN2-04 | Badge by chip serial | same results as by URL ✓ | I |
| T-SCAN2-05 | Unlinked badge | `TAG_UNASSIGNED` + label ✓ | I |
| T-SCAN2-06 | E2 badge at E1 door | `WRONG_EVENT`, no participant object ✓ | I |
| T-SCAN2-07 | Unknown badge | `NOT_FOUND` ✓ | I |
| T-SCAN2-08 | Replaced badge; then new badge at a checkpoint the person already did | `TAG_REPLACED` + name; `ALREADY_SCANNED` ✓ | I |
| T-SCAN2-09 | QR regressions: rotated pass, E2 pass, waitlisted (manual), workshop full, already-beats-full | `REVOKED reissued`, `WRONG_EVENT`, `NOT_ACCEPTED`, `CAPACITY_REACHED`, `ALREADY_SCANNED` ✓ | I |
| T-SCAN2-10 | Walk-in with check-in (re-created `add_walk_in`) | `CREATED` + `ACCEPTED` ✓ | I |
| T-SCAN2-11 | Codes in the SQL source == `ScanCode` | 15 codes, equal ✓ | I |
| T-SCAN2-12 | Old 7-argument `record_scan` | does not exist ✓ | I |
| T-SCAN2-13 | Raw insert `method = 'nfc'` without `tag_id` | check violation ✓ | I |
| T-SCAN2-14 | Door `ACCEPTED` | includes `hasBadge`, `badgeLabel` | I |
| T-MEAL-01 | First serving | `ACCEPTED`, `servingNo 1`, dietary notes ✓ | I |
| T-MEAL-02 | Same person, no confirm | `REPEAT_SERVING`, `servedCount 1`, previous by name ✓ | I |
| T-MEAL-03 | Confirm | `ACCEPTED`, `servingNo 2` ✓ | I |
| T-MEAL-04 | Seconds open | straight `ACCEPTED`, numbered ✓ | I |
| T-MEAL-05 | Void serving 3, serve again | next is 4, never reused ✓ | I |
| T-MEAL-06 | `REPEAT_SERVING` screen | Serve again sends a **new** `clientScanId` + `confirmRepeat`; Don't serve sends nothing | E |
| T-MEAL-07 | Dashboard | first servings vs seconds match the golden fixture | I |

### 15.8 Networking — `T-CONN`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-CONN-01 | Participant without a door scan | `NOT_CHECKED_IN` ✓ | I |
| T-CONN-02 | Own badge | `SELF` ✓ | I |
| T-CONN-03 | Unlinked / replaced / E2 badge | `TAG_UNASSIGNED` / `TAG_REPLACED` / `WRONG_EVENT` ✓ | I |
| T-CONN-04 | A→B, A→B, B→A, B→A | `PENDING`, `ALREADY_PENDING`, `MUTUAL`, `ALREADY_MUTUAL` ✓ | I |
| T-CONN-05 | `my_connections` | mutual only, newest first, nickname fallback "First L.", pending count ✓ | I |
| T-CONN-06 | Organizer (no door scan) taps back | `MUTUAL` (staff exempt) ✓ | I |
| T-CONN-07 | 121 connects in an hour | 429 | I |
| T-CONN-08 | `/me/connections` without a session | 401 | I |
| T-CONN-09 | Anonymous viewer of a shared badge link | no Connect button; **Sign in to connect** | E |

### 15.9 Leaderboards — `T-LB`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-LB-01 | `leaderboardAsOf`: refresh 0; 60 at 10:59:59 and 11:00:00 with start 09:00; frozen before the bucket; event spanning the 2026-11-01 DST change | `now`; 10:00 and 11:00; the freeze; buckets in absolute UTC hours | U |
| T-LB-02 | Activity points | sum of checkpoint points ✓ | I |
| T-LB-03 | Networking with an organizer connection | 1 per mutual + 2 bonus ✓ | I |
| T-LB-04 | As of an hour ago | later taps excluded ✓ | I |
| T-LB-05 | Organizers compete off/on | excluded / included, no bonus between organizers ✓ | I |
| T-LB-06 | Test participant | excluded, and connections with them score 0 ✓ | I |
| T-LB-07 | Tie | same rank; earlier `reached_at` listed first ✓ | I |
| T-LB-08 | Leaderboard API | only rank, display name, points (no ids) | I |
| T-LB-09 | Projector | reloads at `nextRefreshAt` (fake clock) | E |
| T-LB-10 | Freeze, then more scans | board unchanged | I |

### 15.10 Outbox and recap — `T-OUT`, `T-RECAP`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-OUT-01 | Ingest accepted twice after the outbox migration | `PASS_QUEUED`, `UNCHANGED` ✓ | I |
| T-OUT-02 | `enqueue_pass` with a pass email pending | `IN_FLIGHT` ✓ | I |
| T-OUT-03 | `profile_link` with a pass email pending; again | `QUEUED`; `IN_FLIGHT` ✓ | I |
| T-OUT-04 | Existing T-ING-*, T-MAIL-* suites | green | I |
| T-OUT-05 | At provider-call time for a pass email | both the pass hash and the edit-key hash exist and are active (I-10 extended) | I |
| T-RECAP-01 | `enqueue_recaps` by a volunteer | −1 ✓ | I |
| T-RECAP-02 | By an organizer, twice | count = checked-in eligible non-test people; then 0 ✓ | I |
| T-RECAP-03 | Send before `ends_at`; without unlock password | 409 | I |
| T-RECAP-04 | Placeholders: all known; one unknown; HTML in the message | rendered; validation error; escaped | U |
| T-RECAP-05 | Recap email | fresh edit link with `next=/me/connections`, unlock password, NFC Tools steps | I |

### 15.11 Concurrency — `T-CONC2` (parallel connections, as CLAUDE.md requires)
| ID | Scenario | Expected |
|---|---|---|
| T-CONC2-01 | 20 parallel first taps, same person, same meal, no confirm | 1 `ACCEPTED`, 19 `REPEAT_SERVING` ✓ |
| T-CONC2-02 | 10 parallel confirmed repeats | 10 distinct consecutive serving numbers ✓ |
| T-CONC2-03 | 20 parallel retries of one confirmed repeat (same `clientScanId`) | 1 row; 1 `ACCEPTED`, 19 `replayed` ✓ |
| T-CONC2-04 | One blank badge linked to 10 people at once | 1 `ASSIGNED`, 9 `TAG_IN_USE` ✓ |
| T-CONC2-05 | 10 badges linked to one person at once | 1 `ASSIGNED`, 9 `PARTICIPANT_HAS_TAG` ✓ |
| T-CONC2-06 | 9 parallel replacements for one person | exactly 1 active badge ✓ |
| T-CONC2-07 | One sign-in code redeemed 10× at once | 1 `OPENED`, 9 `CODE_INVALID` ✓ |
| T-CONC2-08 | Two people tap each other at the same moment, 40 rounds | every round: one `MUTUAL`, one `PENDING` ✓ |
| T-CONC2-09 | T-CONC-01/02/03 with the new signature | 1/49; 20 `ACCEPTED`, 1 row; 10/20 ✓ |
| T-CONC2-10 | Nightly loop | add 01, 03, 04, 08 to the 100× nightly job (flake = bug) |

### 15.12 Security — `T-SEC2`
| ID | Scenario | Expected | L |
|---|---|---|---|
| T-SEC2-01 | Enumerate every route file; call unauthenticated | 401/403, except the listed public ME endpoints | I |
| T-SEC2-02 | Catalog checks on the v2 schema | 0 tables without RLS; no function executable by anon/authenticated/PUBLIC; every SECURITY DEFINER has `search_path=public, pg_temp` ✓ | I |
| T-SEC2-03 | 121 badge-page GETs/min from one IP | 429 | I |
| T-SEC2-04 | Full v2 e2e flow, then grep logs, `audit_log`, every text column, access-log paths | no edit key, session value, sign-in code or pass token anywhere (extends T-TOK-07, T-SEC-05) | I+E |
| T-SEC2-05 | Profile fields `<img src=x onerror=alert(1)>`, `"><script>` | rendered as text everywhere (badge page, connections, leaderboard, admin) | E |
| T-SEC2-06 | ME-host mutation with a foreign `Origin` | 403 | I |
| T-SEC2-07 | Retention v2 at `ends_at + days`, run twice | profiles, connections, codes, sessions gone; keys revoked; tags kept; idempotent | I |

### 15.13 Devices and venue — `T-DEV2` (manual, with the real badges; record time-to-result)
Phones: two Android models (one cheap) in Chrome; iPhone current iOS and one back.

| Check | Pass |
|---|---|
| Android NFC mode, 20 taps in a row | ≥ 95 % under 1.5 s, no double records |
| iPhone background read | banner appears, opens the badge page |
| Through the badge holder; on a lanyard; near a metal table; through a phone case | reads (note any failure) |
| Register page: 20 blank tags | all registered, labels sequential |
| Shared password set in NFC Tools | Register page write now fails; reading still works |
| Password removed with the shared password | rewritable again (recap instructions are correct) |
| Printed QR backup with the camera scanner | scans as the badge |
| Screen off / phone locked mid-shift | reading resumes after unlock with no lost taps beyond the locked period |
| Wi-Fi off, cellular on | works; airplane mode → OFFLINE banner, never green |

### 15.14 Performance — `T-PERF2`
| ID | Scenario | Expected |
|---|---|---|
| T-PERF2-01 | 5 Android scanners + 2 iPhones, 300 badge taps in 10 min against a preview deployment | `/api/scan` p95 < 700 ms, 0 errors |
| T-PERF2-02 | 500 people, 3,000 scans, 5,000 connection taps | `leaderboard()` < 200 ms; `my_connections()` < 50 ms |

---

## 16. Build slices

Each slice: plan mode → failing tests → code → `pnpm check` green → demo → commit `V<n>: …`. Update `SPEC.md` (new sections + changelog) at the end of each slice.

| Slice | Scope | Migrations | Exit tests | Demo |
|---|---|---|---|---|
| **V0** Foundations (½ day) | Apply Appendix A (Apps Script fixes missing from the repo). `FEATURE_*` flags in `lib/env.ts`. Add I-16…I-23 and the §21 gotchas to `CLAUDE.md`. Copy `docs/v2/reference-sql/`. Fixture skeleton (§15.1). | — | existing suite green | — |
| **V1** Admins and events | `platform_admins`, `pnpm admin:add`, callback linking, `/admin` events list, event switcher, `/admin/new`, join as organizer, settings page (fields that exist so far), checkpoint form gains points + Seconds open **UI only after V5**. Retire `pnpm event:create` (keep it working, print a deprecation note). | 02 | T-EVT-01…11 | Admin creates an event in the browser, invites an organizer |
| **V2** Hosts and participant sessions | Host config + proxy filtering + cookie domain; participant cookie helpers; edit keys in pass emails; `/edit`, `/signin`, minimal `/me`; profile-link email; rotation; "Email me a link"; sign-in codes (staff hand-off from the Participants page); in-app browser banner. Outbox migration. | 03, 06 | T-HOST-*, T-SESS-*, T-PROF-01/02/07, T-OUT-*, T-SEC2-04 (partial), T-SEC2-06 | Accept a row in the Sheet → email has both buttons → profile link signs in; Get a new link signs out |
| **V3** Profiles | Full `/me` form (zod mirror), photo via session, visibility, staff hide, `toPublicProfile()`, organizer hop + badge row, Ask me about…, `FEATURE_EXTRA_BADGE_ROLES` scaffolding (hidden) | (03) | T-PROF-*, T-BADGE-02 (profile part), T-SEC2-05 | Organizer hops to their own profile, sets topics |
| **V4** Badges | `tags`/`tag_assignments`; Badges page (counts, list, CSV import, export ids, print sheet); Register page with the `NfcReader` abstraction; `/t/[publicId]` with the full viewer matrix; assign / replace / unlink (scanner door step + badge-page assign panel with last-admitted suggestion); stations; `pnpm seed` creates 60 badges, links 20, writes badge QR PNGs | 04, (05: `staff_stations` part may be split out here) | T-TAG-*, T-NFC-01…06, T-BADGE-01…07, T-BADGE-09, T-CONC2-04…06, T-SEC2-03 | Laptop: scan a pass, then a printed badge QR → linked. Android: register 5 real tags, link at the door, open a badge as anonymous / owner / staff |
| **V5** Badge scans and meals | `scan_method 'nfc'`, new `record_scan`, scanner NFC mode, result screens (§10.2), Serve again, Seconds open (UI + dashboard toggle), checkpoint points UI, badge-page station action, `holder_involvement()`, meal analytics, `servings.csv` | 01, 05 | T-SCAN2-*, T-MEAL-*, T-BADGE-08, T-CONC2-01…03, T-CONC2-09, all existing T-SCAN/T-CONC | Lunch line: tap, tap again → warning, Serve again, Seconds open |
| **V6** Networking | `record_connection`, Connect on badge page, `/me/connections`, rate limits, connection counts on dashboard and staff panel | 07 (connections part) | T-CONN-*, T-CONC2-07/08 | Two phones connect; list shows nickname + LinkedIn |
| **V7** Leaderboards | `points_as_of`, `leaderboard`, `leaderboardAsOf`, projector screen, own points on `/me`, freeze, settings for refresh/bonus/compete | 07 (rest) | T-LB-*, T-PERF2-02 | Projector shows top 3, refreshes on the hour |
| **V8** Recap and retention | Recap editor, preview, send, template, unlock password; retention v2 | — | T-RECAP-*, T-SEC2-07 | Send recaps to the dry-run group |
| **V9** Hardening and event readiness | Remaining T-SEC2, T-DEV2 with real badges, T-PERF2-01 on a preview deployment, runbook updates (§20), launch checklist updates, privacy notice | — | everything | Dry run with ~10 club members |
| **Later (?)** | Hunt (§18.1), shifts (§18.2), mentor directory (§18.3), USB reader (§11.4) | as designed | their own tests | — |

**Critical path:** V1 → V2 → V4 → V5 are needed for an event with badges. V6–V8 can follow. **Domain + hosting** must be decided before **writing final URLs on real badges** (A-DOM-1): until then, register only a few test tags against a dev/preview URL. They can be rewritten, because they are not password-protected yet.

---

## 17. Assumptions to verify

| # | Assumption | How to check | If false |
|---|---|---|---|
| A-NFC-1 | Chrome on the team's Android phones supports Web NFC reading **and** writing on HTTPS pages | T-DEV2 with Yves's tags, on a preview URL | Register with NFC Tools (writes the URL list we export); scanning falls back to tap-opens-page |
| A-NFC-2 | iPhones read our URL badges in the background and offer to open them | T-DEV2 | Print the QR backup on every badge (Q9) |
| A-NFC-3 | NFC Tools can set and remove an NTAG21x password; exact menu names for the recap instructions | T-DEV2 | Use NFC Tools Pro or vendor pre-protection; adjust recap text |
| A-NFC-4 | A password-protected tag still reads normally on both platforms | T-DEV2 | Ship without passwords (accept the rewrite risk) |
| A-NFC-5 | Web NFC `serialNumber` is available on the chosen tags (`04:…`, 7 bytes) | Register page dev log | Fall back to `public_id` only (uid stays null) |
| A-NFC-6 | Tags read through the badge holder and lanyard materials we buy | T-DEV2 | Change holder or tag size |
| A-NFC-7 | Yves's NFC device (Q10) doesn't need its own flow | Ask Yves | Design an extra connection path (e.g. a `record_connection` variant fed by the device) |
| A-HOST-1 | Supabase SSR honours `cookieOptions.domain` so staff sessions are visible on the ME host | T-HOST-04 | Staff iPhones use an "Open in staff view" link on the badge page that hops via a sign-in-style code to the ADMIN host |
| A-HOST-2 | Next 16 `proxy.ts` can filter by `Host` before the session refresh | Read `node_modules/next/dist/docs` | Do the host check in a root layout/route-group guard |
| A-SESS-1 | Safari keeps server-set `HttpOnly` cookies for 30 days (ITP only caps script-written storage) | Manual on iOS: sign in, wait > 7 days, tap badge | Shorter TTL + clearer "Email me a link" path |
| A-SESS-2 | Embedded browsers (Gmail/Outlook in-app, SFSafariViewController) don't share cookies with Safari/Chrome | Manual | Banner text stays as designed |
| A-DOM-1 | The final domain is chosen and auto-renews before any badge is written and protected | Organizers | **Do not write or protect final badges** |
| A-MAIL-1 | Pass email with two buttons stays under the Gmail clipping size | T-MAIL-09 | Trim template |

---

## 18. Optional features (designs for the `(?)` items)

### 18.1 Scavenger hunt (Q7, `FEATURE_HUNT`)
- `hunt_items(id, event_id, label, tier ∈ {easy, medium, hard}, points, code_hash UNIQUE, active, created_by)`, `hunt_finds(participant_id, item_id, found_at, PK(participant_id, item_id))`, composite same-event FKs.
- Two ways in: a hidden QR of `${ME_ORIGIN}/h#<code>` (fragment, I-18), or a typed 8-character code (Crockford base32: no 0/O/1/I/L ambiguity) on `/me/hunt`.
- `record_find(participant, code_hash)` → `FOUND (+points) | ALREADY_FOUND | NOT_FOUND | NOT_CHECKED_IN | INACTIVE`. Participant session required. Rate limit 30 attempts/10 min per participant (guessing).
- Points count toward **activity** by default, or a separate **hunt** board (team decides; `points_as_of` gains a third column).
- Sharing risk: a photographed code can be posted. Mitigations to choose from: accept it for easy items; rotate codes hourly for hard items; or require a staff tap for hard items (they become checkpoints).

### 18.2 Staff shifts (Q8, `FEATURE_SHIFTS`)
- `staff_shifts(id, event_id, user_id, checkpoint_id, starts_at, ends_at)`.
- The scanner preselects the checkpoint of the current shift and writes it to `staff_stations`. A "My shifts" card on `/scan/[slug]`.
- `events.restrict_to_shifts` (default false): when true, `record_scan` gets a new step after 3, `OUTSIDE_SHIFT` (organizers exempt). That adds a scan code, so update T-SCAN2-11.

### 18.3 Mentors, judges, volunteers with badges (Q2, `FEATURE_EXTRA_BADGE_ROLES`)
- Organizers add badge holders directly (name, email, role) on the Participants page → `participants` row with `source = 'staff'`, `badge_role` set, then `request_profile_link` emails their edit link.
- Labels on the badge page; `ask_me_about` and `discord_handle` editable for mentors.
- **Mentor directory** `/mentors/[slug]` on the ME host for signed-in participants of the event: name, topics, Discord handle, filter by topic. Never public.

### 18.4 Printed QR backup (Q9)
Built in V4 (§11.5); organizers decide whether to print.

### 18.5 Repeatable activities (Q6)
If a game should count every time: add `checkpoints.repeatable boolean` and treat it like meals in `record_scan` step 9–13 (participant lock, numbered rows) **without** the warning, and with points per row. Not built until decided.

---

## 19. Environment variables (additions)

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_APP_ORIGIN` | client+server | **Now the ME origin.** QR payloads, tag URLs, edit links. Changing it after badges are written breaks every badge (A-DOM-1). |
| `NEXT_PUBLIC_ADMIN_ORIGIN` | client+server | Staff origin. Equal to the ME origin in dev. |
| `AUTH_COOKIE_DOMAIN` | server + browser client | `.yourclub.ca` in prod; empty in dev |
| `PARTICIPANT_SESSION_DAYS` | server | default 30 |
| `FEATURE_EXTRA_BADGE_ROLES`, `FEATURE_HUNT`, `FEATURE_SHIFTS` | server | default `false` |

Add them to `.env.example`, `lib/env.ts` (zod) and SPEC §19.

---

## 20. Event-day runbook changes (merge into SPEC §16)

**T − 14 days:** domain decided and auto-renew on (A-DOM-1); badges ordered (+20 % spare); badge holders tested with the tags (A-NFC-6).

**T − 7 days:** register all badges (Register page or vendor CSV); set the **shared password** on every badge; spot-check 10 with T-DEV2; print QR backups if chosen; dry run with ~10 members includes badges, meals with seconds, networking and the projector.

**T − 1 day:** stations' phones: Android at **door, meals and workshops**; each volunteer signs in once on the ADMIN host **and** opens one badge page on the ME host (proves the shared cookie); charge everything; spare unregistered badges at the door for replacements (register them on the spot).

**During:**

| Situation | Action |
|---|---|
| Badge won't read | Try the printed QR; otherwise manual search → record scan |
| `TAG_UNASSIGNED` at a checkpoint | Send them to the door to link a badge |
| `TAG_REPLACED` | They have a newer badge; ask for it. Lost both? Door → Replace badge |
| Lost badge | Door → Replace badge with a spare |
| "My badge shows read-only" | Badge page → **This is me** → open the email link in the phone's normal browser |
| Lunch line rush | Turn on **Seconds open** only after everyone has had a first serving |
| Leaderboard dispute | Organizers check the person's involvement on their badge page; void wrong scans with a reason |

**After:** freeze boards → prizes → **Send recaps** (needs the unlock password set) → exports. Retention runs automatically after Q4's period.

---

## 21. `CLAUDE.md` additions (V0)

- **Invariants:** add I-16…I-23 (§4).
- **Commands:** `pnpm admin:add <email>`; `pnpm seed` now also creates badges (`.seed/badges/*.png`).
- **Repo map:** `lib/badge`, `lib/nfc`, `lib/participant`, `lib/profile`, `lib/connections`, `lib/leaderboard`, `lib/events`, `lib/tags`, `lib/recap`; `app/(me)/…`.
- **Gotchas:**
  - A new enum value (`alter type … add value`) must be in its **own migration**: it can't be used in the transaction that adds it.
  - `ON CONFLICT` on the outbox now targets `(participant_id, kind_group)` with the `status in ('pending','sending')` predicate repeated.
  - Lock order checkpoint → participant → tag (I-21).
  - Meals use `serving_no`; every other kind writes `serving_no = 1`. Never write a meal row without the participant lock.
  - Web NFC needs HTTPS, Chrome on Android, and a user gesture to start `scan()`; there is no Web NFC on iOS. Never call `makeReadOnly()`.
  - Cookies don't cross origins: the scanner (ADMIN) and badge pages (ME) share only the Supabase cookie (parent domain) and server-side `staff_stations`, not `localStorage`.
  - The edit-link page must strip the fragment with `history.replaceState` before doing anything else.
  - Opening a badge page must never write (link previews, prefetch, OS NFC handlers).
  - Playwright can't emulate NFC: inject the fake `NfcReader`; use the printed-QR path for camera e2e.

---

## Appendix A — Apps Script fixes not yet in the repo

The repo's `apps-script/` is behind what's running in the club's Sheet. Apply in V0:

1. `Setup.gs` → `updateEndpoint()` copies **all three** settings:
   ```javascript
   function updateEndpoint() {
     requireConfig_();
     PropertiesService.getScriptProperties().setProperties({
       ENDPOINT: CONFIG.ENDPOINT, EVENT_SLUG: CONFIG.EVENT_SLUG, INGEST_SECRET: CONFIG.INGEST_SECRET,
     });
     Logger.log('Now using ' + CONFIG.ENDPOINT + ' for event ' + CONFIG.EVENT_SLUG + '.');
   }
   ```
2. `Setup.gs` → add `showEndpoint()` (logs the stored `ENDPOINT` and `EVENT_SLUG`) and `requireConfig_()` (the placeholder/secret-length check, used by `setupTestForm`, `connectExistingSheet` and `updateEndpoint`).
3. `Setup.gs` → `CONFIG.ENDPOINT` placeholder becomes `https://YOUR-TUNNEL.trycloudflare.com/api/ingest/sheet`. **Never commit real values.**
4. `Code.gs` → the `catch` branch appends a timestamp: `['ERROR ' + String(err).slice(0, 80) + ' ' + new Date().toISOString()]`. Mirror it in SPEC Appendix A.

The README already documents this behaviour.

---

## Appendix B — Reference SQL verification log (2026-10-08)

Environment: PostgreSQL 16, Supabase-like stubs (`auth.users`, `extensions` schema with `pgcrypto` and `pg_trgm`, `storage.buckets`, roles `anon`/`authenticated`/`service_role`), the seven repo migrations at `ff241f9`, then the v2 files.

| Check | Result |
|---|---|
| Repo migrations on the stub | apply cleanly |
| v2 files in numeric order 01→07, fresh database | apply cleanly |
| v2 files in slice order 02, 03, 06, 04, 01, 05, 07 | apply cleanly |
| Scenarios marked ✓ in §15 | all expected results |
| Parallel checks (§15.11) | all expected results (meal first-tap race 1/19; servings 2…11 unique; replay 1 row; badge races 1/9; sign-in code 1/9; mutual taps 40/40 exact; original T-CONC-01/02/03 unchanged) |
| Catalog | 0 tables without RLS; 0 functions executable by `anon`/`authenticated`; every SECURITY DEFINER pinned to `search_path=public, pg_temp`; old 7-arg `record_scan` absent |
| Not exercised | `holder_involvement` (not written yet), retention v2, anything in TypeScript |

---

## Appendix C — First prompts for Claude Code

1. *"Read CLAUDE.md, PLAN.md and docs/v2/reference-sql. Plan slice V0 only: list the CLAUDE.md edits, the Apps Script changes from Appendix A, the env flags and the fixture skeleton. Don't write code until I approve."*
2. *"Plan slice V1. Copy 02_v2_admin_events.sql into a new migration. List the tests T-EVT-01…11 you'll write first and the pages/routes you'll add. Flag anything in PLAN.md that disagrees with the code."*
3. For every later slice: *"Plan slice V<n> from PLAN.md §16. Start with the failing tests listed in its exit criteria. Tell me which reference SQL you're copying, and any behaviour you want to change and why."*

