import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CalendarDays, ChevronRight, Droplets, LogOut, Megaphone, Phone, Search as SearchIcon, Settings2, ShieldAlert, Siren, User, Users, Wrench, Zap, PartyPopper, Hammer, Info, Camera } from 'lucide-react';
import { get, post, postForm, put, patch, qs } from '../../lib/api';
import { useLogout, useSession } from '../../lib/session';
import { dateLong, dateTime, formatMobile, relative, titleCase, tsDay } from '../../lib/format';
import { compressImage } from '../../lib/image';
import { Avatar, Badge, Button, Card, Chips, Empty, ErrorBox, Input, Loading, SearchInput, StatusBadge, useToast } from '../../components/ui';
import { MobileHeader, NotificationBell } from './ResidentApp';

const ANN_ICON: Record<string, any> = { general: Info, maintenance: Hammer, water: Droplets, electricity: Zap, security: ShieldAlert, event: PartyPopper, emergency: Siren };

export function CommunityPage() {
  const [category, setCategory] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['announcements', category], queryFn: () => get(`/announcements${qs({ category, pageSize: 50 })}`) });
  return (
    <>
      <MobileHeader title="Community" action={<NotificationBell />} />
      <main className="mobile-main stack">
        <Chips
          label="Category"
          value={category}
          onChange={setCategory}
          options={[{ value: '', label: 'All' }, ...['emergency', 'maintenance', 'water', 'electricity', 'security', 'event', 'general'].map((c) => ({ value: c, label: titleCase(c) }))]}
        />
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.announcements.length ? (
          <Empty icon={<Megaphone size={40} />} title="No announcements" />
        ) : (
          data.announcements.map((a: any) => <AnnouncementCard key={a.id} a={a} />)
        )}
        <Link to="/app/emergency" className="card card-link row">
          <span className="icon-tile qa-red">
            <Siren size={20} />
          </span>
          <span className="grow strong">Emergency contacts</span>
          <ChevronRight size={18} />
        </Link>
      </main>
    </>
  );
}

function AnnouncementCard({ a }: { a: any }) {
  const Icon = ANN_ICON[a.category] ?? Info;
  const cls = a.priority === 'emergency' ? 'emergency' : a.priority === 'important' ? 'important' : '';
  return (
    <Link to={`/app/community/${a.id}`} className={`card card-link ${cls}`}>
      <div className="row">
        <span className={`icon-tile ${a.priority === 'emergency' ? 'qa-red' : 'qa-violet'}`}>
          <Icon size={18} />
        </span>
        <div className="grow">
          {a.priority === 'emergency' && <div className="xsmall strong emergency-label">EMERGENCY</div>}
          <h3>{a.title}</h3>
          <div className="xsmall muted">
            {titleCase(a.category)} • {relative(a.publishAt)}
          </div>
        </div>
        {a.priority === 'important' && <Badge tone="warning">Important</Badge>}
      </div>
      <p className="small secondary mt-1" style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {a.body}
      </p>
    </Link>
  );
}

export function AnnouncementPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuery({ queryKey: ['announcement', id], queryFn: () => get(`/announcements/${id}`) });
  if (isLoading) return <Loading />;
  const a = data?.announcement;
  return (
    <>
      <MobileHeader title="Announcement" back="/app/community" />
      <main className="mobile-main stack">
        {error ? (
          <ErrorBox error={error} />
        ) : (
          <Card className={a.priority === 'emergency' ? 'emergency' : a.priority === 'important' ? 'important' : ''}>
            <div className="row-wrap" style={{ marginBottom: 8 }}>
              <Badge tone={a.priority === 'emergency' ? 'danger' : a.priority === 'important' ? 'warning' : 'primary'}>{titleCase(a.priority)}</Badge>
              <Badge>{titleCase(a.category)}</Badge>
            </div>
            <h2>{a.title}</h2>
            <p className="xsmall muted mt-1">
              Posted {dateTime(a.publishAt)}
              {a.expiresAt ? ` • Until ${dateTime(a.expiresAt)}` : ''}
            </p>
            <p className="mt-2 pre">{a.body}</p>
            {a.attachmentUrl && <img src={a.attachmentUrl} alt="Attachment" style={{ width: '100%', borderRadius: 14, marginTop: 14 }} />}
          </Card>
        )}
      </main>
    </>
  );
}

