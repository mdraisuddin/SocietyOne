import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Building, CalendarCheck, CalendarDays, ClipboardList, Gauge, Home, LogOut, Megaphone, Menu, Phone, Settings, ShieldCheck, Siren, Users, Wrench, AlertTriangle, UserCheck, Star, Timer } from 'lucide-react';
import { get } from '../../lib/api';
import { useLogout, useSession } from '../../lib/session';
import { CATEGORY_LABEL, COMPLAINT_STATUS, dayLabel, num, relative, timeRange, titleCase } from '../../lib/format';
import { Avatar, Badge, Brand, Card, Empty, ErrorBox, Loading, PriorityBadge, SearchInput, Segmented, StatusBadge } from '../../components/ui';
import { HBars, StackedBars } from '../../components/Charts';
import { ResidentsPage, FlatsPage, GuardsPage } from './People';
import { VisitorsAdminPage, ComplaintsAdminPage, ComplaintAdminDetail, FacilitiesAdminPage, BookingsAdminPage, AnnouncementsAdminPage, EmergencyAdminPage } from './Operations';
import { SettingsPage, AuditPage } from './Settings';

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: Gauge, end: true },
  { to: '/admin/residents', label: 'Residents', icon: Users },
  { to: '/admin/flats', label: 'Flats', icon: Home },
  { to: '/admin/visitors', label: 'Visitors', icon: UserCheck },
  { to: '/admin/complaints', label: 'Complaints', icon: Wrench },
  { to: '/admin/facilities', label: 'Facilities', icon: CalendarDays },
  { to: '/admin/bookings', label: 'Bookings', icon: CalendarCheck },
  { to: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/admin/emergency', label: 'Emergency Contacts', icon: Siren },
  { to: '/admin/guards', label: 'Security Staff', icon: ShieldCheck },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminApp() {
  const me = useSession();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="admin-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Management navigation">
        <Brand />
        <div className="xsmall muted" style={{ padding: '0 12px 10px' }}>
          {me.society?.name}
        </div>
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
        {me.role === 'admin' && (
          <>
            <div className="side-section">Compliance</div>
            <NavLink to="/admin/audit" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <ClipboardList size={19} /> Audit Log
            </NavLink>
          </>
        )}
        <div className="grow" />
        <div className="card row" style={{ padding: 10, marginTop: 14 }}>
          <Avatar name={me.user.fullName} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="small strong truncate">{me.user.fullName}</div>
            <div className="xsmall muted">{titleCase(me.role)}</div>
          </div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {open && <div className="drawer-overlay" style={{ zIndex: 65 }} onClick={() => setOpen(false)} />}
      <div className="admin-main">
        <header className="topbar">
          <button className="icon-btn mobile-menu-btn" aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu size={20} />
          </button>
          <GlobalSearch />
          <div className="grow" />
          <AdminBell />
        </header>
        <div className="admin-content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="residents" element={<ResidentsPage />} />
            <Route path="flats" element={<FlatsPage />} />
            <Route path="visitors" element={<VisitorsAdminPage />} />
            <Route path="complaints" element={<ComplaintsAdminPage />} />
            <Route path="complaints/:id" element={<ComplaintAdminDetail />} />
            <Route path="facilities" element={<FacilitiesAdminPage />} />
            <Route path="bookings" element={<BookingsAdminPage />} />
            <Route path="announcements" element={<AnnouncementsAdminPage />} />
            <Route path="emergency" element={<EmergencyAdminPage />} />
            <Route path="guards" element={<GuardsPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </div>
  );
}

function AdminBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['notifications'], queryFn: () => get('/notifications?limit=15'), refetchInterval: 30_000 });
  return (
    <div style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label="Notifications" onClick={() => setOpen(!open)}>
        <Bell size={19} />
        {data?.unreadCount ? <span className="dot-badge">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span> : null}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 48, width: 360, maxHeight: 440, overflowY: 'auto', zIndex: 40, padding: 0, boxShadow: 'var(--shadow-lg)' }}>
          {!data?.notifications?.length ? (
            <Empty title="No notifications" />
          ) : (
            <div className="list">
              {data.notifications.map((n: any) => (
                <button
                  key={n.id}
                  className="list-item"
                  style={{ alignItems: 'flex-start', background: n.read_at ? undefined : 'var(--primary-soft)' }}
                  onClick={() => {
                    setOpen(false);
                    fetch(`/api/v1/notifications/${n.id}/read`, { method: 'POST', credentials: 'include', headers: { 'X-SocietyOne-Client': 'web' } });
                    if (n.data?.url?.startsWith('/admin')) nav(n.data.url);
                  }}
                >
                  <div className="grow">
                    <div className="small strong">{n.title}</div>
                    <div className="xsmall secondary">{n.body}</div>
                    <div className="xsmall muted">{relative(n.created_at)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['admin-search', q], queryFn: () => get(`/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const go = (to: string) => {
    setQ('');
    nav(to);
  };
  const has = data && Object.values(data).some((a: any) => a.length);
  return (
    <div style={{ position: 'relative', width: 'min(460px, 100%)' }}>
      <SearchInput value={q} onChange={setQ} placeholder="Search residents, flats, visitors, complaints, bookings" delay={250} />
      {q.trim().length >= 2 && data && (
        <div className="card" style={{ position: 'absolute', top: 50, left: 0, right: 0, zIndex: 40, padding: 6, maxHeight: 460, overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}>
          {!has && <div className="muted small" style={{ padding: 12 }}>No results for “{q}”</div>}
          <SearchGroup title="Residents" items={data.residents} render={(r: any) => (
            <button key={r.id} className="list-item" onClick={() => go(`/admin/residents?q=${encodeURIComponent(r.full_name)}`)}>
              <Users size={16} className="muted" /> <span className="grow">{r.full_name}</span> <span className="xsmall muted">{r.flat_number}</span>
            </button>
          )} />
          <SearchGroup title="Flats" items={data.flats} render={(f: any) => (
            <button key={f.id} className="list-item" onClick={() => go(`/admin/flats?q=${encodeURIComponent(f.number)}`)}>
              <Home size={16} className="muted" /> <span className="grow">{f.number}</span> <span className="xsmall muted">{titleCase(f.occupancy_status)}</span>
            </button>
          )} />
          <SearchGroup title="Complaints" items={data.complaints} render={(c: any) => (
            <button key={c.id} className="list-item" onClick={() => go(`/admin/complaints/${c.id}`)}>
              <Wrench size={16} className="muted" /> <span className="grow truncate">{c.number} · {c.title}</span> <StatusBadge status={c.status} />
            </button>
          )} />
          <SearchGroup title="Visitors" items={data.visitors} render={(v: any) => (
            <button key={v.id} className="list-item" onClick={() => go(`/admin/visitors?q=${encodeURIComponent(v.visitor_name)}`)}>
              <UserCheck size={16} className="muted" /> <span className="grow">{v.visitor_name}</span> <span className="xsmall muted">{v.flat_number}</span>
            </button>
          )} />
          <SearchGroup title="Bookings" items={data.bookings} render={(b: any) => (
            <button key={b.id} className="list-item" onClick={() => go(`/admin/bookings?q=${encodeURIComponent(b.reference)}`)}>
              <CalendarCheck size={16} className="muted" /> <span className="grow">{b.facility_name} · {b.flat_number}</span> <span className="xsmall muted">{b.reference}</span>
            </button>
          )} />
        </div>
      )}
    </div>
  );
}
function SearchGroup({ title, items, render }: { title: string; items: any[]; render: (x: any) => ReactNode }) {
  if (!items?.length) return null;
  return (
    <div>
      <div className="xsmall strong muted" style={{ padding: '8px 12px 4px' }}>
        {title.toUpperCase()}
      </div>
      {items.map(render)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = { open: 'var(--series-1)', assigned: 'var(--series-7)', in_progress: 'var(--series-4)', resolved: 'var(--series-3)', closed: 'var(--text-3)' };

function Dashboard() {
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d');
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard', range], queryFn: () => get(`/dashboard?range=${range}`), refetchInterval: 60_000 });
  const me = useSession();
  const nav = useNavigate();
  return (
    <>
      <PageHead
        title="Dashboard"
        sub={`${me.society?.name} • ${me.society?.city}`}
        actions={<Segmented label="Range" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: '7d', label: '7 Days' }, { value: '30d', label: '30 Days' }]} />}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="stack-lg">
          <div className="stats-grid">
            <Stat label="Total Flats" icon={<Building size={16} />} value={num(data.cards.total_flats)} sub={`${num(data.cards.occupied_flats)} occupied`} to="/admin/flats" />
            <Stat label="Residents" icon={<Users size={16} />} value={num(data.cards.residents)} to="/admin/residents" />
            <Stat label="Visitors Today" icon={<UserCheck size={16} />} value={num(data.cards.visitors_today)} sub={range !== 'today' ? `${num(data.cards.visitors_range)} in range` : undefined} to="/admin/visitors" />
            <Stat label="Currently Inside" icon={<Users size={16} />} value={num(data.cards.visitors_inside)} sub={data.cards.pending_approvals ? `${data.cards.pending_approvals} awaiting approval` : undefined} to="/admin/visitors?status=inside" />
            <Stat label="Open Complaints" icon={<Wrench size={16} />} value={num(data.cards.open_complaints)} sub={data.cards.overdue_complaints ? <span style={{ color: 'var(--danger)' }}>{data.cards.overdue_complaints} past target time</span> : 'None overdue'} to="/admin/complaints" />
            <Stat label="Today’s Bookings" icon={<CalendarCheck size={16} />} value={num(data.cards.bookings_today)} to="/admin/bookings" />
          </div>

          <div className="dash-grid">
            <Card title={range === 'today' ? 'Visitor activity by hour' : 'Visitor activity'}>
              {range === 'today' ? (
                <StackedBars
                  ariaLabel="Visitors by hour today"
                  data={data.visitorSeries}
                  series={[{ key: 'count', label: 'Visitors', color: 'var(--series-1)' }]}
                  labelFor={(d) => `${String(d.bucket).padStart(2, '0')}:00`}
                />
              ) : (
                <StackedBars
                  ariaLabel="Visitors per day"
                  data={data.visitorSeries.map((d: any) => ({ ...d, other: d.count - d.guests - d.deliveries }))}
                  series={[
                    { key: 'guests', label: 'Guests', color: 'var(--series-1)' },
                    { key: 'deliveries', label: 'Deliveries', color: 'var(--series-2)' },
                    { key: 'other', label: 'Cabs, staff & other', color: 'var(--series-3)' },
                  ]}
                  labelFor={(d) => new Date(`${d.bucket}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
                />
              )}
            </Card>
            <Card title="Complaint status">
              <HBars rows={['open', 'assigned', 'in_progress', 'resolved', 'closed'].map((s) => ({ label: COMPLAINT_STATUS[s].label, value: data.complaintStatus.find((x: any) => x.status === s)?.count ?? 0, color: STATUS_COLORS[s] }))} />
              <div className="grid-2 mt-3">
                <div className="stat">
                  <span className="stat-label"><Star size={14} /> Avg rating</span>
                  <span className="stat-value" style={{ fontSize: '1.4rem' }}>{data.cards.avg_rating ?? '—'}</span>
                </div>
                <div className="stat">
                  <span className="stat-label"><Timer size={14} /> Avg resolution</span>
                  <span className="stat-value" style={{ fontSize: '1.4rem' }}>{data.cards.avg_resolution_hours ? `${data.cards.avg_resolution_hours} h` : '—'}</span>
                </div>
              </div>
            </Card>
          </div>

          <div className="dash-grid">
            <Card title="Recent complaints" action={<Link to="/admin/complaints" className="small">View all</Link>} className="card-flush" style={{ padding: 0 }}>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {data.recentComplaints.map((c: any) => (
                      <tr key={c.id} className="clickable" onClick={() => nav(`/admin/complaints/${c.id}`)}>
                        <td>
                          <div className="strong">{c.title}</div>
                          <div className="xsmall muted">
                            {c.number} • {c.flat_number} • {relative(c.created_at)}
                          </div>
                        </td>
                        <td>{titleCase(c.category)}</td>
                        <td><PriorityBadge priority={c.priority} /></td>
                        <td>
                          <div className="row" style={{ gap: 6 }}>
                            <StatusBadge status={c.status} />
                            {c.overdue && <AlertTriangle size={16} color="var(--danger)" aria-label="Overdue" />}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Complaint categories">
              {data.complaintCategories.length ? <HBars rows={data.complaintCategories.map((c: any) => ({ label: titleCase(c.category), value: c.count }))} /> : <Empty title="No complaints in this period" />}
            </Card>
          </div>

          <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
            <Card title="Recent visitor activity" action={<Link to="/admin/visitors" className="small">View all</Link>}>
              <div className="list">
                {data.recentVisitors.map((v: any) => (
                  <div key={v.id} className="between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="strong truncate">{v.visitor_name}</div>
                      <div className="xsmall muted">
                        {CATEGORY_LABEL[v.category]} • {v.flat_number ?? '—'} • {v.gate_name}
                      </div>
                    </div>
                    <div className="xsmall muted" style={{ textAlign: 'right' }}>
                      {v.status === 'inside' ? <Badge tone="success">Inside</Badge> : relative(v.checked_in_at)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Upcoming facility bookings" action={<Link to="/admin/bookings" className="small">View all</Link>}>
              {!data.upcomingBookings.length ? (
                <Empty title="No upcoming bookings" />
              ) : (
                data.upcomingBookings.map((b: any) => (
                  <div key={b.id} className="between small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div className="strong">{b.facility_name}</div>
                      <div className="xsmall muted">{b.flat_number}</div>
                    </div>
                    <div className="xsmall secondary" style={{ textAlign: 'right' }}>
                      {dayLabel(b.booking_date)}
                      <br />
                      {timeRange(b.start_time, b.end_time)}
                    </div>
                  </div>
                ))
              )}
            </Card>
            <Card title="Latest announcements" action={<Link to="/admin/announcements" className="small">Manage</Link>}>
              {data.latestAnnouncements.map((a: any) => (
                <div key={a.id} className="small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="row" style={{ gap: 6 }}>
                    {a.priority !== 'normal' && <Badge tone={a.priority === 'emergency' ? 'danger' : 'warning'}>{titleCase(a.priority)}</Badge>}
                    <span className="strong truncate">{a.title}</span>
                  </div>
                  <div className="xsmall muted">
                    {titleCase(a.category)} • {relative(a.publish_at)}
                  </div>
                </div>
              ))}
            </Card>
          </div>
          <p className="xsmall muted">
            <Phone size={12} /> Figures refresh every minute. Dates and times are in IST.
          </p>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, sub, icon, to }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; to?: string }) {
  const body = (
    <div className="stat">
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
  return to ? (
    <Link to={to} className="card card-link">
      {body}
    </Link>
  ) : (
    <div className="card">{body}</div>
  );
}
