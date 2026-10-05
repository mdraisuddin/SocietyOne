import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Droplets, Plus, Star, Wrench, Zap, Sparkles, ArrowUpDown, ShieldAlert, Car, Waves, Trees, Volume2, Bug, HelpCircle, Send } from 'lucide-react';
import { get, post, postForm } from '../../lib/api';
import { dateTime, relative, titleCase } from '../../lib/format';
import { Badge, Button, Card, Chips, Empty, ErrorBox, Input, Loading, PhotoPicker, PriorityBadge, Segmented, StatusBadge, Textarea, useToast } from '../../components/ui';
import { MobileHeader } from './ResidentApp';

export const CATEGORY_ICONS: Record<string, any> = {
  plumbing: Droplets, electrical: Zap, housekeeping: Sparkles, lift: ArrowUpDown, security: ShieldAlert, parking: Car, water: Waves,
  common_area: Trees, noise: Volume2, pest_control: Bug, other: HelpCircle,
};

export function ComplaintsPage() {
  const [filter, setFilter] = useState('open,assigned,in_progress,resolved');
  const { data, isLoading, error } = useQuery({ queryKey: ['complaints', filter], queryFn: () => get(`/complaints?status=${filter}&pageSize=50`) });
  return (
    <>
      <MobileHeader title="Complaints" back="/app" />
      <main className="mobile-main stack">
        <Chips
          label="Status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open,assigned,in_progress,resolved', label: 'Active' },
            { value: 'resolved', label: 'Awaiting confirmation' },
            { value: 'closed', label: 'Closed' },
            { value: '', label: 'All' },
          ]}
        />
        {isLoading ? (
          <Loading />
        ) : error ? (
          <ErrorBox error={error} />
        ) : !data.complaints.length ? (
          <Empty icon={<Wrench size={40} />} title="No complaints here">Raise a complaint and track it until it is fixed.</Empty>
        ) : (
          <div className="card card-flush list">
            {data.complaints.map((c: any) => {
              const Icon = CATEGORY_ICONS[c.category] ?? HelpCircle;
              return (
                <Link key={c.id} to={`/app/complaints/${c.id}`} className="list-item" style={{ alignItems: 'flex-start' }}>
                  <span className="icon-tile qa-amber">
                    <Icon size={18} />
                  </span>
                  <div className="grow stack-sm" style={{ gap: 3 }}>
                    <div className="strong">{c.title}</div>
                    <div className="xsmall muted">
                      #{c.number} • {titleCase(c.category)} • {relative(c.created_at)}
                    </div>
                    <div className="row-wrap">
                      <StatusBadge status={c.status} />
                      {c.status === 'closed' && c.rating ? <Badge tone="warning">★ {c.rating}</Badge> : null}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <Link to="/app/complaints/new" className="btn btn-lg fab">
        <Plus size={20} /> Raise complaint
      </Link>
    </>
  );
}

export function NewComplaintPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: meta } = useQuery({ queryKey: ['complaint-meta'], queryFn: () => get('/complaints/meta'), staleTime: Infinity });
  const [f, setF] = useState({ category: '', subcategory: '', title: '', description: '', location: '', priority: 'medium' });
  const [photos, setPhotos] = useState<Blob[]>([]);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const create = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      Object.entries(f).forEach(([k, v]) => v && fd.append(k, v));
      photos.forEach((p, i) => fd.append('photos', p, `photo-${i + 1}.jpg`));
      return postForm('/complaints', fd);
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['complaints'] });
      qc.invalidateQueries({ queryKey: ['home'] });
      nav(`/app/complaints/${r.complaint.id}?new=1`, { replace: true });
    },
  });
  const categories = meta ? Object.keys(meta.categories) : [];
  return (
    <>
      <MobileHeader title="Raise complaint" back="/app/complaints" />
      <main className="mobile-main">
        <form className="stack" onSubmit={(e) => (e.preventDefault(), create.mutate())}>
          <div className="field">
            <span className="label">Category</span>
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              {categories.map((c) => {
                const Icon = CATEGORY_ICONS[c] ?? HelpCircle;
                return (
                  <button key={c} type="button" className="slot" aria-pressed={f.category === c} onClick={() => setF((x) => ({ ...x, category: c, subcategory: '' }))}>
                    <Icon size={20} />
                    <small style={{ fontSize: '0.78rem', fontWeight: 650, color: 'inherit' }}>{titleCase(c)}</small>
                  </button>
                );
              })}
            </div>
          </div>
          {f.category && (
            <div className="field">
              <span className="label">What’s the issue?</span>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {meta.categories[f.category].map((s: string) => (
                  <button key={s} type="button" className="chip" aria-pressed={f.subcategory === s} onClick={() => setF((x) => ({ ...x, subcategory: s, title: x.title || s }))}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Input label="Title" value={f.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={120} placeholder="e.g. Kitchen sink leakage" />
          <Textarea label="Description" value={f.description} onChange={(e) => set('description', e.target.value)} required minLength={5} maxLength={2000} placeholder="Describe the problem so the technician comes prepared" />
          <Input label="Location (optional)" value={f.location} onChange={(e) => set('location', e.target.value)} maxLength={120} placeholder="Kitchen, balcony, lift lobby…" />
          <div className="field">
            <span className="label">Priority</span>
            <Segmented value={f.priority} onChange={(v) => set('priority', v)} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]} />
          </div>
          <div className="field">
            <span className="label">Photos (optional, up to 5)</span>
            <PhotoPicker files={photos} onChange={setPhotos} />
            <span className="hint">Photos are compressed on your phone before upload.</span>
          </div>
          <ErrorBox error={create.error} />
          <Button size="lg" block loading={create.isPending} disabled={!f.category}>
            Submit complaint
          </Button>
        </form>
      </main>
    </>
  );
}

const STEPS = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];

export function ComplaintDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const isNew = new URLSearchParams(location.search).has('new');
  const { data, isLoading, error } = useQuery({ queryKey: ['complaint', id], queryFn: () => get(`/complaints/${id}`), refetchInterval: 30_000 });
  const [comment, setComment] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [reopen, setReopen] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['complaint', id] });
    qc.invalidateQueries({ queryKey: ['complaints'] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };
  const addComment = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('body', comment);
      photos.forEach((p, i) => fd.append('photos', p, `photo-${i}.jpg`));
      return postForm(`/complaints/${id}/comments`, fd);
    },
    onSuccess: () => (setComment(''), setPhotos([]), refresh()),
    onError: (e: any) => toast(e.message, 'error'),
  });
  const confirm = useMutation({ mutationFn: () => post(`/complaints/${id}/confirm`), onSuccess: () => (toast('Thanks for confirming', 'success'), refresh()) });
  const rate = useMutation({ mutationFn: () => post(`/complaints/${id}/rate`, { rating, feedback: feedback || null }), onSuccess: () => (toast('Thanks for your feedback', 'success'), refresh()) });
  const doReopen = useMutation({ mutationFn: () => post(`/complaints/${id}/reopen`, { reason: reopen }), onSuccess: () => (setReopen(''), toast('Complaint reopened', 'success'), refresh()), onError: (e: any) => toast(e.message, 'error') });

  if (isLoading) return <Loading />;
  if (error) return <main className="mobile-main"><ErrorBox error={error} /></main>;
  const c = data.complaint;
  const stepIndex = STEPS.indexOf(c.status);
  const mainPhotos = data.attachments.filter((a: any) => !a.commentId);
  return (
    <>
      <MobileHeader title={`#${c.number}`} back="/app/complaints" />
      <main className="mobile-main stack">
        {isNew && <div className="alert alert-success">Complaint registered. Ticket #{c.number}. We’ll notify you on every update.</div>}
        <Card>
          <div className="row-wrap" style={{ marginBottom: 8 }}>
            <StatusBadge status={c.status} />
            <PriorityBadge priority={c.priority} />
            <Badge>{titleCase(c.category)}</Badge>
          </div>
          <h2>{c.title}</h2>
          <p className="secondary mt-1 pre">{c.description}</p>
          {c.location && <p className="small muted mt-1">Location: {c.location}</p>}
          {mainPhotos.length > 0 && (
            <div className="photo-row mt-2">
              {mainPhotos.map((p: any) => (
                <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                  <img className="photo-thumb" src={p.url} alt="Complaint photo" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          <div className="stepper mt-3" aria-label={`Progress: ${c.status}`}>
            {STEPS.map((s, i) => (
              <div key={s} className={i <= stepIndex ? 'on' : ''} />
            ))}
          </div>
          <div className="between xsmall muted mt-1">
            <span>Open</span>
            <span>Assigned</span>
            <span>In progress</span>
            <span>Resolved</span>
            <span>Closed</span>
          </div>
          {(c.assignee_name || c.assigned_to_name) && (
            <p className="small mt-2">
              Assigned to <strong>{c.assignee_name ?? c.assigned_to_name}</strong>
            </p>
          )}
        </Card>

        {c.status === 'resolved' && (
          <Card className="important">
            <h3>Is the issue fixed?</h3>
            <p className="small secondary mt-1">Please confirm so we can close the ticket, or reopen it if the problem continues.</p>
            <div className="grid-2 mt-2">
              <Button variant="secondary" onClick={() => setReopen(reopen || ' ')}>
                Not fixed
              </Button>
              <Button variant="success" onClick={() => confirm.mutate()} loading={confirm.isPending}>
                Yes, it’s fixed
              </Button>
            </div>
          </Card>
        )}
        {c.status === 'closed' && reopen === '' && (
          <Button variant="ghost" onClick={() => setReopen(' ')}>
            Issue came back? Reopen
          </Button>
        )}
        {reopen !== '' && ['resolved', 'closed'].includes(c.status) && (
          <Card>
            <Textarea label="What is still wrong?" value={reopen.trimStart()} onChange={(e) => setReopen(e.target.value)} autoFocus />
            <Button className="mt-2" block onClick={() => doReopen.mutate()} disabled={reopen.trim().length < 3} loading={doReopen.isPending}>
              Reopen complaint
            </Button>
          </Card>
        )}

        {['resolved', 'closed'].includes(c.status) && !c.rating && (
          <Card>
            <h3>Rate the service</h3>
            <div className="stars mt-1" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className={n <= rating ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-checked={n === rating} role="radio" onClick={() => setRating(n)}>
                  <Star size={34} fill={n <= rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            {rating > 0 && (
              <div className="stack mt-1">
                <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Anything to add? (optional)" rows={2} />
                <Button onClick={() => rate.mutate()} loading={rate.isPending}>
                  Submit rating
                </Button>
              </div>
            )}
          </Card>
        )}
        {c.rating && (
          <Card>
            <div className="row">
              <span className="strong">Your rating</span>
              <span style={{ color: '#e9a400' }}>{'★'.repeat(c.rating)}{'☆'.repeat(5 - c.rating)}</span>
            </div>
          </Card>
        )}

        <section>
          <div className="section-title">
            <h2>Updates</h2>
          </div>
          <div className="timeline">
            <div className="tl-item done">
              <div className="small strong">Complaint raised</div>
              <div className="xsmall muted">{dateTime(c.created_at)}</div>
            </div>
            {data.comments.map((cm: any) => (
              <div key={cm.id} className="tl-item done">
                <div className="small">
                  <strong>{cm.mine ? 'You' : cm.author_is_staff ? `${cm.author_name} (Management)` : cm.author_name}</strong>
                </div>
                <div className="small secondary pre">{cm.body}</div>
                <div className="photo-row">
                  {data.attachments
                    .filter((a: any) => a.commentId === cm.id)
                    .map((p: any) => (
                      <img key={p.id} className="photo-thumb" src={p.url} alt="" loading="lazy" />
                    ))}
                </div>
                <div className="xsmall muted">{dateTime(cm.created_at)}</div>
              </div>
            ))}
          </div>
        </section>

        {c.status !== 'closed' && (
          <Card>
            <div className="stack">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment for the management team" rows={2} aria-label="Comment" />
              <PhotoPicker files={photos} onChange={setPhotos} max={3} />
              <Button onClick={() => addComment.mutate()} disabled={!comment.trim()} loading={addComment.isPending}>
                <Send size={16} /> Send
              </Button>
            </div>
          </Card>
        )}
      </main>
    </>
  );
}
