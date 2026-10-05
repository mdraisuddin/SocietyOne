import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Lock, Megaphone, Pencil, Phone, Plus, Siren, Trash2 } from 'lucide-react';
import { del, get, patch, post, postForm, qs } from '../../lib/api';
import { CATEGORY_LABEL, COMPLAINT_STATUS, clock, dateLong, dateTime, dayLabel, relative, timeRange, titleCase, todayISO, tsDay } from '../../lib/format';
import { compressImage } from '../../lib/image';
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, Pager, PriorityBadge, SearchInput, Segmented, Select, Sheet, StatusBadge, Textarea, useToast } from '../../components/ui';
import { PageHead } from './AdminApp';
import { useTowers } from './People';

// ============================================================================
// Visitors
// ============================================================================
export function VisitorsAdminPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [towerId, setTowerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const towers = useTowers();
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-visitors', q, category, status, towerId, from, to, page],
    queryFn: () => get(`/visitors/admin/entries${qs({ q, category, status, towerId, from, to, page, pageSize: 30 })}`),
    placeholderData: (p) => p,
    refetchInterval: 30_000,
  });
  const r = (fn: () => void) => (fn(), setPage(1));
  return (
    <>
      <PageHead title="Visitors" sub="Complete gate log — guests, deliveries, cabs and staff" />
      <div className="filters">
        <SearchInput value={q} onChange={(v) => r(() => setQ(v))} placeholder="Name, mobile, flat, vehicle or provider" />
        <select className="select" value={category} onChange={(e) => r(() => setCategory(e.target.value))} aria-label="Type">
          <option value="">All types</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select className="select" value={status} onChange={(e) => r(() => setStatus(e.target.value))} aria-label="Status">
          <option value="">Any status</option>
          <option value="inside">Inside now</option>
          <option value="checked_out">Checked out</option>
          <option value="left_at_gate">Left at gate</option>
        </select>
        <select className="select" value={towerId} onChange={(e) => r(() => setTowerId(e.target.value))} aria-label="Tower">
          <option value="">All towers</option>
          {towers.data?.towers.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={from} onChange={(e) => r(() => setFrom(e.target.value))} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => r(() => setTo(e.target.value))} aria-label="To date" />
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.entries.length ? (
          <Empty title="No visitor entries match" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Visitor</th>
                    <th>Type</th>
                    <th>Flat</th>
                    <th>Entry</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Gate / Guard</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e: any) => (
                    <tr key={e.id}>
                      <td>
                        <div className="strong">{e.visitor_name}</div>
                        <div className="xsmall muted">{[e.vehicle_number, e.guest_count > 1 ? `${e.guest_count} people` : null].filter(Boolean).join(' • ')}</div>
                      </td>
                      <td>{CATEGORY_LABEL[e.category]}</td>
                      <td>{e.flat_number ?? '—'}</td>
                      <td>
                        <Badge tone={e.entry_type === 'pre_approved' ? 'success' : e.entry_type === 'approved_at_gate' ? 'info' : ''}>{e.entry_type === 'pre_approved' ? 'Pre-approved' : e.entry_type === 'approved_at_gate' ? 'Approved at gate' : 'Walk-in'}</Badge>
                      </td>
                      <td className="small">
                        {dayLabel(tsDay(e.checked_in_at))}, {clock(e.checked_in_at)}
                      </td>
                      <td className="small">{e.status === 'inside' ? <Badge tone="success">Inside</Badge> : e.status === 'left_at_gate' ? 'At gate' : clock(e.checked_out_at)}</td>
                      <td className="small">
                        {e.gate_name}
                        <div className="xsmall muted">{e.guard_name}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={30} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

// ============================================================================
// Complaints
// ============================================================================
export function ComplaintsAdminPage() {
  const nav = useNavigate();
  const [status, setStatus] = useState('open,assigned,in_progress');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [towerId, setTowerId] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const towers = useTowers();
  const meta = useQuery({ queryKey: ['complaint-meta'], queryFn: () => get('/complaints/meta'), staleTime: Infinity });
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-complaints', status, q, category, priority, towerId, sort, page],
    queryFn: () => get(`/complaints${qs({ status, q, category, priority, towerId, sort, page, pageSize: 25 })}`),
    placeholderData: (p) => p,
    refetchInterval: 30_000,
  });
  const sc = data?.statusCounts ?? {};
  const active = (sc.open ?? 0) + (sc.assigned ?? 0) + (sc.in_progress ?? 0);
  const r = (fn: () => void) => (fn(), setPage(1));
  return (
    <>
      <PageHead title="Complaints" sub="Assign, track and resolve resident service requests" />
      <div style={{ marginBottom: 14 }}>
        <Segmented
          label="Status"
          value={status}
          onChange={(v) => r(() => setStatus(v))}
          options={[
            { value: 'open,assigned,in_progress', label: `Active (${active})` },
            { value: 'open', label: `Open (${sc.open ?? 0})` },
            { value: 'assigned', label: `Assigned (${sc.assigned ?? 0})` },
            { value: 'in_progress', label: `In progress (${sc.in_progress ?? 0})` },
            { value: 'resolved', label: `Resolved (${sc.resolved ?? 0})` },
            { value: 'closed', label: `Closed (${sc.closed ?? 0})` },
            { value: '', label: 'All' },
          ]}
        />
      </div>
      <div className="filters">
        <SearchInput value={q} onChange={(v) => r(() => setQ(v))} placeholder="Ticket, title, description or flat" />
        <select className="select" value={category} onChange={(e) => r(() => setCategory(e.target.value))} aria-label="Category">
          <option value="">All categories</option>
          {Object.keys(meta.data?.categories ?? {}).map((c) => (
            <option key={c} value={c}>
              {titleCase(c)}
            </option>
          ))}
        </select>
        <select className="select" value={priority} onChange={(e) => r(() => setPriority(e.target.value))} aria-label="Priority">
          <option value="">Any priority</option>
          {['urgent', 'high', 'medium', 'low'].map((p) => (
            <option key={p} value={p}>
              {titleCase(p)}
            </option>
          ))}
        </select>
        <select className="select" value={towerId} onChange={(e) => r(() => setTowerId(e.target.value))} aria-label="Tower">
          <option value="">All towers</option>
          {towers.data?.towers.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="priority">Highest priority</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.complaints.length ? (
          <Empty title="No complaints match" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Complaint</th>
                    <th>Flat</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned to</th>
                    <th>Raised</th>
                  </tr>
                </thead>
                <tbody>
                  {data.complaints.map((c: any) => (
                    <tr key={c.id} className="clickable" onClick={() => nav(`/admin/complaints/${c.id}`)}>
                      <td className="mono small">{c.number}</td>
                      <td>
                        <div className="strong">{c.title}</div>
                        <div className="xsmall muted">
                          {titleCase(c.category)}
                          {c.subcategory ? ` • ${c.subcategory}` : ''}
                          {c.photos ? ` • ${c.photos} photo${c.photos > 1 ? 's' : ''}` : ''}
                        </div>
                      </td>
                      <td>{c.flat_number ?? '—'}</td>
                      <td>
                        <PriorityBadge priority={c.priority} />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <StatusBadge status={c.status} />
                          {c.overdue && <AlertTriangle size={16} color="var(--danger)" aria-label="Past target resolution time" />}
                        </div>
                      </td>
                      <td className="small">{c.assignee_name ?? c.assigned_to_name ?? '—'}</td>
                      <td className="small">{relative(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

const NEXT_ACTIONS: Record<string, { to: string; label: string; variant?: any }[]> = {
  open: [{ to: 'in_progress', label: 'Start work' }, { to: 'resolved', label: 'Mark resolved', variant: 'success' }],
  assigned: [{ to: 'in_progress', label: 'Start work' }, { to: 'resolved', label: 'Mark resolved', variant: 'success' }],
  in_progress: [{ to: 'resolved', label: 'Mark resolved', variant: 'success' }],
  resolved: [{ to: 'closed', label: 'Close ticket', variant: 'secondary' }, { to: 'in_progress', label: 'Back to in progress', variant: 'secondary' }],
  closed: [{ to: 'in_progress', label: 'Reopen', variant: 'secondary' }],
};

export function ComplaintAdminDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-complaint', id], queryFn: () => get(`/complaints/${id}`) });
  const meta = useQuery({ queryKey: ['complaint-meta'], queryFn: () => get('/complaints/meta'), staleTime: Infinity });
  const [assignee, setAssignee] = useState('');
  const [tech, setTech] = useState('');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'internal'>('public');
  useEffect(() => {
    if (data) {
      setAssignee(data.complaint.assigned_to ?? '');
      setTech(data.complaint.assignee_name ?? '');
    }
  }, [data]);
  const update = useMutation({
    mutationFn: (body: any) => patch(`/complaints/${id}`, body),
    onSuccess: () => {
      toast('Complaint updated — resident notified', 'success');
      setNote('');
      qc.invalidateQueries({ queryKey: ['admin-complaint', id] });
      qc.invalidateQueries({ queryKey: ['admin-complaints'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const c = data.complaint;
  const mainPhotos = data.attachments.filter((a: any) => !a.commentId);
  return (
    <>
      <Link to="/admin/complaints" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={16} /> All complaints
      </Link>
      <PageHead
        title={c.title}
        sub={
          <>
            <span className="mono">{c.number}</span> • {c.flat_number ?? 'Common area'} • Raised by {c.raised_by_name} • {dateTime(c.created_at)}
          </>
        }
        actions={
          <div className="row-wrap">
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
            {c.overdue && <Badge tone="danger" icon={<AlertTriangle size={12} />}>Past target time</Badge>}
          </div>
        }
      />
      <div className="dash-grid">
        <div className="stack">
          <Card>
            <div className="row-wrap" style={{ marginBottom: 8 }}>
              <Badge>{titleCase(c.category)}</Badge>
              {c.subcategory && <Badge>{c.subcategory}</Badge>}
              {c.location && <Badge>{c.location}</Badge>}
            </div>
            <p className="pre">{c.description}</p>
            {mainPhotos.length > 0 && (
              <div className="photo-row mt-2">
                {mainPhotos.map((p: any) => (
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img className="photo-thumb" style={{ width: 120, height: 120 }} src={p.url} alt="Complaint photo" />
                  </a>
                ))}
              </div>
            )}
            {c.rating && (
              <p className="mt-2">
                Resident rating: <strong style={{ color: '#c88a00' }}>{'★'.repeat(c.rating)}</strong> {c.rating_feedback && <span className="secondary">“{c.rating_feedback}”</span>}
              </p>
            )}
          </Card>
          <Card title="Activity">
            <div className="timeline">
              {[...data.history.map((h: any) => ({ kind: 'h', at: h.created_at, h })), ...data.comments.map((cm: any) => ({ kind: 'c', at: cm.created_at, cm }))]
                .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
                .map((item: any, i: number) =>
                  item.kind === 'h' ? (
                    <div key={`h${i}`} className="tl-item done">
                      <div className="small">
                        <strong>{COMPLAINT_STATUS[item.h.to_status]?.label}</strong> {item.h.changed_by_name && <span className="muted">by {item.h.changed_by_name}</span>}
                      </div>
                      {item.h.note && <div className="small secondary">{item.h.note}</div>}
                      <div className="xsmall muted">{dateTime(item.h.created_at)}</div>
                    </div>
                  ) : (
                    <div key={item.cm.id} className={`tl-item ${item.cm.visibility === 'internal' ? 'internal' : 'done'}`}>
                      <div className="small">
                        <strong>{item.cm.author_name}</strong>{' '}
                        {item.cm.visibility === 'internal' && (
                          <Badge tone="warning" icon={<Lock size={11} />}>
                            Internal note
                          </Badge>
                        )}
                      </div>
                      <div className="small pre">{item.cm.body}</div>
                      <div className="photo-row">
                        {data.attachments
                          .filter((a: any) => a.commentId === item.cm.id)
                          .map((p: any) => (
                            <img key={p.id} className="photo-thumb" src={p.url} alt="" />
                          ))}
                      </div>
                      <div className="xsmall muted">{dateTime(item.cm.created_at)}</div>
                    </div>
                  ),
                )}
            </div>
          </Card>
        </div>
        <div className="stack">
          <Card title="Assignment">
            <div className="stack">
              <Select label="Responsible staff" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">— Unassigned —</option>
                {meta.data?.staff.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name} ({titleCase(s.role)})
                  </option>
                ))}
              </Select>
              <Input label="Technician / vendor" placeholder="e.g. Ramu (Plumber)" value={tech} onChange={(e) => setTech(e.target.value)} />
              <Button onClick={() => update.mutate({ assignedTo: assignee || null, assigneeName: tech || null })} loading={update.isPending} disabled={!assignee && !tech}>
                Save assignment
              </Button>
            </div>
          </Card>
          <Card title="Status & priority">
            <div className="stack">
              <div className="row-wrap">
                {NEXT_ACTIONS[c.status]?.map((a) => (
                  <Button key={a.to} variant={a.variant} onClick={() => update.mutate({ status: a.to, note: note || null, noteVisibility: visibility })} loading={update.isPending}>
                    {a.label}
                  </Button>
                ))}
              </div>
              <Select label="Priority" value={c.priority} onChange={(e) => update.mutate({ priority: e.target.value })}>
                {['low', 'medium', 'high', 'urgent'].map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </Select>
              <dl className="kv small">
                <dt>Created</dt>
                <dd>{dateTime(c.created_at)}</dd>
                <dt>Assigned</dt>
                <dd>{c.assigned_at ? dateTime(c.assigned_at) : '—'}</dd>
                <dt>Resolved</dt>
                <dd>{c.resolved_at ? dateTime(c.resolved_at) : '—'}</dd>
                <dt>Closed</dt>
                <dd>{c.closed_at ? dateTime(c.closed_at) : '—'}</dd>
                <dt>Target resolution</dt>
                <dd>{c.resolution_due_at ? dateTime(c.resolution_due_at) : '—'}</dd>
                {c.reopen_count > 0 && (
                  <>
                    <dt>Reopened</dt>
                    <dd>{c.reopen_count}×</dd>
                  </>
                )}
              </dl>
            </div>
          </Card>
          <Card title="Add note">
            <div className="stack">
              <Segmented value={visibility} onChange={setVisibility} options={[{ value: 'public', label: 'Visible to resident' }, { value: 'internal', label: 'Internal only' }]} />
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={visibility === 'internal' ? 'Only management can see this' : 'The resident will be notified'} aria-label="Note" />
              <Button variant="secondary" onClick={() => update.mutate({ note, noteVisibility: visibility })} disabled={!note.trim()} loading={update.isPending}>
                Add note
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

// ============================================================================
// Facilities
// ============================================================================
const EMPTY_FACILITY = { name: '', description: '', location: '', openTime: '06:00', closeTime: '22:00', slotDurationMinutes: 60, maxBookingMinutes: 60, capacity: 4, maxConcurrentBookings: 1, advanceBookingDays: 7, cancellationCutoffMinutes: 60, maxBookingsPerFlatPerDay: 1, rules: '', isActive: true };

export function FacilitiesAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<any>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ['facilities'], queryFn: () => get('/facilities') });
  const toggle = useMutation({
    mutationFn: (f: any) => patch(`/facilities/${f.id}`, { isActive: !f.isActive }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['facilities'] }), toast('Updated', 'success')),
  });
  return (
    <>
      <PageHead
        title="Facilities"
        sub="Amenities residents can book"
        actions={
          <Button onClick={() => setEditing({ ...EMPTY_FACILITY })}>
            <Plus size={18} /> Add facility
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <div className="grid-auto">
          {data.facilities.map((f: any) => (
            <Card key={f.id}>
              {f.imageUrl && <img src={f.imageUrl} alt="" style={{ width: '100%', height: 130, objectFit: 'cover', borderRadius: 12, marginBottom: 10 }} />}
              <div className="between">
                <h3>{f.name}</h3>
                <Badge tone={f.isActive ? 'success' : ''}>{f.isActive ? 'Active' : 'Inactive'}</Badge>
              </div>
              <p className="small muted">{f.location}</p>
              <dl className="kv small mt-2">
                <dt>Hours</dt>
                <dd>{timeRange(f.openTime, f.closeTime)}</dd>
                <dt>Slot / max</dt>
                <dd>
                  {f.slotDurationMinutes} / {f.maxBookingMinutes} min
                </dd>
                <dt>Capacity</dt>
                <dd>
                  {f.capacity} people • {f.maxConcurrentBookings} booking{f.maxConcurrentBookings > 1 ? 's' : ''}/slot
                </dd>
                <dt>Book ahead</dt>
                <dd>{f.advanceBookingDays} days</dd>
              </dl>
              <div className="row mt-2">
                <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
                  <Pencil size={14} /> Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(f)}>
                  {f.isActive ? 'Deactivate' : 'Activate'}
                </Button>
                <Link className="btn btn-sm btn-ghost" to={`/admin/bookings?facilityId=${f.id}`}>
                  Bookings
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
      <FacilitySheet facility={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function FacilitySheet({ facility, onClose }: { facility: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState<any>(facility);
  const [image, setImage] = useState<File | null>(null);
  useEffect(() => (setF(facility), setImage(null)), [facility]);
  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      const keys = Object.keys(EMPTY_FACILITY);
      keys.forEach((k) => f[k] !== undefined && f[k] !== null && fd.append(k, String(f[k])));
      if (image) fd.append('image', await compressImage(image, 1200), 'facility.jpg');
      return f.id ? postForm(`/facilities/${f.id}`, fd, 'PATCH') : postForm('/facilities', fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['facilities'] });
      toast('Facility saved', 'success');
      onClose();
    },
  });
  if (!f) return null;
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  return (
    <Sheet open={!!facility} onClose={onClose} title={f.id ? `Edit ${f.name}` : 'Add facility'} wide>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <div className="grid-2">
          <Input label="Name" value={f.name} onChange={(e) => set('name', e.target.value)} required />
          <Input label="Location" value={f.location ?? ''} onChange={(e) => set('location', e.target.value)} />
        </div>
        <Textarea label="Description" value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} rows={2} />
        <div className="grid-3">
          <Input label="Opens" type="time" value={f.openTime} onChange={(e) => set('openTime', e.target.value)} required />
          <Input label="Closes" type="time" value={f.closeTime} onChange={(e) => set('closeTime', e.target.value)} required />
          <Input label="Slot length (min)" type="number" min={15} step={15} value={f.slotDurationMinutes} onChange={(e) => set('slotDurationMinutes', Number(e.target.value))} />
        </div>
        <div className="grid-3">
          <Input label="Max booking (min)" type="number" min={15} step={15} value={f.maxBookingMinutes} onChange={(e) => set('maxBookingMinutes', Number(e.target.value))} />
          <Input label="Capacity (people)" type="number" min={1} value={f.capacity} onChange={(e) => set('capacity', Number(e.target.value))} />
          <Input label="Bookings per slot" type="number" min={1} value={f.maxConcurrentBookings} onChange={(e) => set('maxConcurrentBookings', Number(e.target.value))} hint="1 = exclusive (courts, halls)" />
        </div>
        <div className="grid-3">
          <Input label="Book ahead (days)" type="number" min={0} value={f.advanceBookingDays} onChange={(e) => set('advanceBookingDays', Number(e.target.value))} />
          <Input label="Cancel cutoff (min)" type="number" min={0} value={f.cancellationCutoffMinutes} onChange={(e) => set('cancellationCutoffMinutes', Number(e.target.value))} />
          <Input label="Per flat per day" type="number" min={1} value={f.maxBookingsPerFlatPerDay} onChange={(e) => set('maxBookingsPerFlatPerDay', Number(e.target.value))} />
        </div>
        <Textarea label="Rules" value={f.rules ?? ''} onChange={(e) => set('rules', e.target.value)} rows={3} />
        <label className="field">
          <span className="label">Image</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
        </label>
        <p className="xsmall muted">Changing hours or slot length regenerates the slot schedule. Existing bookings are kept.</p>
        <ErrorBox error={save.error} />
        <Button size="lg" loading={save.isPending}>
          Save facility
        </Button>
      </form>
    </Sheet>
  );
}

// ============================================================================
// Bookings
// ============================================================================
export function BookingsAdminPage() {
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [facilityId, setFacilityId] = useState(params.get('facilityId') ?? '');
  const [date, setDate] = useState(params.get('q') ? '' : todayISO());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState(params.get('q') ?? '');
  const [page, setPage] = useState(1);
  const facilities = useQuery({ queryKey: ['facilities'], queryFn: () => get('/facilities') });
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-bookings', facilityId, date, status, q, page],
    queryFn: () => get(`/bookings${qs({ facilityId, date, status, q, page, pageSize: 30 })}`),
    placeholderData: (p) => p,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => post(`/bookings/${id}/cancel`, { reason }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-bookings'] }), toast('Booking cancelled — resident notified', 'success')),
    onError: (e: any) => toast(e.message, 'error'),
  });
  return (
    <>
      <PageHead title="Bookings" sub="All facility bookings across the society" />
      <div className="filters">
        <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Flat, reference or resident" />
        <select className="select" value={facilityId} onChange={(e) => (setFacilityId(e.target.value), setPage(1))} aria-label="Facility">
          <option value="">All facilities</option>
          {facilities.data?.facilities.map((f: any) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={date} onChange={(e) => (setDate(e.target.value), setPage(1))} aria-label="Date" />
        <select className="select" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))} aria-label="Status">
          <option value="">Any status</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
        {date && (
          <Button variant="ghost" size="sm" onClick={() => setDate('')}>
            All dates
          </Button>
        )}
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.bookings.length ? (
          <Empty title="No bookings" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reference</th>
                    <th>Facility</th>
                    <th>Date & time</th>
                    <th>Flat</th>
                    <th>Booked by</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.bookings.map((b: any) => (
                    <tr key={b.id}>
                      <td className="mono small">{b.reference}</td>
                      <td className="strong">{b.facilityName}</td>
                      <td className="small">
                        {dayLabel(b.date)} • {timeRange(b.startTime, b.endTime)}
                      </td>
                      <td>{b.flatNumber}</td>
                      <td className="small">{b.bookedBy}</td>
                      <td>
                        <Badge tone={b.status === 'confirmed' ? 'success' : b.status === 'cancelled' ? 'danger' : ''}>{titleCase(b.status)}</Badge>
                      </td>
                      <td>
                        {b.status === 'confirmed' && new Date(b.endsAt) > new Date() && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const reason = window.prompt('Reason for cancellation (shared with the resident):', 'Maintenance work');
                              if (reason !== null) cancel.mutate({ id: b.id, reason });
                            }}
                          >
                            Cancel
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={30} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}

// ============================================================================
// Announcements
// ============================================================================
export function AnnouncementsAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState('all');
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['admin-announcements', state], queryFn: () => get(`/announcements${qs({ state, pageSize: 100 })}`) });
  const archive = useMutation({ mutationFn: (id: string) => del(`/announcements/${id}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['admin-announcements'] }), toast('Archived', 'success')) });
  return (
    <>
      <PageHead
        title="Announcements"
        sub="Notices are pushed to residents instantly, or at the scheduled time"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Megaphone size={18} /> New announcement
          </Button>
        }
      />
      <div style={{ marginBottom: 14 }}>
        <Segmented value={state} onChange={setState} options={['all', 'live', 'scheduled', 'expired', 'archived'].map((s) => ({ value: s, label: titleCase(s) }))} />
      </div>
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data.announcements.length ? (
        <Empty title="No announcements" />
      ) : (
        <div className="stack">
          {data.announcements.map((a: any) => (
            <Card key={a.id} className={a.priority === 'emergency' && a.state === 'live' ? 'emergency' : a.priority === 'important' ? 'important' : ''}>
              <div className="between">
                <div className="row-wrap">
                  <Badge tone={a.state === 'live' ? 'success' : a.state === 'scheduled' ? 'info' : ''}>{titleCase(a.state)}</Badge>
                  <Badge tone={a.priority === 'emergency' ? 'danger' : a.priority === 'important' ? 'warning' : ''}>{titleCase(a.priority)}</Badge>
                  <Badge>{titleCase(a.category)}</Badge>
                  {a.audience === 'towers' && <Badge tone="violet">Selected towers</Badge>}
                </div>
                {a.state !== 'archived' && (
                  <Button size="sm" variant="ghost" onClick={() => window.confirm('Archive this announcement? Residents will no longer see it.') && archive.mutate(a.id)}>
                    <Trash2 size={14} /> Archive
                  </Button>
                )}
              </div>
              <h3 className="mt-1">{a.title}</h3>
              <p className="small secondary mt-1 pre">{a.body}</p>
              <p className="xsmall muted mt-1">
                {a.state === 'scheduled' ? 'Publishes' : 'Published'} {dateTime(a.publishAt)}
                {a.expiresAt ? ` • Expires ${dateTime(a.expiresAt)}` : ''}
                {a.createdBy ? ` • by ${a.createdBy}` : ''}
              </p>
            </Card>
          ))}
        </div>
      )}
      <AnnouncementSheet open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function AnnouncementSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const towers = useTowers();
  const [f, setF] = useState({ title: '', body: '', category: 'general', priority: 'normal', audience: 'all', towerIds: [] as string[], publishAt: '', expiresAt: '' });
  const [file, setFile] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('title', f.title);
      fd.append('body', f.body);
      fd.append('category', f.category);
      fd.append('priority', f.priority);
      fd.append('audience', f.audience);
      if (f.audience === 'towers') fd.append('towerIds', f.towerIds.join(','));
      if (f.publishAt) fd.append('publishAt', new Date(f.publishAt).toISOString());
      if (f.expiresAt) fd.append('expiresAt', new Date(f.expiresAt).toISOString());
      if (file) fd.append('attachment', await compressImage(file, 1600), 'attachment.jpg');
      return postForm('/announcements', fd);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin-announcements'] });
      toast(r.recipients ? `Published — ${r.recipients.toLocaleString('en-IN')} people notified` : 'Scheduled', 'success');
      setF({ title: '', body: '', category: 'general', priority: 'normal', audience: 'all', towerIds: [], publishAt: '', expiresAt: '' });
      setFile(null);
      onClose();
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="New announcement" wide>
      <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
        <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required maxLength={140} />
        <Textarea label="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} required rows={5} />
        <div className="grid-2">
          <Select label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, priority: e.target.value === 'emergency' ? 'emergency' : f.priority })}>
            {['general', 'maintenance', 'water', 'electricity', 'security', 'event', 'emergency'].map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
          <Select label="Priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="important">Important</option>
            <option value="emergency">Emergency</option>
          </Select>
        </div>
        {f.priority === 'emergency' && (
          <div className="alert alert-error">
            <Siren size={18} /> Emergency notices bypass residents’ notification settings and are also sent to on-duty guards.
          </div>
        )}
        <div className="field">
          <span className="label">Audience</span>
          <Segmented value={f.audience} onChange={(v) => setF({ ...f, audience: v })} options={[{ value: 'all', label: 'Everyone' }, { value: 'towers', label: 'Selected towers' }]} />
          {f.audience === 'towers' && (
            <div className="chips mt-1">
              {towers.data?.towers.map((t: any) => (
                <button key={t.id} type="button" className="chip" aria-pressed={f.towerIds.includes(t.id)} onClick={() => setF({ ...f, towerIds: f.towerIds.includes(t.id) ? f.towerIds.filter((x) => x !== t.id) : [...f.towerIds, t.id] })}>
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid-2">
          <Input label="Publish at (optional)" type="datetime-local" value={f.publishAt} onChange={(e) => setF({ ...f, publishAt: e.target.value })} hint="Leave empty to publish now" />
          <Input label="Expires at (optional)" type="datetime-local" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
        </div>
        <label className="field">
          <span className="label">Image attachment (optional)</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <ErrorBox error={create.error} />
        <Button size="lg" loading={create.isPending} disabled={f.audience === 'towers' && !f.towerIds.length}>
          {f.publishAt ? 'Schedule' : 'Publish & notify'}
        </Button>
      </form>
    </Sheet>
  );
}

// ============================================================================
// Emergency contacts
// ============================================================================
export function EmergencyAdminPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<any>(null);
  const { data, isLoading } = useQuery({ queryKey: ['emergency'], queryFn: () => get('/emergency-contacts') });
  const remove = useMutation({ mutationFn: (id: string) => del(`/emergency-contacts/${id}`), onSuccess: () => (qc.invalidateQueries({ queryKey: ['emergency'] }), toast('Removed', 'success')) });
  const save = useMutation({
    mutationFn: (c: any) => {
      const body = { name: c.name, category: c.category, phone: c.phone, description: c.description || null, available24x7: !!c.available_24x7, sortOrder: Number(c.sort_order) || 0, isActive: c.is_active !== false };
      return c.id ? patch(`/emergency-contacts/${c.id}`, body) : post('/emergency-contacts', body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['emergency'] }), toast('Saved', 'success'), setEditing(null)),
  });
  return (
    <>
      <PageHead
        title="Emergency Contacts"
        sub="Shown to every resident with a one-tap CALL button"
        actions={
          <Button onClick={() => setEditing({ name: '', category: 'society', phone: '', description: '', available_24x7: false, sort_order: (data?.contacts?.length ?? 0) + 1 })}>
            <Plus size={18} /> Add contact
          </Button>
        }
      />
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Phone</th>
                  <th>24×7</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.contacts.map((c: any) => (
                  <tr key={c.id}>
                    <td className="muted">{c.sort_order}</td>
                    <td>
                      <div className="strong">{c.name}</div>
                      <div className="xsmall muted">{c.description}</div>
                    </td>
                    <td>{titleCase(c.category)}</td>
                    <td className="mono">
                      <a href={`tel:${c.phone}`}>
                        <Phone size={13} /> {c.phone}
                      </a>
                    </td>
                    <td>{c.available_24x7 ? <Badge tone="success">Yes</Badge> : '—'}</td>
                    <td>
                      <div className="row">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => window.confirm(`Remove ${c.name}?`) && remove.mutate(c.id)}>
                          Remove
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit contact' : 'Add contact'}>
        {editing && (
          <form className="stack" onSubmit={(e) => (e.preventDefault(), save.mutate(editing))}>
            <Input label="Name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
            <div className="grid-2">
              <Select label="Category" value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {['society', 'medical', 'police', 'fire', 'utility', 'maintenance', 'other'].map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </Select>
              <Input label="Phone" type="tel" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} required />
            </div>
            <Input label="Description" value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            <div className="grid-2">
              <Input label="Display order" type="number" value={editing.sort_order} onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })} />
              <label className="checkbox" style={{ alignSelf: 'end', minHeight: 46 }}>
                <input type="checkbox" checked={!!editing.available_24x7} onChange={(e) => setEditing({ ...editing, available_24x7: e.target.checked })} /> Available 24×7
              </label>
            </div>
            <ErrorBox error={save.error} />
            <Button size="lg" loading={save.isPending}>
              Save
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

export { dateLong };
