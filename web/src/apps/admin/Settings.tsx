import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DoorOpen, Layers, Plus, Upload, Users } from 'lucide-react';
import { del, get, patch, post, postForm, qs } from '../../lib/api';
import { useSession } from '../../lib/session';
import { dateTime, formatMobile, titleCase } from '../../lib/format';
import { compressImage } from '../../lib/image';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, MobileInput, Pager, SearchInput, Segmented, Select, useToast } from '../../components/ui';
import { PageHead } from './AdminApp';
import { useTowers } from './People';

export function SettingsPage() {
  const me = useSession();
  const [tab, setTab] = useState<'society' | 'structure' | 'gates' | 'staff'>('society');
  return (
    <>
      <PageHead title="Settings" sub="Society profile, structure, gates and management team" />
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'society', label: <span className="row" style={{ gap: 6 }}><Building2 size={15} /> Society</span> },
            { value: 'structure', label: <span className="row" style={{ gap: 6 }}><Layers size={15} /> Towers & flats</span> },
            { value: 'gates', label: <span className="row" style={{ gap: 6 }}><DoorOpen size={15} /> Gates</span> },
            { value: 'staff', label: <span className="row" style={{ gap: 6 }}><Users size={15} /> Management team</span> },
          ]}
        />
      </div>
      {tab === 'society' && <SocietySettings canEdit={me.role === 'admin'} />}
      {tab === 'structure' && <StructureSettings />}
      {tab === 'gates' && <GateSettings />}
      {tab === 'staff' && <StaffSettings canEdit={me.role === 'admin'} />}
    </>
  );
}

function SocietySettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['society'], queryFn: () => get('/society') });
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    if (data)
      setF({
        name: data.name, addressLine1: data.address_line1 ?? '', addressLine2: data.address_line2 ?? '', city: data.city, state: data.state, pinCode: data.pin_code ?? '',
        contactPhone: data.contact_phone?.replace('+91', '') ?? '', contactEmail: data.contact_email ?? '', settings: data.settings,
      });
  }, [data]);
  const save = useMutation({
    mutationFn: () => patch('/society', { ...f, contactPhone: f.contactPhone ? f.contactPhone.replace(/\s/g, '') : null, contactEmail: f.contactEmail || null }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['society'] }), qc.invalidateQueries({ queryKey: ['me'] }), toast('Society details saved', 'success')),
  });
  const logo = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('logo', await compressImage(file, 512), 'logo.jpg');
      return postForm('/society/logo', fd);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['society'] }), toast('Logo updated', 'success')),
    onError: (e: any) => toast(e.message, 'error'),
  });
  if (isLoading || !f) return <Loading />;
  return (
    <div className="dash-grid">
      <Card title="Society profile">
        <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
            <Input label="Society name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            <Input label="Address line 1" value={f.addressLine1} onChange={(e) => setF({ ...f, addressLine1: e.target.value })} />
            <Input label="Address line 2" value={f.addressLine2} onChange={(e) => setF({ ...f, addressLine2: e.target.value })} />
            <div className="grid-3">
              <Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required />
              <Input label="State" value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })} required />
              <Input label="PIN code" inputMode="numeric" maxLength={6} value={f.pinCode} onChange={(e) => setF({ ...f, pinCode: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="grid-2">
              <MobileInput label="Contact number" value={f.contactPhone} onChange={(v) => setF({ ...f, contactPhone: v })} />
              <Input label="Email" type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} />
            </div>
            <ErrorBox error={save.error} />
            {canEdit && <Button loading={save.isPending}>Save changes</Button>}
          </fieldset>
          {!canEdit && <p className="xsmall muted">Only society administrators can edit these details.</p>}
        </form>
      </Card>
      <div className="stack">
        <Card title="Logo">
          <div className="row">
            {data.logo_url ? <img src={data.logo_url} alt="Society logo" style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover', border: '1px solid var(--border)' }} /> : <span className="avatar avatar-lg"><Building2 /></span>}
            {canEdit && (
              <label className="btn btn-secondary">
                <Upload size={16} /> Upload logo
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
              </label>
            )}
          </div>
        </Card>
        <Card title="Gate policies">
          <div className="stack">
            <label className="checkbox">
              <input type="checkbox" disabled={!canEdit} checked={!!f.settings.deliveryRequiresApproval} onChange={(e) => setF({ ...f, settings: { ...f.settings, deliveryRequiresApproval: e.target.checked } })} />
              Deliveries need resident approval before entry
            </label>
            <label className="checkbox">
              <input type="checkbox" disabled={!canEdit} checked={f.settings.allowRecurringVisitors !== false} onChange={(e) => setF({ ...f, settings: { ...f.settings, allowRecurringVisitors: e.target.checked } })} />
              Allow recurring visitor passes
            </label>
            <Input label="Approval request timeout (minutes)" type="number" min={2} max={60} disabled={!canEdit} value={f.settings.approvalTimeoutMinutes ?? 15} onChange={(e) => setF({ ...f, settings: { ...f.settings, approvalTimeoutMinutes: Number(e.target.value) } })} />
            {canEdit && (
              <Button variant="secondary" onClick={() => save.mutate()} loading={save.isPending}>
                Save policies
              </Button>
            )}
          </div>
        </Card>
        <Card>
          <dl className="kv small">
            <dt>Society code</dt>
            <dd className="mono">{data.code}</dd>
            <dt>Complaint prefix</dt>
            <dd className="mono">{data.complaint_prefix}-INC-</dd>
            <dt>Time zone</dt>
            <dd>{data.timezone}</dd>
            <dt>Towers / flats / gates</dt>
            <dd>
              {data.counts.towers} / {data.counts.flats} / {data.counts.gates}
            </dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}

function StructureSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const towers = useTowers();
  const [t, setT] = useState({ name: '', code: '', floorFrom: 1, floorTo: 20 });
  const [b, setB] = useState({ towerId: '', floorFrom: 1, floorTo: 20, flatsPerFloor: 8, flatType: '2BHK' });
  const refresh = () => (qc.invalidateQueries({ queryKey: ['towers'] }), qc.invalidateQueries({ queryKey: ['flats'] }));
  const addTower = useMutation({ mutationFn: () => post('/structure/towers', t), onSuccess: (r) => (refresh(), toast(`${r.name} created`, 'success'), setB({ ...b, towerId: r.id, floorFrom: t.floorFrom, floorTo: t.floorTo }), setT({ name: '', code: '', floorFrom: 1, floorTo: 20 })) });
  const bulk = useMutation({ mutationFn: () => post('/structure/flats/bulk', b), onSuccess: (r) => (refresh(), toast(r.created ? `${r.created} flats created` : 'All these flats already exist', 'success')) });
  const removeTower = useMutation({ mutationFn: (id: string) => del(`/structure/towers/${id}`), onSuccess: () => (refresh(), toast('Tower deleted', 'success')), onError: (e: any) => toast(e.message, 'error') });
  const tower = towers.data?.towers.find((x: any) => x.id === b.towerId);
  const preview = tower ? `${tower.code}-${b.floorFrom}01 … ${tower.code}-${b.floorTo}${String(b.flatsPerFloor).padStart(2, '0')}` : '';
  return (
    <div className="dash-grid">
      <Card title="Towers / blocks" className="card-flush" style={{ padding: 0 }}>
        {towers.isLoading ? (
          <Loading />
        ) : !towers.data.towers.length ? (
          <Empty title="No towers yet" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Tower</th>
                <th>Code</th>
                <th>Floors</th>
                <th>Flats</th>
                <th>Occupied</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {towers.data.towers.map((x: any) => (
                <tr key={x.id}>
                  <td className="strong">{x.name}</td>
                  <td className="mono">{x.code}</td>
                  <td>{x.floors ? `${x.floor_min}–${x.floor_max}` : '—'}</td>
                  <td>{x.flats}</td>
                  <td>{x.flats ? `${Math.round((x.occupied / x.flats) * 100)}%` : '—'}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => window.confirm(`Delete ${x.name} and all its flats?`) && removeTower.mutate(x.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="stack">
        <Card title="Add tower">
          <form className="stack" onSubmit={(e) => (e.preventDefault(), addTower.mutate())}>
            <div className="grid-2">
              <Input label="Name" placeholder="Tower E" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} required />
              <Input label="Code" placeholder="E" value={t.code} onChange={(e) => setT({ ...t, code: e.target.value.toUpperCase() })} required maxLength={8} />
            </div>
            <div className="grid-2">
              <Input label="First floor" type="number" value={t.floorFrom} onChange={(e) => setT({ ...t, floorFrom: Number(e.target.value) })} />
              <Input label="Last floor" type="number" value={t.floorTo} onChange={(e) => setT({ ...t, floorTo: Number(e.target.value) })} />
            </div>
            <ErrorBox error={addTower.error} />
            <Button loading={addTower.isPending}>
              <Plus size={16} /> Create tower
            </Button>
          </form>
        </Card>
        <Card title="Bulk-create flats">
          <form className="stack" onSubmit={(e) => (e.preventDefault(), bulk.mutate())}>
            <Select label="Tower" value={b.towerId} onChange={(e) => setB({ ...b, towerId: e.target.value })} required>
              <option value="">Choose tower</option>
              {towers.data?.towers.map((x: any) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <div className="grid-3">
              <Input label="Floors from" type="number" value={b.floorFrom} onChange={(e) => setB({ ...b, floorFrom: Number(e.target.value) })} />
              <Input label="to" type="number" value={b.floorTo} onChange={(e) => setB({ ...b, floorTo: Number(e.target.value) })} />
              <Input label="Flats / floor" type="number" min={1} max={40} value={b.flatsPerFloor} onChange={(e) => setB({ ...b, flatsPerFloor: Number(e.target.value) })} />
            </div>
            <Input label="Flat type" value={b.flatType} onChange={(e) => setB({ ...b, flatType: e.target.value })} />
            {preview && (
              <p className="small secondary">
                Creates <strong>{(b.floorTo - b.floorFrom + 1) * b.flatsPerFloor}</strong> flats: <span className="mono">{preview}</span>. Existing flats are skipped.
              </p>
            )}
            <ErrorBox error={bulk.error} />
            <Button loading={bulk.isPending} disabled={!b.towerId}>
              Create flats
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function GateSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['gates'], queryFn: () => get('/society/gates') });
  const add = useMutation({ mutationFn: () => post('/society/gates', { name }), onSuccess: () => (setName(''), qc.invalidateQueries({ queryKey: ['gates'] }), toast('Gate added', 'success')) });
  const toggle = useMutation({ mutationFn: (g: any) => patch(`/society/gates/${g.id}`, { isActive: !g.is_active }), onSuccess: () => qc.invalidateQueries({ queryKey: ['gates'] }) });
  return (
    <div className="dash-grid">
      <Card className="card-flush" style={{ padding: 0 }}>
        {isLoading ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Gate</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.gates.map((g: any) => (
                <tr key={g.id}>
                  <td className="strong">{g.name}</td>
                  <td>
                    <Badge tone={g.is_active ? 'success' : ''}>{g.is_active ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => toggle.mutate(g)}>
                      {g.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Add gate">
        <form className="stack" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
          <Input label="Gate name" placeholder="Gate 3 (Service)" value={name} onChange={(e) => setName(e.target.value)} required />
          <ErrorBox error={add.error} />
          <Button loading={add.isPending}>Add gate</Button>
        </form>
      </Card>
    </div>
  );
}

function StaffSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['staff'], queryFn: () => get('/society/staff') });
  const [f, setF] = useState({ fullName: '', mobile: '', email: '', role: 'facility_manager' });
  const add = useMutation({ mutationFn: () => post('/society/staff', { ...f, mobile: f.mobile.replace(/\s/g, ''), email: f.email || null }), onSuccess: () => (qc.invalidateQueries({ queryKey: ['staff'] }), toast('Team member added', 'success'), setF({ fullName: '', mobile: '', email: '', role: 'facility_manager' })) });
  const remove = useMutation({ mutationFn: (id: string) => del(`/society/staff/${id}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['staff'] }), toast('Access removed', 'success')), onError: (e: any) => toast(e.message, 'error') });
  return (
    <div className="dash-grid">
      <Card className="card-flush" style={{ padding: 0 }}>
        {isLoading ? (
          <Loading />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Contact</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s: any) => (
                <tr key={s.id}>
                  <td className="strong">{s.full_name}</td>
                  <td>{titleCase(s.role)}</td>
                  <td className="small">
                    {formatMobile(s.mobile)}
                    <div className="xsmall muted">{s.email}</div>
                  </td>
                  <td>
                    <Badge tone={s.status === 'active' ? 'success' : ''}>{titleCase(s.status)}</Badge>
                  </td>
                  <td>
                    {canEdit && s.status === 'active' && (
                      <Button size="sm" variant="ghost" onClick={() => window.confirm(`Remove ${s.full_name}'s access?`) && remove.mutate(s.id)}>
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {canEdit && (
        <Card title="Add team member">
          <form className="stack" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
            <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
            <MobileInput value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} />
            <Input label="Email (for password login)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
            <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="facility_manager">Facility Manager</option>
              <option value="admin">Society Admin</option>
            </Select>
            <ErrorBox error={add.error} />
            <Button loading={add.isPending}>Add member</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Audit log (read-only)
// ============================================================================
export function AuditPage() {
  const [q, setQ] = useState('');
  const [actorRole, setActorRole] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', q, actorRole, entityType, from, to, page],
    queryFn: () => get(`/audit${qs({ q, actorRole, entityType, from, to, page, pageSize: 40 })}`),
    placeholderData: (p) => p,
  });
  return (
    <>
      <PageHead title="Audit Log" sub="Tamper-proof record of administrative and security actions. Entries cannot be edited or deleted." />
      <div className="filters">
        <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Person, action or summary" />
        <select className="select" value={actorRole} onChange={(e) => (setActorRole(e.target.value), setPage(1))} aria-label="Role">
          <option value="">All roles</option>
          {['admin', 'facility_manager', 'guard', 'resident', 'super_admin'].map((r) => (
            <option key={r} value={r}>
              {titleCase(r)}
            </option>
          ))}
        </select>
        <select className="select" value={entityType} onChange={(e) => (setEntityType(e.target.value), setPage(1))} aria-label="Record type">
          <option value="">All records</option>
          {['complaint', 'visitor_entry', 'visitor_invite', 'visitor_approval', 'resident', 'security_guard', 'facility', 'facility_booking', 'announcement', 'society', 'flat', 'tower', 'user'].map((r) => (
            <option key={r} value={r}>
              {titleCase(r)}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} aria-label="From" />
        <input className="input" type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} aria-label="To" />
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Action</th>
                    <th>Record</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((l: any) => (
                    <>
                      <tr key={l.id} className="clickable" onClick={() => setOpen(open === l.id ? null : l.id)}>
                        <td className="small">{dateTime(l.created_at)}</td>
                        <td className="strong small">{l.actor_name ?? 'System'}</td>
                        <td className="small">{l.actor_role ? titleCase(l.actor_role) : '—'}</td>
                        <td className="mono small">{l.action}</td>
                        <td className="small">
                          {titleCase(l.entity_type)}
                          {l.summary && <div className="xsmall muted">{l.summary}</div>}
                        </td>
                        <td className="xsmall muted">{l.ip ?? '—'}</td>
                      </tr>
                      {open === l.id && (
                        <tr key={`${l.id}-d`}>
                          <td colSpan={6} style={{ background: 'var(--surface-2)' }}>
                            <div className="grid-2">
                              <div>
                                <div className="xsmall strong muted">PREVIOUS VALUE</div>
                                <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.old_values ? JSON.stringify(l.old_values, null, 2) : '—'}</pre>
                              </div>
                              <div>
                                <div className="xsmall strong muted">NEW VALUE</div>
                                <pre className="small mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.new_values ? JSON.stringify(l.new_values, null, 2) : '—'}</pre>
                              </div>
                            </div>
                            <div className="xsmall muted mt-1">{l.user_agent}</div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={40} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
