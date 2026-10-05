-- SocietyOne Phase 1 core schema
-- Hierarchy: Platform -> Society -> Tower -> Floor -> Flat -> Resident
-- Every operational table carries society_id (tenant key) and is indexed on it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name      text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  mobile         varchar(13) UNIQUE CHECK (mobile ~ '^\+91[6-9][0-9]{9}$'),
  email          citext UNIQUE,
  password_hash  text,
  platform_role  text CHECK (platform_role IN ('super_admin')),
  photo_key      text,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (mobile IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX users_name_trgm ON users USING gin (full_name gin_trgm_ops);
CREATE INDEX users_mobile_trgm ON users USING gin (mobile gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE societies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  code              varchar(12) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{2,12}$'),
  address_line1     text,
  address_line2     text,
  city              text NOT NULL,
  state             text NOT NULL,
  pin_code          varchar(6) CHECK (pin_code ~ '^[1-9][0-9]{5}$'),
  contact_phone     varchar(13),
  contact_email     citext,
  logo_key          text,
  timezone          text NOT NULL DEFAULT 'Asia/Kolkata',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
  complaint_prefix  varchar(8) NOT NULL DEFAULT 'SOC',
  settings          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL
);

-- Subscription/status tracking. Billing itself (SocietyOne Pay) is out of Phase 1 scope.
CREATE TABLE society_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  plan        text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','standard','premium')),
  status      text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','past_due','cancelled')),
  starts_on   date NOT NULL DEFAULT current_date,
  ends_on     date,
  max_flats   integer,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX society_subscriptions_society ON society_subscriptions(society_id);

-- Membership of a user within a society, with a society-scoped role.
CREATE TABLE society_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin','facility_manager','resident','guard')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (society_id, user_id, role)
);
CREATE INDEX society_users_user ON society_users(user_id);
CREATE INDEX society_users_society_role ON society_users(society_id, role);

-- Atomic per-society counters (complaint numbers etc.)
CREATE TABLE society_counters (
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (society_id, key)
);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
CREATE TABLE towers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name          text NOT NULL,
  code          varchar(8) NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (society_id, name),
  UNIQUE (society_id, code),
  UNIQUE (id, society_id)
);

CREATE TABLE floors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  tower_id      uuid NOT NULL,
  floor_number  integer NOT NULL CHECK (floor_number BETWEEN -5 AND 200),
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tower_id, society_id) REFERENCES towers(id, society_id) ON DELETE CASCADE,
  UNIQUE (tower_id, floor_number),
  UNIQUE (id, society_id)
);

CREATE TABLE flats (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id         uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  tower_id           uuid NOT NULL,
  floor_id           uuid NOT NULL,
  number             varchar(20) NOT NULL,      -- display number e.g. A-1204
  unit_code          varchar(10) NOT NULL,      -- 1204
  flat_type          varchar(20),
  area_sqft          integer,
  occupancy_status   text NOT NULL DEFAULT 'vacant' CHECK (occupancy_status IN ('vacant','owner_occupied','tenant_occupied')),
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (tower_id, society_id) REFERENCES towers(id, society_id) ON DELETE CASCADE,
  FOREIGN KEY (floor_id, society_id) REFERENCES floors(id, society_id) ON DELETE CASCADE,
  UNIQUE (society_id, number),
  UNIQUE (id, society_id)
);
CREATE INDEX flats_tower ON flats(tower_id);
CREATE INDEX flats_number_trgm ON flats USING gin (number gin_trgm_ops);

CREATE TABLE gates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (society_id, name),
  UNIQUE (id, society_id)
);

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------
CREATE TABLE residents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','moved_out')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (society_id, user_id),
  UNIQUE (id, society_id)
);

