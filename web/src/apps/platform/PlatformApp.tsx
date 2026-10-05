import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ClipboardList, Gauge, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { get, patch, post, qs } from '../../lib/api';
import { useLogout, useSession } from '../../lib/session';
import { dateLong, dateTime, num, titleCase, tsDay } from '../../lib/format';
import { Badge, Brand, Button, Card, Empty, ErrorBox, Input, Loading, MobileInput, SearchInput, Select, Sheet, useToast } from '../../components/ui';
import { PageHead } from '../admin/AdminApp';

export default function PlatformApp() {
  const me = useSession();
  const logout = useLogout();
  return (
    <div className="admin-shell">
      <aside className="sidebar" aria-label="Platform navigation">
        <Brand />
        <div className="xsmall muted" style={{ padding: '0 12px 10px' }}>
          Platform administration
        </div>
        <NavLink to="/platform" end className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
          <Gauge size={19} /> Overview
        </NavLink>
        <NavLink to="/platform/societies" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
          <Building2 size={19} /> Societies
        </NavLink>
        <NavLink to="/platform/audit" className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
          <ClipboardList size={19} /> Audit
        </NavLink>
        <div className="grow" />
        <div className="alert alert-info xsmall" style={{ marginBottom: 10 }}>
          <ShieldCheck size={16} style={{ flex: 'none' }} /> Platform staff see society-level aggregates only. Resident data stays within each society.
        </div>
        <div className="card row" style={{ padding: 10 }}>
          <div className="grow small strong truncate">{me.user.fullName}</div>
          <button className="icon-btn" onClick={logout} aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <div className="admin-content">
          <Routes>
            <Route index element={<Overview />} />
            <Route path="societies" element={<Societies />} />
            <Route path="audit" element={<PlatformAudit />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const { data, isLoading } = useQuery({ queryKey: ['platform-stats'], queryFn: () => get('/platform/stats') });
  if (isLoading) return <Loading />;
  const cards = [
    ['Societies', data.societies, `${data.active_societies} active`],
    ['Flats', data.flats],
    ['Residents', data.residents],
    ['Security guards', data.guards],
    ['Visitor entries (30 days)', data.visitors_30d],
    ['Open complaints', data.open_complaints],
    ['Bookings (30 days)', data.bookings_30d],
  ];
  return (
    <>
      <PageHead title="SocietyOne Platform" sub="One App. One Community. Everything Connected." />
      <div className="stats-grid">
        {cards.map(([label, value, sub]) => (
          <Card key={label as string}>
            <div className="stat">
              <span className="stat-label">{label}</span>
              <span className="stat-value">{num(value as number)}</span>
              {sub && <span className="stat-sub">{sub}</span>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Societies() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['platform-societies', q], queryFn: () => get(`/platform/societies${qs({ q })}`) });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => patch(`/platform/societies/${id}`, body),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['platform-societies'] }), toast('Society updated', 'success')),
  });
  return (
    <>
      <PageHead
        title="Societies"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={18} /> Onboard society
          </Button>
        }
      />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Name, city or code" />
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.societies.length ? (
          <Empty title="No societies" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Society</th>
                  <th>City</th>
                  <th>Towers / Flats</th>
                  <th>Residents</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.societies.map((s: any) => (
                  <tr key={s.id}>
                    <td>
                      <div className="strong">{s.name}</div>
                      <div className="xsmall muted mono">
                        {s.code} • since {dateLong(tsDay(s.created_at))}
                      </div>
                    </td>
                    <td>{s.city}, {s.state}</td>
                    <td>
                      {s.towers} / {num(s.flats)}
                    </td>
                    <td>{num(s.residents)}</td>
                    <td>
                      <select className="select" style={{ minHeight: 34, padding: '4px 8px' }} value={s.plan ?? 'trial'} onChange={(e) => update.mutate({ id: s.id, body: { plan: e.target.value, subscriptionStatus: e.target.value === 'trial' ? 'trial' : 'active' } })} aria-label="Plan">
                        <option value="trial">Trial</option>
                        <option value="standard">Standard</option>
                        <option value="premium">Premium</option>
                      </select>
                      <div className="xsmall muted">
                        {titleCase(s.subscription_status)}
                        {s.ends_on ? ` • until ${dateLong(s.ends_on)}` : ''}
                      </div>
                    </td>
                    <td>
                      <Badge tone={s.status === 'active' ? 'success' : 'danger'}>{titleCase(s.status)}</Badge>
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={s.status === 'active' ? 'secondary' : 'success'}
                        onClick={() => window.confirm(`${s.status === 'active' ? 'Deactivate' : 'Activate'} ${s.name}?${s.status === 'active' ? ' All its users will be signed out.' : ''}`) && update.mutate({ id: s.id, body: { status: s.status === 'active' ? 'inactive' : 'active' } })}
                      >
                        {s.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <CreateSocietySheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function CreateSocietySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', addressLine1: '', city: 'Hyderabad', state: 'Telangana', pinCode: '', plan: 'trial', admin: { fullName: '', email: '', mobile: '' } });
  const [result, setResult] = useState<any>(null);
  const create = useMutation({
    mutationFn: () => post('/platform/societies', { ...f, admin: { ...f.admin, mobile: f.admin.mobile.replace(/\s/g, '') } }),
    onSuccess: (r) => (setResult(r), qc.invalidateQueries({ queryKey: ['platform-societies'] }), qc.invalidateQueries({ queryKey: ['platform-stats'] })),
  });
  const close = () => (setResult(null), onClose());
  return (
    <Sheet open={open} onClose={close} title="Onboard a society" wide>
      {result ? (
        <div className="stack">
          <div className="alert alert-success">{result.message}</div>
          {result.demoInviteLink && (
            <p className="small">
              Demo mode — admin password setup link: <a href={result.demoInviteLink}>{result.demoInviteLink.slice(0, 48)}…</a>
            </p>
          )}
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <div className="grid-2">
            <Input label="Society name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <Input label="Short code" placeholder="e.g. MYHOME" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} required maxLength={12} />
          </div>
          <Input label="Address" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
          <div className="grid-3">
            <Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required />
            <Input label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} required />
            <Input label="PIN code" value={f.pinCode} inputMode="numeric" maxLength={6} onChange={(e) => setF({ ...f, pinCode: e.target.value.replace(/\D/g, '') })} required />
          </div>
          <Select label="Plan" value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
          </Select>
          <h3 className="mt-1">Initial society administrator</h3>
          <div className="grid-2">
            <Input label="Full name" value={f.admin.fullName} onChange={(e) => setF({ ...f, admin: { ...f.admin, fullName: e.target.value } })} required />
            <Input label="Email" type="email" value={f.admin.email} onChange={(e) => setF({ ...f, admin: { ...f.admin, email: e.target.value } })} required />
          </div>
          <MobileInput value={f.admin.mobile} onChange={(v) => setF({ ...f, admin: { ...f.admin, mobile: v } })} />
          <ErrorBox error={create.error} />
          <Button size="lg" loading={create.isPending}>
            Create society
          </Button>
        </form>
      )}
    </Sheet>
  );
}

function PlatformAudit() {
  const { data, isLoading } = useQuery({ queryKey: ['platform-audit'], queryFn: () => get('/platform/audit') });
  if (isLoading) return <Loading />;
  return (
    <>
      <PageHead title="Audit" sub="Platform actions in full; in-society activity as counts only" />
      <div className="dash-grid">
        <Card title="Platform actions" className="card-flush" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>By</th>
                  <th>Action</th>
                  <th>Society</th>
                </tr>
              </thead>
              <tbody>
                {data.platform.map((l: any) => (
                  <tr key={l.id}>
                    <td className="small">{dateTime(l.created_at)}</td>
                    <td className="small">{l.actor_name}</td>
                    <td className="mono small">{l.action}</td>
                    <td className="small">{l.society_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Society activity (30 days)" className="card-flush" style={{ padding: 0 }}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Society</th>
                  <th>Action</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.map((a: any, i: number) => (
                  <tr key={i}>
                    <td className="small">{a.society_name}</td>
                    <td className="mono small">{a.action}</td>
                    <td>{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