export function EmergencyPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['emergency'], queryFn: () => get('/emergency-contacts'), staleTime: 60 * 60_000 });
  return (
    <>
      <MobileHeader title="Emergency contacts" back />
      <main className="mobile-main stack">
        <div className="alert alert-error">
          <Siren size={18} /> In a life-threatening emergency, call 112 first.
        </div>
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <div className="card card-flush list">
            {data.contacts.map((c: any) => (
              <div key={c.id} className="list-item">
                <div className="grow">
                  <div className="strong">{c.name}</div>
                  <div className="xsmall muted">
                    {c.description}
                    {c.available_24x7 ? ' • 24×7' : ''}
                  </div>
                </div>
                <a className="btn btn-success" href={`tel:${c.phone}`} aria-label={`Call ${c.name}`}>
                  <Phone size={18} /> CALL
                </a>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export function MorePage() {
  const me = useSession();
  const logout = useLogout();
  const flat = me.flats[0];
  const items = [
    { to: '/app/profile', icon: User, label: 'My profile' },
    { to: '/app/complaints', icon: Wrench, label: 'Complaints' },
    { to: '/app/facilities', icon: CalendarDays, label: 'Facilities & bookings' },
    { to: '/app/visitors', icon: Users, label: 'Visitors' },
    { to: '/app/notifications', icon: Bell, label: 'Notifications' },
    { to: '/app/preferences', icon: Settings2, label: 'Notification settings' },
    { to: '/app/emergency', icon: Siren, label: 'Emergency contacts' },
    { to: '/app/search', icon: SearchIcon, label: 'Search' },
  ];
  return (
    <>
      <MobileHeader title="More" />
      <main className="mobile-main stack">
        <Link to="/app/profile" className="card card-link row">
          <Avatar name={me.user.fullName} src={me.user.photoUrl} size="lg" />
          <div className="grow">
            <div className="strong" style={{ fontSize: '1.1rem' }}>{me.user.fullName}</div>
            <div className="small muted">{flat ? `${flat.tower_name} • ${flat.number} • ${titleCase(flat.relation)}` : me.society?.name}</div>
          </div>
          <ChevronRight size={18} />
        </Link>
        <div className="card card-flush list">
          {items.map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to} className="list-item">
              <Icon size={20} className="muted" />
              <span className="grow">{label}</span>
              <ChevronRight size={18} className="muted" />
            </Link>
          ))}
        </div>
        {me.memberships.length > 1 && <RoleSwitcher />}
        <Button variant="secondary" onClick={logout}>
          <LogOut size={18} /> Sign out
        </Button>
        <p className="center xsmall muted">SocietyOne • One App. One Community. Everything Connected.</p>
      </main>
    </>
  );
}

export function RoleSwitcher() {
  const me = useSession();
  const qc = useQueryClient();
  const nav = useNavigate();
  const sw = useMutation({
    mutationFn: (m: any) => post('/auth/switch', { societyId: m.societyId, role: m.role }),
    onSuccess: async (r) => {
      await qc.invalidateQueries();
      nav(r.home);
    },
  });
  return (
    <Card title="Switch account">
      <div className="stack-sm">
        {me.memberships
          .filter((m) => !(m.role === me.role && m.societyId === (me.society?.id ?? null)))
          .map((m) => (
            <Button key={`${m.societyId}-${m.role}`} variant="secondary" onClick={() => sw.mutate(m)}>
              {m.societyName} — {titleCase(m.role)}
            </Button>
          ))}
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const me = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['profile'], queryFn: () => get('/profile') });
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  useEffect(() => {
    if (data) {
      setName(data.fullName);
      setEmail(data.email ?? '');
    }
  }, [data]);
  const save = useMutation({
    mutationFn: () => patch('/profile', { fullName: name, email }),
    onSuccess: () => {
      toast('Profile updated', 'success');
      qc.invalidateQueries({ queryKey: ['profile'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  const photo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('photo', await compressImage(file, 600), 'photo.jpg');
      return postForm('/profile/photo', fd);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    onError: (e: any) => toast(e.message, 'error'),
  });
  if (isLoading) return <Loading />;
  return (
    <>
      <MobileHeader title="My profile" back="/app/more" />
      <main className="mobile-main stack">
        <Card>
          <div className="row">
            <label style={{ position: 'relative', cursor: 'pointer' }}>
              <Avatar name={me.user.fullName} src={me.user.photoUrl} size="lg" />
              <span className="icon-btn" style={{ position: 'absolute', right: -6, bottom: -6, width: 30, height: 30 }}>
                <Camera size={14} />
              </span>
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && photo.mutate(e.target.files[0])} aria-label="Change photo" />
            </label>
            <div>
              <div className="strong" style={{ fontSize: '1.1rem' }}>{data.fullName}</div>
              <div className="small muted">{formatMobile(data.mobile)}</div>
            </div>
          </div>
        </Card>
        <Card title="Personal details">
          <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
            <Input label="Full name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160} />
            <Input label="Mobile" value={formatMobile(data.mobile)} disabled hint="To change your mobile number, contact the society office." />
            <Button loading={save.isPending}>Save changes</Button>
          </form>
        </Card>
        <Card title="Residence">
          {data.residency.map((r: any) => (
            <dl key={r.flat_number} className="kv">
              <dt>Society</dt>
              <dd>{data.societyName}</dd>
              <dt>Tower</dt>
              <dd>{r.tower_name}</dd>
              <dt>Flat</dt>
              <dd>{r.flat_number}</dd>
              <dt>Resident type</dt>
              <dd>{titleCase(r.relation)}</dd>
              <dt>Move-in date</dt>
              <dd>{r.move_in_date ? dateLong(r.move_in_date) : '—'}</dd>
            </dl>
          ))}
          <p className="xsmall muted mt-2">Only society administrators can change your tower or flat.</p>
        </Card>
      </main>
    </>
  );
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['notifications'], queryFn: () => get('/notifications?limit=50') });
  const readAll = useMutation({ mutationFn: () => post('/notifications/read-all'), onSuccess: () => (qc.invalidateQueries({ queryKey: ['notifications'] }), qc.invalidateQueries({ queryKey: ['notif-summary'] })) });
  const open = async (n: any) => {
    if (!n.read_at) await post(`/notifications/${n.id}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: ['notif-summary'] });
    qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.data?.url) nav(n.data.url);
  };
  return (
    <>
      <MobileHeader title="Notifications" back action={data?.unreadCount ? <Button size="sm" variant="ghost" onClick={() => readAll.mutate()}>Mark all read</Button> : undefined} />
      <main className="mobile-main">
        {isLoading ? (
          <Loading />
        ) : !data.notifications.length ? (
          <Empty icon={<Bell size={40} />} title="You’re all caught up" />
        ) : (
          <div className="card card-flush list">
            {data.notifications.map((n: any) => (
              <button key={n.id} className="list-item" onClick={() => open(n)} style={{ alignItems: 'flex-start', background: n.read_at ? undefined : 'var(--primary-soft)' }}>
                <span className={`icon-tile ${n.priority === 'emergency' ? 'qa-red' : 'qa-blue'}`}>
                  <Bell size={18} />
                </span>
                <div className="grow">
                  <div className="strong small">{n.title}</div>
                  <div className="small secondary">{n.body}</div>
                  <div className="xsmall muted">{relative(n.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

export function PreferencesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['prefs'], queryFn: () => get('/profile/notification-preferences') });
  const save = useMutation({
    mutationFn: (preferences: any[]) => put('/profile/notification-preferences', { preferences }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['prefs'] }), toast('Saved', 'success')),
  });
  const [pushState, setPushState] = useState<string>(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const enablePush = async () => {
    try {
      const cfg = await get('/profile/push-config');
      const perm = await Notification.requestPermission();
      setPushState(perm);
      if (perm !== 'granted' || !cfg.publicKey || !('serviceWorker' in navigator)) return;
      const reg = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(cfg.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await post('/profile/push-subscriptions', sub.toJSON());
      toast('Push notifications enabled', 'success');
    } catch (e: any) {
      toast(e.message ?? 'Could not enable push notifications', 'error');
    }
  };
  if (isLoading) return <Loading />;
  const prefs = data.preferences;
  const toggle = (cat: string, key: 'inApp' | 'push') => save.mutate(prefs.map((p: any) => (p.category === cat ? { ...p, [key]: !p[key] } : p)));
  return (
    <>
      <MobileHeader title="Notification settings" back="/app/more" />
      <main className="mobile-main stack">
        <Card title="Push notifications">
          <p className="small secondary">Get alerts on this phone even when the app is closed.</p>
          <Button className="mt-2" variant="soft" onClick={enablePush} disabled={pushState === 'granted' || pushState === 'unsupported'}>
            {pushState === 'granted' ? 'Enabled on this device' : pushState === 'unsupported' ? 'Not supported on this browser' : 'Enable on this device'}
          </Button>
        </Card>
        <div className="card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Category</th>
                <th>In-app</th>
                <th>Push</th>
              </tr>
            </thead>
            <tbody>
              {prefs.map((p: any) => (
                <tr key={p.category}>
                  <td className="strong">{titleCase(p.category)}</td>
                  <td>
                    <input type="checkbox" className="checkbox" checked={p.inApp} onChange={() => toggle(p.category, 'inApp')} aria-label={`${p.category} in-app`} />
                  </td>
                  <td>
                    <input type="checkbox" checked={p.push} onChange={() => toggle(p.category, 'push')} aria-label={`${p.category} push`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="xsmall muted">Emergency announcements and visitor approval requests are always delivered.</p>
      </main>
    </>
  );
}

export function SearchPage() {
  const [q, setQ] = useState('');
  const { data, isFetching } = useQuery({ queryKey: ['search', q], queryFn: () => get(`/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });
  const total = data ? Object.values(data).reduce((n: number, arr: any) => n + arr.length, 0) : 0;
  return (
    <>
      <MobileHeader title="Search" back />
      <main className="mobile-main stack">
        <SearchInput value={q} onChange={setQ} placeholder="Announcements, visitors, complaints, facilities" autoFocus />
        {isFetching && <Loading />}
        {data && total === 0 && <Empty title="No results" />}
        {data?.announcements?.length > 0 && (
          <Section title="Announcements">
            {data.announcements.map((a: any) => (
              <Link key={a.id} to={`/app/community/${a.id}`} className="list-item">
                <Megaphone size={18} className="muted" />
                <span className="grow">{a.title}</span>
              </Link>
            ))}
          </Section>
        )}
        {data?.complaints?.length > 0 && (
          <Section title="Complaints">
            {data.complaints.map((c: any) => (
              <Link key={c.id} to={`/app/complaints/${c.id}`} className="list-item">
                <Wrench size={18} className="muted" />
                <span className="grow">{c.title}</span>
                <StatusBadge status={c.status} />
              </Link>
            ))}
          </Section>
        )}
        {data?.visitors?.length > 0 && (
          <Section title="Visitor history">
            {data.visitors.map((v: any) => (
              <div key={v.id} className="list-item">
                <Users size={18} className="muted" />
                <span className="grow">{v.visitor_name}</span>
                <span className="xsmall muted">{dateLong(tsDay(v.checked_in_at))}</span>
              </div>
            ))}
          </Section>
        )}
        {data?.facilities?.length > 0 && (
          <Section title="Facilities">
            {data.facilities.map((f: any) => (
              <Link key={f.id} to={`/app/facilities/${f.id}`} className="list-item">
                <CalendarDays size={18} className="muted" />
                <span className="grow">{f.name}</span>
              </Link>
            ))}
          </Section>
        )}
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="xsmall strong muted" style={{ margin: '8px 0 6px' }}>
        {title.toUpperCase()}
      </div>
      <div className="card card-flush list">{children}</div>
    </section>
  );
}