CREATE TABLE resident_flat_relationships (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id     uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  resident_id    uuid NOT NULL,
  flat_id        uuid NOT NULL,
  relation       text NOT NULL CHECK (relation IN ('owner','tenant','family_member')),
  is_primary     boolean NOT NULL DEFAULT false,
  move_in_date   date,
  move_out_date  date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (resident_id, society_id) REFERENCES residents(id, society_id) ON DELETE CASCADE,
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX rfr_active_unique ON resident_flat_relationships(resident_id, flat_id) WHERE status = 'active';
CREATE INDEX rfr_flat ON resident_flat_relationships(flat_id) WHERE status = 'active';

CREATE TABLE security_guards (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id       uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  employee_code    varchar(30),
  agency_name      text,
  shift            text NOT NULL DEFAULT 'day' CHECK (shift IN ('day','night','rotational')),
  default_gate_id  uuid,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (default_gate_id, society_id) REFERENCES gates(id, society_id),
  UNIQUE (society_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Visitors
-- ---------------------------------------------------------------------------
CREATE TABLE visitors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  mobile      varchar(13),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (id, society_id)
);
CREATE INDEX visitors_society_mobile ON visitors(society_id, mobile);
CREATE INDEX visitors_name_trgm ON visitors USING gin (full_name gin_trgm_ops);

CREATE TABLE visitor_invites (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id         uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  flat_id            uuid NOT NULL,
  visitor_id         uuid NOT NULL,
  invited_by         uuid NOT NULL REFERENCES users(id),
  pass_code          varchar(12) NOT NULL,     -- VIS-847251
  otp_code           char(6) NOT NULL,
  visit_type         text NOT NULL DEFAULT 'one_time' CHECK (visit_type IN ('one_time','recurring')),
  purpose            text NOT NULL,
  guest_count        smallint NOT NULL DEFAULT 1 CHECK (guest_count BETWEEN 1 AND 50),
  vehicle_number     varchar(15),
  notes              text,
  valid_from         date NOT NULL,
  valid_until        date NOT NULL,
  window_start       time NOT NULL,
  window_end         time NOT NULL,
  expected_arrival   time,
  recurrence_days    smallint[],               -- 0=Sun..6=Sat for recurring passes
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','checked_in','completed','cancelled','expired')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id),
  FOREIGN KEY (visitor_id, society_id) REFERENCES visitors(id, society_id),
  CHECK (valid_until >= valid_from),
  UNIQUE (society_id, pass_code),
  UNIQUE (id, society_id)
);
CREATE UNIQUE INDEX visitor_invites_live_otp ON visitor_invites(society_id, otp_code) WHERE status IN ('active','checked_in');
CREATE INDEX visitor_invites_flat ON visitor_invites(flat_id, valid_from DESC);
CREATE INDEX visitor_invites_society_date ON visitor_invites(society_id, valid_from, valid_until);

CREATE TABLE visitor_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id       uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  flat_id          uuid NOT NULL,
  visitor_id       uuid NOT NULL,
  gate_id          uuid,
  category         text NOT NULL DEFAULT 'guest',
  provider         text,
  purpose          text,
  guest_count      smallint NOT NULL DEFAULT 1,
  vehicle_number   varchar(15),
  requested_by     uuid NOT NULL REFERENCES users(id),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  responded_by     uuid REFERENCES users(id),
  responded_at     timestamptz,
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id),
  FOREIGN KEY (visitor_id, society_id) REFERENCES visitors(id, society_id),
  FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id),
  UNIQUE (id, society_id)
);
CREATE INDEX visitor_approvals_flat_pending ON visitor_approvals(flat_id) WHERE status = 'pending';
CREATE INDEX visitor_approvals_society ON visitor_approvals(society_id, created_at DESC);

