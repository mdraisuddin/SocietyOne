import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Car, Check, Copy, History, Package, Plus, Repeat, Share2, UserCheck, Users, X } from 'lucide-react';
import { get, post, qs } from '../../lib/api';
import { useSession } from '../../lib/session';
import { CATEGORY_LABEL, addDaysISO, clock, dateLong, dayLabel, nowHHMM, time12, timeRange, todayISO, tsDay } from '../../lib/format';
import { Badge, Button, Card, Chips, Empty, ErrorBox, Input, Loading, MobileInput, Segmented, Textarea, useToast } from '../../components/ui';
import { MobileHeader } from './ResidentApp';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function VisitorsPage() {
  const [tab, setTab] = useState<'upcoming' | 'approvals' | 'history'>('upcoming');
  return (
    <>
      <MobileHeader title="Visitors" />
      <main className="mobile-main stack">
        <Segmented
          label="Visitor view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Expected' },
            { value: 'approvals', label: 'Approvals' },
            { value: 'history', label: 'History' },
          ]}
        />
        {tab === 'upcoming' && <UpcomingInvites />}
        {tab === 'approvals' && <ApprovalsList />}
        {tab === 'history' && <VisitorHistory />}
      </main>
      <Link to="/app/visitors/new" className="btn btn-lg fab">
        <Plus size={20} /> Invite visitor
      </Link>
    </>
  );
}

function UpcomingInvites() {
  const { data, isLoading, error } = useQuery({ queryKey: ['invites', 'upcoming'], queryFn: () => get('/visitors/invites?scope=upcoming') });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.invites.length)
    return (
      <Empty icon={<Users size={40} />} title="No visitors expected">
        Invite a guest and share their pass — the gate will let them in quickly.
      </Empty>
    );
  return (
    <div className="card card-flush list">
      {data.invites.map((i: any) => (
        <Link key={i.id} to={`/app/visitors/pass/${i.id}`} className="list-item">
          <span className="icon-tile qa-blue">{i.visitType === 'recurring' ? <Repeat size={18} /> : <Users size={18} />}</span>
          <div className="grow">
            <div className="strong truncate">{i.visitorName}</div>
            <div className="small muted">
              {i.visitType === 'recurring' ? `Recurring until ${dateLong(i.validUntil)}` : `${dayLabel(i.validFrom)} • ${time12(i.expectedArrival)}`}
            </div>
          </div>
          {i.insideNow ? <Badge tone="success">Inside</Badge> : <span className="mono small muted">{i.passCode}</span>}
        </Link>
      ))}
    </div>
  );
}

