import { NavLink, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, ChevronRight, Home, LayoutGrid, Megaphone, MessageSquareWarning, Search, Siren, UserCheck, Users, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { get, post } from '../../lib/api';
import { useSession } from '../../lib/session';
import { dayLabel, firstName, greeting, relative, time12, timeRange } from '../../lib/format';
import { Badge, Button, Card, Loading, StatusBadge, useToast, ErrorBox } from '../../components/ui';
import { VisitorsPage, InviteVisitorPage, PassPage, ApprovalPage } from './Visitors';
import { ComplaintsPage, NewComplaintPage, ComplaintDetailPage } from './Complaints';
import { FacilitiesPage, FacilityPage, MyBookingsPage } from './Facilities';
import { CommunityPage, AnnouncementPage, EmergencyPage, MorePage, ProfilePage, NotificationsPage, SearchPage, PreferencesPage } from './Community';

export default function ResidentApp() {
  return (
    <div className="mobile-shell">
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="visitors" element={<VisitorsPage />} />
        <Route path="visitors/new" element={<InviteVisitorPage />} />
        <Route path="visitors/pass/:id" element={<PassPage />} />
        <Route path="approvals/:id" element={<ApprovalPage />} />
        <Route path="complaints" element={<ComplaintsPage />} />
        <Route path="complaints/new" element={<NewComplaintPage />} />
        <Route path="complaints/:id" element={<ComplaintDetailPage />} />
        <Route path="facilities" element={<FacilitiesPage />} />
        <Route path="facilities/bookings" element={<MyBookingsPage />} />
        <Route path="facilities/:id" element={<FacilityPage />} />
        <Route path="community" element={<CommunityPage />} />
        <Route path="community/:id" element={<AnnouncementPage />} />
        <Route path="emergency" element={<EmergencyPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="preferences" element={<PreferencesPage />} />
        <Route path="search" element={<SearchPage />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

function BottomNav() {
  const items = [
    { to: '/app', label: 'Home', icon: Home, end: true },
    { to: '/app/visitors', label: 'Visitors', icon: Users },
    { to: '/app/community', label: 'Community', icon: Megaphone },
    { to: '/app/more', label: 'More', icon: LayoutGrid },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main">
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-pill">
            <Icon size={22} />
          </span>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function MobileHeader({ title, back, action }: { title: ReactNode; back?: string | boolean; action?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="mobile-header">
      {back && (
        <button className="icon-btn" aria-label="Back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))}>
          <ChevronRight size={20} style={{ transform: 'rotate(180deg)' }} />
        </button>
      )}
      <h1 className="grow truncate">{title}</h1>
      {action}
    </header>
  );
}

export function NotificationBell() {
  const { data } = useQuery({ queryKey: ['notif-summary'], queryFn: () => get('/notifications/summary'), refetchInterval: 30_000 });
  return (
    <Link to="/app/notifications" className="icon-btn" aria-label={`Notifications${data?.unreadCount ? `, ${data.unreadCount} unread` : ''}`}>
      <Bell size={20} />
      {data?.unreadCount ? <span className="dot-badge">{data.unreadCount > 9 ? '9+' : data.unreadCount}</span> : null}
    </Link>
  );
}

function HomePage() {
  const me = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['home'], queryFn: () => get('/home'), refetchInterval: 20_000 });
  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) => post(`/visitors/approvals/${id}/respond`, { decision }),
    onSuccess: (r) => {
      toast(r.status === 'approved' ? 'Visitor approved — the guard has been informed' : 'Visitor rejected', 'success');
      qc.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  const flat = me.flats[0];
  return (
    <>
      <header className="mobile-header" style={{ paddingTop: 18 }}>
        <div className="grow" />
        <Link to="/app/search" className="icon-btn" aria-label="Search">
          <Search size={20} />
        </Link>
        <NotificationBell />
      </header>
      <main className="mobile-main">
        <section className="greeting">
          <h1>
            {greeting()}, {firstName(me.user.fullName)}
          </h1>
          <div className="loc">
            <div className="strong" style={{ color: 'var(--text)' }}>{me.society?.name}</div>
            {flat ? (
              <div>
                {flat.tower_name} • {flat.number}
              </div>
            ) : (
              <div className="muted">No flat linked yet — contact your society office</div>
            )}
          </div>
        </section>

        {data?.emergencies?.map((e: any) => (
          <Link key={e.id} to={`/app/community/${e.id}`} className="card card-link emergency" style={{ marginBottom: 12 }}>
            <div className="row emergency-label strong small">
              <Siren size={18} /> EMERGENCY
            </div>
            <h3 style={{ marginTop: 6 }}>{e.title}</h3>
            <p className="small mt-1 secondary">{e.body}</p>
          </Link>
        ))}

        {data?.pendingApprovals?.map((a: any) => (
          <Card key={a.id} className="important" style={{ marginBottom: 12 }}>
            <div className="row small strong" style={{ color: 'var(--warning)' }}>
              <UserCheck size={18} /> Visitor approval
            </div>
            <h3 style={{ fontSize: '1.2rem', marginTop: 6 }}>{a.visitor_name}</h3>
            <p className="secondary small">
              {a.gate_name} • Visiting you{a.purpose ? ` • ${a.purpose}` : ''}
            </p>
            <div className="grid-2 mt-2">
              <Button variant="secondary" size="lg" onClick={() => respond.mutate({ id: a.id, decision: 'reject' })} disabled={respond.isPending}>
                Reject
              </Button>
              <Button variant="success" size="lg" onClick={() => respond.mutate({ id: a.id, decision: 'approve' })} disabled={respond.isPending}>
                Approve
              </Button>
            </div>
          </Card>
        ))}

        <nav className="quick-actions" aria-label="Quick actions">
          <QuickAction to="/app/visitors" label="Visitors" icon={<Users size={24} />} tone="qa-blue" />
          <QuickAction to="/app/complaints" label="Complaints" icon={<Wrench size={24} />} tone="qa-amber" />
          <QuickAction to="/app/facilities" label="Facilities" icon={<CalendarDays size={24} />} tone="qa-green" />
          <QuickAction to="/app/community" label="Community" icon={<Megaphone size={24} />} tone="qa-violet" />
        </nav>

        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <div className="stack">
            {data.announcement && (
              <Link to={`/app/community/${data.announcement.id}`} className={`card card-link ${data.announcement.priority === 'emergency' ? 'emergency' : data.announcement.priority === 'important' ? 'important' : ''}`}>
                <div className="between">
                  <span className="xsmall strong muted">LATEST ANNOUNCEMENT</span>
                  <span className="xsmall muted">{relative(data.announcement.publish_at)}</span>
                </div>
                <h3 style={{ marginTop: 6 }}>{data.announcement.title}</h3>
                <p className="small secondary mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {data.announcement.body}
                </p>
              </Link>
            )}

            <HomeCard to={data.nextVisitor ? `/app/visitors/pass/${data.nextVisitor.id}` : '/app/visitors/new'} label="VISITOR STATUS" icon={<Users size={20} />} tone="qa-blue">
              {data.nextVisitor ? (
                <>
                  <div className="xsmall muted">{data.nextVisitor.inside ? 'Visitor inside' : 'Visitor arriving'}</div>
                  <div className="strong">{data.nextVisitor.visitor_name}</div>
                  <div className="small secondary">
                    {dayLabel(data.nextVisitor.next_date ?? data.nextVisitor.valid_from)} • {time12(data.nextVisitor.expected_arrival)}
                  </div>
                </>
              ) : (
                <>
                  <div className="strong">No visitors expected</div>
                  <div className="small secondary">Tap to invite a guest</div>
                </>
              )}
            </HomeCard>

            <HomeCard to={data.openComplaints?.[0] ? `/app/complaints/${data.openComplaints[0].id}` : '/app/complaints/new'} label="OPEN COMPLAINTS" icon={<MessageSquareWarning size={20} />} tone="qa-amber">
              {data.openComplaints?.[0] ? (
                <>
                  <div className="strong">{data.openComplaints[0].title}</div>
                  <div className="small secondary">Ticket #{data.openComplaints[0].number}</div>
                  <div className="mt-1">
                    <StatusBadge status={data.openComplaints[0].status} />
                  </div>
                </>
              ) : (
                <>
                  <div className="strong">No open complaints</div>
                  <div className="small secondary">Tap to raise one</div>
                </>
              )}
            </HomeCard>

            <HomeCard to={data.nextBooking ? '/app/facilities/bookings' : '/app/facilities'} label="UPCOMING BOOKING" icon={<CalendarDays size={20} />} tone="qa-green">
              {data.nextBooking ? (
                <>
                  <div className="strong">{data.nextBooking.facility_name}</div>
                  <div className="small secondary">
                    {dayLabel(data.nextBooking.booking_date)} • {timeRange(data.nextBooking.start_time, data.nextBooking.end_time)}
                  </div>
                </>
              ) : (
                <>
                  <div className="strong">No upcoming bookings</div>
                  <div className="small secondary">Book the gym, pool, courts and more</div>
                </>
              )}
            </HomeCard>

            <Link to="/app/emergency" className="card card-link row">
              <span className="icon-tile qa-red">
                <Siren size={20} />
              </span>
              <span className="grow strong">Emergency contacts</span>
              <Badge tone="danger">SOS</Badge>
            </Link>
          </div>
        )}
      </main>
    </>
  );
}

function QuickAction({ to, label, icon, tone }: { to: string; label: string; icon: ReactNode; tone: string }) {
  return (
    <Link to={to} className="quick-action">
      <span className={`qa-icon ${tone}`}>{icon}</span>
      {label}
    </Link>
  );
}

function HomeCard({ to, label, icon, tone, children }: { to: string; label: string; icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <Link to={to} className="card card-link row" style={{ alignItems: 'flex-start' }}>
      <span className={`icon-tile ${tone}`}>{icon}</span>
      <div className="grow stack-sm" style={{ gap: 2 }}>
        <span className="xsmall strong muted">{label}</span>
        {children}
      </div>
      <ChevronRight size={18} className="muted" style={{ alignSelf: 'center' }} />
    </Link>
  );
}
