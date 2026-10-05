import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, Plus, ShieldCheck, Trash2, UserPlus, X } from 'lucide-react';
import { del, get, patch, post, qs } from '../../lib/api';
import { dateLong, formatMobile, relative, titleCase } from '../../lib/format';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Input, Loading, MobileInput, Pager, SearchInput, Select, Sheet, useToast } from '../../components/ui';
import { PageHead } from './AdminApp';

export function useTowers() {
  return useQuery({ queryKey: ['towers'], queryFn: () => get('/structure/towers'), staleTime: 5 * 60_000 });
}

/** Search-as-you-type flat selector for admin forms. */
export function FlatSelect({ value, onChange }: { value: { id: string; number: string } | null; onChange: (v: { id: string; number: string } | null) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['flat-select', q], queryFn: () => get(`/structure/flats${qs({ q, pageSize: 8 })}`), enabled: q.length >= 1 && !value });
  if (value)
    return (
      <div className="row card" style={{ padding: 10 }}>
        <strong className="grow">{value.number}</strong>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  return (
    <div className="stack-sm">
      <input className="input" placeholder="Type flat number, e.g. A-1204" value={q} onChange={(e) => setQ(e.target.value.toUpperCase())} aria-label="Flat" />
      {data?.flats?.length > 0 && (
        <div className="card card-flush list">
          {data.flats.map((f: any) => (
            <button type="button" key={f.id} className="list-item" onClick={() => onChange({ id: f.id, number: f.number })}>
              <span className="grow strong">{f.number}</span>
              <span className="xsmall muted">{f.primary_resident ?? 'Vacant'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SortTh({ label, k, sort, setSort }: { label: string; k: string; sort: string; setSort: (s: string) => void }) {
  return (
    <th aria-sort={sort === k ? 'ascending' : 'none'}>
      <button onClick={() => setSort(k)}>
        {label} <ArrowUpDown size={12} opacity={sort === k ? 1 : 0.4} />
      </button>
    </th>
  );
}

// ============================================================================
// Residents
// ============================================================================
export function ResidentsPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [towerId, setTowerId] = useState('');
  const [relation, setRelation] = useState('');
  const [status, setStatus] = useState('active');
  const [sort, setSort] = useState('flat');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const towers = useTowers();
  const { data, isLoading, error } = useQuery({
    queryKey: ['residents', q, towerId, relation, status, sort, page],
    queryFn: () => get(`/residents${qs({ q, towerId, relation, status, sort, page, pageSize: 25 })}`),
    placeholderData: (prev) => prev,
  });
  const reset = (fn: () => void) => (fn(), setPage(1));
  return (
    <>
      <PageHead
        title="Residents"
        sub="Owners, tenants and family members"
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={18} /> Add resident
          </Button>
        }
      />
      <div className="filters">
        <SearchInput value={q} onChange={(v) => reset(() => setQ(v))} placeholder="Name, mobile, email or flat" />
        <select className="select" value={towerId} onChange={(e) => reset(() => setTowerId(e.target.value))} aria-label="Tower">
          <option value="">All towers</option>
          {towers.data?.towers.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="select" value={relation} onChange={(e) => reset(() => setRelation(e.target.value))} aria-label="Resident type">
          <option value="">All types</option>
          <option value="owner">Owners</option>
          <option value="tenant">Tenants</option>
          <option value="family_member">Family members</option>
        </select>
        <select className="select" value={status} onChange={(e) => reset(() => setStatus(e.target.value))} aria-label="Status">
          <option value="active">Active</option>
          <option value="moved_out">Moved out</option>
        </select>
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.residents.length ? (
          <Empty title="No residents match" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <SortTh label="Name" k="name" sort={sort} setSort={setSort} />
                    <th>Mobile</th>
                    <SortTh label="Flat" k="flat" sort={sort} setSort={setSort} />
                    <th>Type</th>
                    <SortTh label="Move-in" k="move_in" sort={sort} setSort={setSort} />
                  </tr>
                </thead>
                <tbody>
                  {data.residents.map((r: any) => (
                    <tr key={r.id} className="clickable" onClick={() => setSelected(r.id)}>
                      <td className="strong">
                        {r.full_name} {r.is_primary && <Badge tone="primary">Primary</Badge>}
                      </td>
                      <td className="mono small">{formatMobile(r.mobile)}</td>
                      <td>{r.flat_number ?? '—'}</td>
                      <td>{r.relation ? <Badge tone={r.relation === 'owner' ? 'success' : r.relation === 'tenant' ? 'info' : ''}>{titleCase(r.relation)}</Badge> : '—'}</td>
                      <td className="small">{r.move_in_date ? dateLong(r.move_in_date) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={25} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <AddResidentSheet open={adding} onClose={() => setAdding(false)} />
      <Drawer open={!!selected} onClose={() => setSelected(null)}>
        {selected && <ResidentDetail id={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </>
  );
}

export function AddResidentSheet({ open, onClose, flat: presetFlat }: { open: boolean; onClose: () => void; flat?: { id: string; number: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', mobile: '', email: '', relation: 'owner', isPrimary: true, moveInDate: '' });
  const [flat, setFlat] = useState<{ id: string; number: string } | null>(presetFlat ?? null);
  const add = useMutation({
    mutationFn: () => post('/residents', { ...f, mobile: f.mobile.replace(/\s/g, ''), email: f.email || null, moveInDate: f.moveInDate || null, flatId: (presetFlat ?? flat)!.id }),
    onSuccess: () => {
      toast('Resident added. They can now sign in with OTP on their mobile.', 'success');
      qc.invalidateQueries({ queryKey: ['residents'] });
      qc.invalidateQueries({ queryKey: ['flats'] });
      qc.invalidateQueries({ queryKey: ['flat'] });
      setF({ fullName: '', mobile: '', email: '', relation: 'owner', isPrimary: true, moveInDate: '' });
      onClose();
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Add resident">
      <form className="stack" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
        <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        <MobileInput value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} required />
        <Input label="Email (optional)" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
        {!presetFlat && (
          <div className="field">
            <span className="label">Flat</span>
            <FlatSelect value={flat} onChange={setFlat} />
          </div>
        )}
        <div className="grid-2">
          <Select label="Resident type" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value, isPrimary: e.target.value !== 'family_member' })}>
            <option value="owner">Owner</option>
            <option value="tenant">Tenant</option>
            <option value="family_member">Family member</option>
          </Select>
          <Input label="Move-in date" type="date" value={f.moveInDate} onChange={(e) => setF({ ...f, moveInDate: e.target.value })} />
        </div>
        <label className="checkbox">
          <input type="checkbox" checked={f.isPrimary} onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} /> Primary contact for this flat
        </label>
        <ErrorBox error={add.error} />
        <Button size="lg" loading={add.isPending} disabled={!(presetFlat ?? flat)}>
          Add resident
        </Button>
      </form>
    </Sheet>
  );
}

function ResidentDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['resident', id], queryFn: () => get(`/residents/${id}`) });
  const [linkFlat, setLinkFlat] = useState<{ id: string; number: string } | null>(null);
  const [relation, setRelation] = useState('family_member');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['resident', id] });
    qc.invalidateQueries({ queryKey: ['residents'] });
    qc.invalidateQueries({ queryKey: ['flats'] });
  };
  const link = useMutation({ mutationFn: () => post(`/residents/${id}/flats`, { flatId: linkFlat!.id, relation, isPrimary: false }), onSuccess: () => (setLinkFlat(null), refresh(), toast('Flat linked', 'success')), onError: (e: any) => toast(e.message, 'error') });
  const unlink = useMutation({ mutationFn: (relId: string) => del(`/residents/${id}/flats/${relId}`), onSuccess: () => (refresh(), toast('Flat link ended', 'success')) });
  const remove = useMutation({ mutationFn: () => del(`/residents/${id}`), onSuccess: () => (refresh(), toast('Resident removed and access revoked', 'success'), onClose()) });
  if (isLoading) return <Loading />;
  const r = data.resident;
  return (
    <div className="stack">
      <div className="between">
        <h2>{r.full_name}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <dl className="kv">
        <dt>Mobile</dt>
        <dd className="mono">{formatMobile(r.mobile)}</dd>
        <dt>Email</dt>
        <dd>{r.email ?? '—'}</dd>
        <dt>Status</dt>
        <dd>{titleCase(r.status)}</dd>
        <dt>Last sign-in</dt>
        <dd>{r.last_login_at ? relative(r.last_login_at) : 'Never'}</dd>
      </dl>
      <Card title="Flats">
        <div className="stack-sm">
          {data.flats.map((f: any) => (
            <div key={f.relationship_id} className="between small">
              <span>
                <strong>{f.number}</strong> • {titleCase(f.relation)} {f.status === 'ended' && <Badge>Ended {f.move_out_date ? dateLong(f.move_out_date) : ''}</Badge>}
              </span>
              {f.status === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => window.confirm(`End ${r.full_name}'s link to ${f.number}?`) && unlink.mutate(f.relationship_id)}>
                  End
                </Button>
              )}
            </div>
          ))}
        </div>
        {r.status === 'active' && (
          <div className="stack mt-2">
            <FlatSelect value={linkFlat} onChange={setLinkFlat} />
            {linkFlat && (
              <div className="row">
                <select className="select" value={relation} onChange={(e) => setRelation(e.target.value)} aria-label="Relation">
                  <option value="owner">Owner</option>
                  <option value="tenant">Tenant</option>
                  <option value="family_member">Family member</option>
                </select>
                <Button onClick={() => link.mutate()} loading={link.isPending}>
                  Link flat
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
      {r.status === 'active' && (
        <Button variant="danger" onClick={() => window.confirm(`Remove ${r.full_name}? Their access will be revoked immediately. History is retained.`) && remove.mutate()} loading={remove.isPending}>
          <Trash2 size={16} /> Remove resident
        </Button>
      )}
    </div>
  );
}

// ============================================================================
// Flats
// ============================================================================
export function FlatsPage() {
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [towerId, setTowerId] = useState('');
  const [occupancy, setOccupancy] = useState('');
  const [sort, setSort] = useState('tower');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const towers = useTowers();
  const { data, isLoading, error } = useQuery({
    queryKey: ['flats', q, towerId, occupancy, sort, page],
    queryFn: () => get(`/structure/flats${qs({ q, towerId, occupancy, sort, page, pageSize: 40 })}`),
    placeholderData: (prev) => prev,
  });
  return (
    <>
      <PageHead title="Flats" sub="Bulk-create flats from Settings → Towers & flats" />
      <div className="filters">
        <SearchInput value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Flat number or resident name" />
        <select className="select" value={towerId} onChange={(e) => (setTowerId(e.target.value), setPage(1))} aria-label="Tower">
          <option value="">All towers</option>
          {towers.data?.towers.map((t: any) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select className="select" value={occupancy} onChange={(e) => (setOccupancy(e.target.value), setPage(1))} aria-label="Occupancy">
          <option value="">Any occupancy</option>
          <option value="owner_occupied">Owner occupied</option>
          <option value="tenant_occupied">Tenant occupied</option>
          <option value="vacant">Vacant</option>
        </select>
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
                    <SortTh label="Flat" k="number" sort={sort} setSort={setSort} />
                    <SortTh label="Tower" k="tower" sort={sort} setSort={setSort} />
                    <th>Floor</th>
                    <th>Type</th>
                    <SortTh label="Occupancy" k="occupancy" sort={sort} setSort={setSort} />
                    <SortTh label="Residents" k="residents" sort={sort} setSort={setSort} />
                    <th>Primary contact</th>
                  </tr>
                </thead>
                <tbody>
                  {data.flats.map((f: any) => (
                    <tr key={f.id} className="clickable" onClick={() => setSelected(f.id)}>
                      <td className="strong">{f.number}</td>
                      <td>{f.tower_name}</td>
                      <td>{f.floor_number}</td>
                      <td className="small">{f.flat_type ?? '—'}</td>
                      <td>
                        <Badge tone={f.occupancy_status === 'vacant' ? '' : f.occupancy_status === 'tenant_occupied' ? 'info' : 'success'}>{titleCase(f.occupancy_status)}</Badge>
                      </td>
                      <td>{f.residents}</td>
                      <td className="small">{f.primary_resident ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pageSize={40} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Drawer open={!!selected} onClose={() => setSelected(null)}>
        {selected && <FlatDetail id={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </>
  );
}

function FlatDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['flat', id], queryFn: () => get(`/structure/flats/${id}`) });
  const [adding, setAdding] = useState(false);
  if (isLoading) return <Loading />;
  const f = data.flat;
  return (
    <div className="stack">
      <div className="between">
        <h2>Flat {f.number}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <dl className="kv">
        <dt>Tower</dt>
        <dd>{f.tower_name}</dd>
        <dt>Floor</dt>
        <dd>{f.floor_number}</dd>
        <dt>Type</dt>
        <dd>{f.flat_type ?? '—'}</dd>
        <dt>Area</dt>
        <dd>{f.area_sqft ? `${f.area_sqft.toLocaleString('en-IN')} sq ft` : '—'}</dd>
        <dt>Occupancy</dt>
        <dd>{titleCase(f.occupancy_status)}</dd>
      </dl>
      <Card title="Residents" action={<Button size="sm" variant="soft" onClick={() => setAdding(true)}><Plus size={14} /> Add</Button>}>
        {!data.residents.length ? (
          <Empty title="Vacant" />
        ) : (
          <div className="stack-sm">
            {data.residents.map((r: any) => (
              <div key={r.relationship_id} className="between small">
                <span>
                  <strong>{r.full_name}</strong> {r.is_primary && <Badge tone="primary">Primary</Badge>}
                  <div className="xsmall muted">
                    {titleCase(r.relation)} • {formatMobile(r.mobile)}
                  </div>
                </span>
                <span className="xsmall muted">{r.move_in_date ? `Since ${dateLong(r.move_in_date)}` : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <AddResidentSheet open={adding} onClose={() => setAdding(false)} flat={{ id: f.id, number: f.number }} />
    </div>
  );
}

// ============================================================================
// Security staff
// ============================================================================
export function GuardsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['guards', q], queryFn: () => get(`/guards${qs({ q })}`) });
  const gates = useQuery({ queryKey: ['gates'], queryFn: () => get('/society/gates') });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => patch(`/guards/${id}`, body),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ['guards'] }), toast('Updated', 'success')),
    onError: (e: any) => toast(e.message, 'error'),
  });
  return (
    <>
      <PageHead
        title="Security Staff"
        sub="Guards sign in with their mobile number. They only see what they need at the gate."
        actions={
          <Button onClick={() => setAdding(true)}>
            <ShieldCheck size={18} /> Add guard
          </Button>
        }
      />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Name, mobile or employee code" />
      </div>
      <Card className="card-flush">
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Code</th>
                  <th>Agency</th>
                  <th>Shift</th>
                  <th>Default gate</th>
                  <th>Entries (24 h)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.guards.map((g: any) => (
                  <tr key={g.id}>
                    <td className="strong">{g.full_name}</td>
                    <td className="mono small">{formatMobile(g.mobile)}</td>
                    <td className="small">{g.employee_code ?? '—'}</td>
                    <td className="small">{g.agency_name ?? '—'}</td>
                    <td>
                      <select className="select" style={{ minHeight: 34, padding: '4px 8px' }} value={g.shift} onChange={(e) => update.mutate({ id: g.id, body: { shift: e.target.value } })} aria-label="Shift">
                        <option value="day">Day</option>
                        <option value="night">Night</option>
                        <option value="rotational">Rotational</option>
                      </select>
                    </td>
                    <td>
                      <select className="select" style={{ minHeight: 34, padding: '4px 8px' }} value={g.default_gate_id ?? ''} onChange={(e) => update.mutate({ id: g.id, body: { defaultGateId: e.target.value || null } })} aria-label="Default gate">
                        <option value="">—</option>
                        {gates.data?.gates.map((gt: any) => (
                          <option key={gt.id} value={gt.id}>
                            {gt.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{g.entries_24h}</td>
                    <td>
                      <Button size="sm" variant={g.status === 'active' ? 'secondary' : 'success'} onClick={() => update.mutate({ id: g.id, body: { status: g.status === 'active' ? 'inactive' : 'active' } })}>
                        {g.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <AddGuardSheet open={adding} onClose={() => setAdding(false)} gates={gates.data?.gates ?? []} />
    </>
  );
}

function AddGuardSheet({ open, onClose, gates }: { open: boolean; onClose: () => void; gates: any[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [f, setF] = useState({ fullName: '', mobile: '', employeeCode: '', agencyName: '', shift: 'day', defaultGateId: '' });
  const add = useMutation({
    mutationFn: () => post('/guards', { ...f, mobile: f.mobile.replace(/\s/g, ''), defaultGateId: f.defaultGateId || null, employeeCode: f.employeeCode || null, agencyName: f.agencyName || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['guards'] });
      toast('Guard added. They can sign in with OTP.', 'success');
      onClose();
    },
  });
  return (
    <Sheet open={open} onClose={onClose} title="Add security guard">
      <form className="stack" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
        <Input label="Full name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required />
        <MobileInput value={f.mobile} onChange={(v) => setF({ ...f, mobile: v })} />
        <div className="grid-2">
          <Input label="Employee code" value={f.employeeCode} onChange={(e) => setF({ ...f, employeeCode: e.target.value })} />
          <Input label="Agency" value={f.agencyName} onChange={(e) => setF({ ...f, agencyName: e.target.value })} />
        </div>
        <div className="grid-2">
          <Select label="Shift" value={f.shift} onChange={(e) => setF({ ...f, shift: e.target.value })}>
            <option value="day">Day</option>
            <option value="night">Night</option>
            <option value="rotational">Rotational</option>
          </Select>
          <Select label="Default gate" value={f.defaultGateId} onChange={(e) => setF({ ...f, defaultGateId: e.target.value })}>
            <option value="">—</option>
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
        </div>
        <ErrorBox error={add.error} />
        <Button size="lg" loading={add.isPending}>
          Add guard
        </Button>
      </form>
    </Sheet>
  );
}