function ApprovalsList() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading, error } = useQuery({ queryKey: ['approvals'], queryFn: () => get('/visitors/approvals'), refetchInterval: 15_000 });
  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) => post(`/visitors/approvals/${id}/respond`, { decision }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      toast('Response sent to the gate', 'success');
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.approvals.length) return <Empty icon={<UserCheck size={40} />} title="No approval requests">When an unexpected visitor arrives, the guard will ask you here.</Empty>;
  return (
    <div className="stack">
      {data.approvals.map((a: any) => (
        <Card key={a.id} className={a.status === 'pending' ? 'important' : ''}>
          <div className="between">
            <div>
              <div className="strong">{a.visitorName}</div>
              <div className="small muted">
                {a.gateName} • {clock(a.createdAt)} {a.purpose ? `• ${a.purpose}` : ''}
              </div>
            </div>
            <ApprovalBadge status={a.status} />
          </div>
          {a.status === 'pending' && (
            <div className="grid-2 mt-2">
              <Button variant="secondary" onClick={() => respond.mutate({ id: a.id, decision: 'reject' })}>
                <X size={18} /> Reject
              </Button>
              <Button variant="success" onClick={() => respond.mutate({ id: a.id, decision: 'approve' })}>
                <Check size={18} /> Approve
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

const ApprovalBadge = ({ status }: { status: string }) => (
  <Badge tone={status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : ''}>{status[0].toUpperCase() + status.slice(1)}</Badge>
);

const categoryIcon = (c: string) => (c === 'cab' ? <Car size={18} /> : c === 'food_delivery' ? <Bike size={18} /> : ['delivery', 'courier'].includes(c) ? <Package size={18} /> : <Users size={18} />);

function VisitorHistory() {
  const [category, setCategory] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['visitor-history', category], queryFn: () => get(`/visitors/history${qs({ category, pageSize: 50 })}`) });
  return (
    <div className="stack">
      <Chips
        label="Filter"
        value={category}
        onChange={setCategory}
        options={[{ value: '', label: 'All' }, { value: 'guest', label: 'Guests' }, { value: 'food_delivery', label: 'Food' }, { value: 'delivery', label: 'Deliveries' }, { value: 'cab', label: 'Cabs' }, { value: 'domestic_staff', label: 'Staff' }]}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data.entries.length ? (
        <Empty icon={<History size={40} />} title="No visits yet" />
      ) : (
        <div className="card card-flush list">
          {data.entries.map((e: any) => (
            <div key={e.id} className="list-item">
              <span className="icon-tile qa-info">{categoryIcon(e.category)}</span>
              <div className="grow">
                <div className="strong truncate">{e.visitor_name}</div>
                <div className="small muted">
                  {dayLabel(tsDay(e.checked_in_at))} • In {clock(e.checked_in_at)}
                  {e.checked_out_at && e.status === 'checked_out' ? ` • Out ${clock(e.checked_out_at)}` : ''} • {e.gate_name}
                </div>
              </div>
              {e.status === 'inside' ? <Badge tone="success">Inside</Badge> : e.status === 'left_at_gate' ? <Badge tone="warning">At gate</Badge> : <Badge>{CATEGORY_LABEL[e.category]}</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PURPOSES = ['Family visit', 'Friends', 'Party', 'Business', 'Service / repair', 'Tuition', 'House help'];

export function InviteVisitorPage() {
  const me = useSession();
  const nav = useNavigate();
  const qc = useQueryClient();
  const today = todayISO();
  const [f, setF] = useState({
    visitorName: '', mobile: '', visitDate: today, expectedArrival: '', purpose: '', guestCount: 1, vehicleNumber: '', notes: '',
    visitType: 'one_time' as 'one_time' | 'recurring', validUntil: addDaysISO(today, 30), recurrenceDays: [1, 2, 3, 4, 5, 6], flatId: me.flats[0]?.id,
  });
  const set = (k: string, v: unknown) => setF((x) => ({ ...x, [k]: v }));
  const create = useMutation({
    mutationFn: () => {
      const body: any = { ...f, mobile: f.mobile.replace(/\s/g, '') || null, vehicleNumber: f.vehicleNumber || null, notes: f.notes || null };
      if (f.visitType === 'one_time') {
        delete body.validUntil;
        delete body.recurrenceDays;
      }
      return post('/visitors/invites', body);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['invites'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      nav(`/app/visitors/pass/${r.pass.id}?new=1`, { replace: true });
    },
  });
  const pastTime = f.visitDate === today && f.expectedArrival && f.expectedArrival < nowHHMM();
  return (
    <>
      <MobileHeader title="Invite visitor" back="/app/visitors" />
      <main className="mobile-main">
        <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <Segmented
            label="Visit type"
            value={f.visitType}
            onChange={(v) => set('visitType', v)}
            options={[
              { value: 'one_time', label: 'One-time' },
              { value: 'recurring', label: <span className="row" style={{ gap: 6 }}><Repeat size={15} /> Recurring</span> },
            ]}
          />
          <Input label="Visitor name" value={f.visitorName} onChange={(e) => set('visitorName', e.target.value)} required maxLength={80} autoComplete="off" placeholder="e.g. Ahmed Khan" />
          <MobileInput label="Visitor mobile (optional)" value={f.mobile} onChange={(v) => set('mobile', v)} />
          {me.flats.length > 1 && (
            <label className="field">
              <span className="label">Visiting flat</span>
              <select className="select" value={f.flatId} onChange={(e) => set('flatId', e.target.value)}>
                {me.flats.map((fl) => (
                  <option key={fl.id} value={fl.id}>
                    {fl.number}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="field">
            <span className="label">{f.visitType === 'recurring' ? 'Starting from' : 'Visit date'}</span>
            <Chips
              label="Date"
              value={[today, addDaysISO(today, 1)].includes(f.visitDate) ? f.visitDate : 'other'}
              onChange={(v) => v !== 'other' && set('visitDate', v)}
              options={[{ value: today, label: 'Today' }, { value: addDaysISO(today, 1), label: 'Tomorrow' }, { value: 'other', label: 'Pick a date' }]}
            />
            <input className="input" type="date" min={today} max={addDaysISO(today, 90)} value={f.visitDate} onChange={(e) => set('visitDate', e.target.value)} aria-label="Visit date" required />
          </div>
          <Input label="Expected arrival time" type="time" value={f.expectedArrival} onChange={(e) => set('expectedArrival', e.target.value)} required hint="The pass is valid from 1 hour before to 3 hours after" error={pastTime ? 'This time has already passed today' : null} />
          {f.visitType === 'recurring' && (
            <>
              <div className="field">
                <span className="label">Days</span>
                <div className="chips">
                  {WEEKDAYS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      className="chip"
                      aria-pressed={f.recurrenceDays.includes(i)}
                      onClick={() => set('recurrenceDays', f.recurrenceDays.includes(i) ? f.recurrenceDays.filter((x) => x !== i) : [...f.recurrenceDays, i].sort())}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <Input label="Valid until" type="date" min={f.visitDate} max={addDaysISO(f.visitDate, 90)} value={f.validUntil} onChange={(e) => set('validUntil', e.target.value)} required />
            </>
          )}
          <div className="field">
            <span className="label">Purpose</span>
            <div className="chips">
              {PURPOSES.map((p) => (
                <button key={p} type="button" className="chip" aria-pressed={f.purpose === p} onClick={() => set('purpose', p)}>
                  {p}
                </button>
              ))}
            </div>
            <input className="input" value={f.purpose} onChange={(e) => set('purpose', e.target.value)} placeholder="Or type a purpose" required maxLength={120} aria-label="Purpose" />
          </div>
          <div className="field">
            <span className="label">Number of visitors</span>
            <div className="row">
              <Button type="button" variant="secondary" onClick={() => set('guestCount', Math.max(1, f.guestCount - 1))} aria-label="Fewer visitors">
                −
              </Button>
              <span className="strong" style={{ minWidth: 30, textAlign: 'center', fontSize: '1.2rem' }} aria-live="polite">
                {f.guestCount}
              </span>
              <Button type="button" variant="secondary" onClick={() => set('guestCount', Math.min(50, f.guestCount + 1))} aria-label="More visitors">
                +
              </Button>
            </div>
          </div>
          <Input label="Vehicle number (optional)" value={f.vehicleNumber} onChange={(e) => set('vehicleNumber', e.target.value.toUpperCase())} placeholder="TS 09 EK 4521" maxLength={15} />
          <Textarea label="Notes for security (optional)" value={f.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} rows={2} />
          <ErrorBox error={create.error} />
          <Button size="lg" block loading={create.isPending}>
            Create visitor pass
          </Button>
        </form>
      </main>
    </>
  );
}

export function PassPage() {
  const { id } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const isNew = new URLSearchParams(location.search).has('new');
  const { data, isLoading, error } = useQuery({ queryKey: ['pass', id], queryFn: () => get(`/visitors/invites/${id}`) });
  const cancel = useMutation({
    mutationFn: () => post(`/visitors/invites/${id}/cancel`),
    onSuccess: () => {
      toast('Pass cancelled', 'success');
      qc.invalidateQueries({ queryKey: ['invites'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      nav('/app/visitors');
    },
  });
  if (isLoading) return <Loading />;
  if (error) return <main className="mobile-main"><ErrorBox error={error} /></main>;
  const p = data.pass;
  const valid = p.visitType === 'recurring' ? `${dateLong(p.validFrom)} – ${dateLong(p.validUntil)}` : dateLong(p.validFrom);
  const shareText = `SocietyOne visitor pass\nVisitor: ${p.visitorName}\nVisiting: ${p.towerName} / ${p.flatNumber}, ${p.societyName}\nValid: ${valid}\nTime: ${timeRange(p.windowStart, p.windowEnd)}\nPass: ${p.passCode}\nPasscode: ${p.otp}\nShow this passcode at the gate.`;
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'Visitor pass', text: shareText });
      else {
        await navigator.clipboard.writeText(shareText);
        toast('Pass details copied', 'success');
      }
    } catch {
      /* user cancelled */
    }
  };
  return (
    <>
      <MobileHeader title="Visitor pass" back="/app/visitors" />
      <main className="mobile-main stack">
        {isNew && <div className="alert alert-success"><Check size={18} /> Pass created. Share it with your visitor.</div>}
        <div className="pass">
          <div className="pass-head">
            <div className="between">
              <span className="small muted">{p.societyName}</span>
              <span className="mono small">{p.passCode}</span>
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 8 }}>{p.visitorName}</div>
            <div className="small muted">
              Visiting: {p.towerName} / {p.flatNumber}
            </div>
          </div>
          <div className="pass-body">
            <dl className="kv" style={{ width: '100%' }}>
              <dt>Valid</dt>
              <dd>{valid}</dd>
              <dt>Time</dt>
              <dd>{timeRange(p.windowStart, p.windowEnd)}</dd>
              {p.visitType === 'recurring' && p.recurrenceDays?.length ? (
                <>
                  <dt>Days</dt>
                  <dd>{p.recurrenceDays.map((d: number) => WEEKDAYS[d]).join(', ')}</dd>
                </>
              ) : null}
              <dt>Guests</dt>
              <dd>{p.guestCount}</dd>
              {p.vehicleNumber && (
                <>
                  <dt>Vehicle</dt>
                  <dd className="mono">{p.vehicleNumber}</dd>
                </>
              )}
            </dl>
            <div className="pass-divider" />
            {p.status === 'active' || p.status === 'checked_in' ? (
              <>
                <div className="qr" aria-label="QR code for the visitor pass" dangerouslySetInnerHTML={{ __html: p.qrSvg }} />
                <div className="center">
                  <div className="xsmall muted strong">PASSCODE</div>
                  <div className="passcode">{p.otp}</div>
                </div>
              </>
            ) : (
              <Badge tone={p.status === 'cancelled' ? 'danger' : ''}>{p.status === 'completed' ? 'Visit completed' : p.status[0].toUpperCase() + p.status.slice(1)}</Badge>
            )}
            {p.insideNow && <Badge tone="success">Visitor is inside now</Badge>}
          </div>
        </div>
        {(p.status === 'active' || p.status === 'checked_in') && (
          <div className="grid-2">
            <Button size="lg" onClick={share}>
              <Share2 size={18} /> Share
            </Button>
            <Button size="lg" variant="secondary" onClick={() => navigator.clipboard?.writeText(p.otp).then(() => toast('Passcode copied', 'success'))}>
              <Copy size={18} /> Copy code
            </Button>
          </div>
        )}
        {p.status === 'active' && !p.insideNow && (
          <Button variant="ghost" onClick={() => window.confirm('Cancel this visitor pass?') && cancel.mutate()} loading={cancel.isPending}>
            Cancel pass
          </Button>
        )}
      </main>
    </>
  );
}

export function ApprovalPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['approvals'], queryFn: () => get('/visitors/approvals'), refetchInterval: 10_000 });
  const respond = useMutation({
    mutationFn: (decision: string) => post(`/visitors/approvals/${id}/respond`, { decision }),
    onSuccess: (r) => {
      toast(r.status === 'approved' ? 'Approved — the guard has been informed' : 'Rejected', 'success');
      qc.invalidateQueries({ queryKey: ['approvals'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      nav('/app');
    },
    onError: (e: any) => toast(e.message, 'error'),
  });
  const a = data?.approvals.find((x: any) => x.id === id);
  return (
    <>
      <MobileHeader title="Visitor approval" back="/app" />
      <main className="mobile-main stack">
        {isLoading ? (
          <Loading />
        ) : !a ? (
          <Empty title="Request not found or expired" />
        ) : (
          <Card>
            <div className="stack center" style={{ alignItems: 'center' }}>
              <span className="icon-tile qa-amber" style={{ width: 64, height: 64, borderRadius: 20 }}>
                <UserCheck size={30} />
              </span>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{a.visitorName}</div>
              <div className="secondary">
                {a.gateName} • Visiting you{a.purpose ? ` • ${a.purpose}` : ''}
              </div>
              {a.guestCount > 1 && <Badge>{a.guestCount} people</Badge>}
              <ApprovalBadge status={a.status} />
            </div>
            {a.status === 'pending' && (
              <div className="grid-2 mt-3">
                <Button size="xl" variant="secondary" onClick={() => respond.mutate('reject')} disabled={respond.isPending}>
                  Reject
                </Button>
                <Button size="xl" variant="success" onClick={() => respond.mutate('approve')} disabled={respond.isPending}>
                  Approve
                </Button>
              </div>
            )}
          </Card>
        )}
      </main>
    </>
  );
}