CREATE TABLE visitor_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id        uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  flat_id           uuid,
  visitor_id        uuid,
  invite_id         uuid,
  approval_id       uuid,
  category          text NOT NULL DEFAULT 'guest' CHECK (category IN ('guest','delivery','food_delivery','courier','cab','domestic_staff','service')),
  provider          text,
  visitor_name      text NOT NULL,              -- snapshot at time of entry
  visitor_mobile    varchar(13),
  vehicle_number    varchar(15),
  guest_count       smallint NOT NULL DEFAULT 1,
  gate_id           uuid,
  checked_in_by     uuid REFERENCES users(id),
  checked_in_at     timestamptz NOT NULL DEFAULT now(),
  checkout_gate_id  uuid,
  checked_out_by    uuid REFERENCES users(id),
  checked_out_at    timestamptz,
  status            text NOT NULL DEFAULT 'inside' CHECK (status IN ('inside','checked_out','left_at_gate')),
  notes             text,
  client_ref        varchar(64),               -- offline-sync idempotency reference
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id),
  FOREIGN KEY (visitor_id, society_id) REFERENCES visitors(id, society_id),
  FOREIGN KEY (invite_id, society_id) REFERENCES visitor_invites(id, society_id),
  FOREIGN KEY (approval_id, society_id) REFERENCES visitor_approvals(id, society_id),
  FOREIGN KEY (gate_id, society_id) REFERENCES gates(id, society_id),
  FOREIGN KEY (checkout_gate_id, society_id) REFERENCES gates(id, society_id),
  UNIQUE (society_id, client_ref)
);
CREATE INDEX visitor_entries_society_time ON visitor_entries(society_id, checked_in_at DESC);
CREATE INDEX visitor_entries_inside ON visitor_entries(society_id) WHERE status = 'inside';
CREATE INDEX visitor_entries_flat ON visitor_entries(flat_id, checked_in_at DESC);
CREATE INDEX visitor_entries_name_trgm ON visitor_entries USING gin (visitor_name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Complaints
-- ---------------------------------------------------------------------------
CREATE TABLE complaints (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id         uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  number             varchar(24) NOT NULL,
  flat_id            uuid,
  raised_by          uuid NOT NULL REFERENCES users(id),
  category           text NOT NULL CHECK (category IN ('plumbing','electrical','housekeeping','lift','security','parking','water','common_area','noise','pest_control','other')),
  subcategory        text,
  title              text NOT NULL,
  description        text NOT NULL,
  location           text,
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','resolved','closed')),
  assigned_to        uuid REFERENCES users(id),
  assignee_name      text,                      -- external technician/vendor name
  assigned_at        timestamptz,
  in_progress_at     timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  reopened_at        timestamptz,
  reopen_count       smallint NOT NULL DEFAULT 0,
  rating             smallint CHECK (rating BETWEEN 1 AND 5),
  rating_feedback    text,
  rated_at           timestamptz,
  -- SLA readiness (Phase 2): policy reference + computed deadlines
  sla_policy_id      uuid,
  first_response_due_at timestamptz,
  resolution_due_at  timestamptz,
  first_response_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id),
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id),
  UNIQUE (society_id, number),
  UNIQUE (id, society_id)
);
CREATE INDEX complaints_society_status ON complaints(society_id, status, created_at DESC);
CREATE INDEX complaints_flat ON complaints(flat_id, created_at DESC);
CREATE INDEX complaints_title_trgm ON complaints USING gin (title gin_trgm_ops);

CREATE TABLE complaint_comments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  complaint_id  uuid NOT NULL,
  author_id     uuid NOT NULL REFERENCES users(id),
  body          text NOT NULL,
  visibility    text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','internal')),
  kind          text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','status_change','system')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (complaint_id, society_id) REFERENCES complaints(id, society_id) ON DELETE CASCADE
);
CREATE INDEX complaint_comments_complaint ON complaint_comments(complaint_id, created_at);

CREATE TABLE complaint_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  complaint_id  uuid NOT NULL,
  comment_id    uuid REFERENCES complaint_comments(id) ON DELETE SET NULL,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  file_key      text NOT NULL,
  mime_type     text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (complaint_id, society_id) REFERENCES complaints(id, society_id) ON DELETE CASCADE
);
CREATE INDEX complaint_attachments_complaint ON complaint_attachments(complaint_id);

CREATE TABLE complaint_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id    uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  complaint_id  uuid NOT NULL,
  from_status   text,
  to_status     text NOT NULL,
  changed_by    uuid REFERENCES users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (complaint_id, society_id) REFERENCES complaints(id, society_id) ON DELETE CASCADE
);
CREATE INDEX complaint_status_history_complaint ON complaint_status_history(complaint_id, created_at);

-- ---------------------------------------------------------------------------
-- Facilities & bookings
-- ---------------------------------------------------------------------------
CREATE TABLE facilities (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id                   uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name                         text NOT NULL,
  description                  text,
  location                     text,
  open_time                    time NOT NULL,
  close_time                   time NOT NULL,
  slot_duration_minutes        integer NOT NULL DEFAULT 60 CHECK (slot_duration_minutes BETWEEN 15 AND 720),
  max_booking_minutes          integer NOT NULL DEFAULT 60 CHECK (max_booking_minutes >= 15),
  capacity                     integer NOT NULL DEFAULT 4 CHECK (capacity > 0),
  max_concurrent_bookings      integer NOT NULL DEFAULT 1 CHECK (max_concurrent_bookings > 0),
  advance_booking_days         integer NOT NULL DEFAULT 7 CHECK (advance_booking_days BETWEEN 0 AND 180),
  cancellation_cutoff_minutes  integer NOT NULL DEFAULT 60 CHECK (cancellation_cutoff_minutes >= 0),
  max_bookings_per_flat_per_day integer NOT NULL DEFAULT 2 CHECK (max_bookings_per_flat_per_day > 0),
  rules                        text,
  image_key                    text,
  is_active                    boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  created_by                   uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (close_time > open_time),
  UNIQUE (society_id, name),
  UNIQUE (id, society_id)
);

