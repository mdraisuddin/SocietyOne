import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { AlertCircle, Building2, CheckCircle2, ImagePlus, Inbox, Search, X } from 'lucide-react';
import { COMPLAINT_STATUS, PRIORITY, initials } from '../lib/format';
import { errorMessage } from '../lib/api';
import { compressImage } from '../lib/image';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden>
        <Building2 size={20} />
      </span>
      {!compact && <span>SocietyOne</span>}
    </span>
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'soft'; size?: 'sm' | 'md' | 'lg' | 'xl'; block?: boolean; loading?: boolean };
export function Button({ variant = 'primary', size = 'md', block, loading, className = '', children, disabled, ...rest }: BtnProps) {
  const cls = ['btn', variant !== 'primary' && `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className].filter(Boolean).join(' ');
  return (
    <button className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2, borderTopColor: 'currentColor' }} /> : null}
      {children}
    </button>
  );
}

export function Card({ children, className = '', title, action, ...rest }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`card ${className}`} {...rest}>
      {(title || action) && (
        <div className="card-title">
          {typeof title === 'string' ? <h3>{title}</h3> : title}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function Input({ label, hint, error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const input = <input id={rest.id ?? id} className={`input ${className}`} aria-invalid={!!error} {...rest} />;
  return label || hint || error ? <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>{input}</Field> : input;
}

export function MobileInput({ label = 'Mobile number', value, onChange, ...rest }: { label?: string; value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <div className="input-prefix">
        <span>+91</span>
        <input
          id={id}
          className="input"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder="98765 43210"
          maxLength={11}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d ]/g, ''))}
          {...rest}
        />
      </div>
    </Field>
  );
}

export function Select({ label, hint, error, className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const el = (
    <select id={rest.id ?? id} className={`select ${className}`} {...rest}>
      {children}
    </select>
  );
  return label ? <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>{el}</Field> : el;
}

export function Textarea({ label, hint, error, className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; hint?: ReactNode; error?: string | null }) {
  const id = useId();
  const el = <textarea id={rest.id ?? id} className={`textarea ${className}`} {...rest} />;
  return label ? <Field label={label} hint={hint} error={error} htmlFor={rest.id ?? id}>{el}</Field> : el;
}

export function Badge({ tone = '', children, icon }: { tone?: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`badge ${tone ? `badge-${tone}` : ''}`}>
      {icon}
      {children}
    </span>
  );
}
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={COMPLAINT_STATUS[status]?.tone}>{COMPLAINT_STATUS[status]?.label ?? status}</Badge>;
export const PriorityBadge = ({ priority }: { priority: string }) => <Badge tone={PRIORITY[priority]?.tone}>{PRIORITY[priority]?.label ?? priority}</Badge>;

export const Spinner = () => <span className="spinner" role="status" aria-label="Loading" />;
export const Loading = () => (
  <div className="loading-block">
    <Spinner />
  </div>
);
export function FullPageSpinner({ label }: { label?: string }) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div className="stack" style={{ alignItems: 'center' }}>
        <Spinner />
        {label && <span className="muted small">{label}</span>}
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={40} />}
      <div className="strong secondary">{title}</div>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <AlertCircle size={18} style={{ flex: 'none', marginTop: 1 }} />
      <span>{errorMessage(error)}</span>
    </div>
  );
}

export function Avatar({ name, src, size }: { name?: string | null; src?: string | null; size?: 'lg' }) {
  return <span className={`avatar ${size === 'lg' ? 'avatar-lg' : ''}`}>{src ? <img src={src} alt="" /> : initials(name)}</span>;
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="chip" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Debounced search input (fewer API calls on slow networks). */
export function SearchInput({ value, onChange, placeholder = 'Search', delay = 300, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; delay?: number; autoFocus?: boolean }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <div className="search-box">
      <Search size={18} />
      <input className="input" type="search" value={local} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setLocal(e.target.value)} autoFocus={autoFocus} />
    </div>
  );
}

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} style={wide ? { maxWidth: 720 } : undefined}>
        <div className="sheet-handle" />
        {title && (
          <div className="between" style={{ marginBottom: 14 }}>
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true">
        {children}
      </div>
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pager">
      <span>
        {total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString('en-IN')}`}
      </span>
      <div className="row">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

// ---------- toasts ----------
type Toast = { id: number; text: string; tone?: 'error' | 'success' };
const ToastCtx = createContext<(text: string, tone?: 'error' | 'success') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone?: 'error' | 'success') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-host" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone ?? ''}`}>
            {t.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Photo picker with client-side compression and previews. */
export function PhotoPicker({ files, onChange, max = 5 }: { files: Blob[]; onChange: (f: Blob[]) => void; max?: number }) {
  const ref = useRef<HTMLInputElement>(null);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  return (
    <div className="photo-row">
      {urls.map((u, i) => (
        <div key={u} style={{ position: 'relative' }}>
          <img className="photo-thumb" src={u} alt={`Photo ${i + 1}`} />
          <button type="button" className="icon-btn" style={{ position: 'absolute', top: -8, right: -8, width: 28, height: 28 }} aria-label="Remove photo" onClick={() => onChange(files.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      {files.length < max && (
        <button type="button" className="photo-add" onClick={() => ref.current?.click()} aria-label="Add photo">
          <ImagePlus size={24} />
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        hidden
        multiple
        onChange={async (e) => {
          const picked = Array.from(e.target.files ?? []).slice(0, max - files.length);
          const compressed = await Promise.all(picked.map((f) => compressImage(f)));
          onChange([...files, ...compressed]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

export function useConfirm() {
  return (message: string) => window.confirm(message);
}