-- Slot templates. Generated from opening hours; admins may disable individual slots.
CREATE TABLE facility_slots (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id   uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  facility_id  uuid NOT NULL,
  day_of_week  smallint CHECK (day_of_week BETWEEN 0 AND 6),  -- NULL = every day
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, society_id) REFERENCES facilities(id, society_id) ON DELETE CASCADE,
  CHECK (end_time > start_time)
);
CREATE INDEX facility_slots_facility ON facility_slots(facility_id);

CREATE TABLE facility_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id     uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  facility_id    uuid NOT NULL,
  slot_id        uuid REFERENCES facility_slots(id) ON DELETE SET NULL,
  flat_id        uuid NOT NULL,
  booked_by      uuid NOT NULL REFERENCES users(id),
  reference      varchar(16) NOT NULL,
  booking_date   date NOT NULL,
  start_time     time NOT NULL,
  end_time       time NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  guest_count    smallint NOT NULL DEFAULT 1,
  status         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed')),
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES users(id),
  cancel_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (facility_id, society_id) REFERENCES facilities(id, society_id),
  FOREIGN KEY (flat_id, society_id) REFERENCES flats(id, society_id),
  CHECK (ends_at > starts_at),
  UNIQUE (society_id, reference)
);
CREATE INDEX facility_bookings_facility_time ON facility_bookings(facility_id, starts_at) WHERE status = 'confirmed';
CREATE INDEX facility_bookings_flat ON facility_bookings(flat_id, starts_at DESC);
CREATE INDEX facility_bookings_society_date ON facility_bookings(society_id, booking_date);

-- ---------------------------------------------------------------------------
-- Communication
-- ---------------------------------------------------------------------------
CREATE TABLE announcements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id      uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  title           text NOT NULL,
  body            text NOT NULL,
  category        text NOT NULL DEFAULT 'general' CHECK (category IN ('general','maintenance','water','electricity','security','event','emergency')),
  priority        text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','emergency')),
  audience        text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','towers')),
  tower_ids       uuid[],
  publish_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz,
  attachment_key  text,
  status          text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','archived')),
  notified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  CHECK (expires_at IS NULL OR expires_at > publish_at)
);
CREATE INDEX announcements_society_publish ON announcements(society_id, publish_at DESC);
CREATE INDEX announcements_title_trgm ON announcements USING gin (title gin_trgm_ops);

CREATE TABLE emergency_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id     uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  name           text NOT NULL,
  category       text NOT NULL DEFAULT 'society' CHECK (category IN ('society','medical','police','fire','utility','maintenance','other')),
  phone          varchar(15) NOT NULL CHECK (phone ~ '^\+?[0-9]{3,14}$'),
  description    text,
  available_24x7 boolean NOT NULL DEFAULT false,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX emergency_contacts_society ON emergency_contacts(society_id, sort_order);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id   uuid REFERENCES societies(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  category     text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  priority     text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','emergency')),
  entity_type  text,
  entity_id    uuid,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;

CREATE TABLE notification_preferences (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  society_id  uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN ('visitors','complaints','bookings','announcements')),
  in_app      boolean NOT NULL DEFAULT true,
  push        boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, society_id, category)
);

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user ON push_subscriptions(user_id);

-- ---------------------------------------------------------------------------
-- Auth
-- ---------------------------------------------------------------------------
CREATE TABLE otp_codes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile       varchar(13) NOT NULL,
  code_hash    text NOT NULL,
  purpose      text NOT NULL DEFAULT 'login',
  attempts     smallint NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_mobile ON otp_codes(mobile, created_at DESC);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    char(64) NOT NULL UNIQUE,
  society_id    uuid REFERENCES societies(id) ON DELETE CASCADE,
  role          text NOT NULL,
  auth_method   text NOT NULL CHECK (auth_method IN ('otp','password')),
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  char(64) NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_keys (
  key          varchar(80) NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status_code  integer NOT NULL,
  response     jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Audit (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id   uuid REFERENCES societies(id) ON DELETE SET NULL,
  actor_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_role   text,
  action       text NOT NULL,
  entity_type  text,
  entity_id    uuid,
  summary      text,
  old_values   jsonb,
  new_values   jsonb,
  ip           inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_society_time ON audit_logs(society_id, created_at DESC);
CREATE INDEX audit_logs_entity ON audit_logs(entity_type, entity_id);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

-- updated_at triggers
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','societies','society_subscriptions','society_users','towers','floors','flats','gates',
    'residents','resident_flat_relationships','security_guards','visitors','visitor_invites','visitor_approvals',
    'visitor_entries','complaints','facilities','facility_slots','facility_bookings','announcements','emergency_contacts']
  LOOP
    EXECUTE format('CREATE TRIGGER %I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;
