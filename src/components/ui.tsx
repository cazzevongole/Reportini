import {
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { CloseIcon } from "./icons";

/* --------------------------------- Button -------------------------------- */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-ink-950 text-white hover:bg-ink-800 active:bg-ink-900 shadow-soft disabled:bg-ink-300",
  secondary:
    "bg-white text-ink-800 border border-ink-200 hover:border-ink-300 hover:bg-ink-50 disabled:text-ink-300",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-300",
  danger: "bg-clay-50 text-clay-700 border border-clay-200 hover:bg-clay-100 disabled:opacity-50",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-11 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-5 text-[15px] gap-2 rounded-xl",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={`inline-flex select-none items-center justify-center font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Fields -------------------------------- */

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-ink-400">{hint}</span> : null}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`field-input ${className}`} {...props} />;
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`field-input min-h-28 resize-y ${className}`} {...props} />;
}

/**
 * Casella di spunta con etichetta. Serve per le scelte che si possono
 * disattivare: il colore d'accento è il verde del brand, non il blu di sistema.
 */
export function Checkbox({
  label,
  hint,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 ${className}`}>
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-ink-300 accent-brand-500"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-400">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`field-input appearance-none bg-white pr-9 ${className}`} {...props}>
      {children}
    </select>
  );
}

/* --------------------------------- Chrome -------------------------------- */

export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`card ${className}`}>{children}</div>;
}

type BadgeTone = "neutral" | "brand" | "clay" | "muted";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-ink-100 text-ink-700",
  brand: "bg-brand-100 text-brand-800",
  clay: "bg-clay-100 text-clay-800",
  muted: "bg-ink-50 text-ink-500",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] leading-tight sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-400">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      {icon ? <div className="text-ink-300">{icon}</div> : null}
      <h3 className="text-lg">{title}</h3>
      <p className="max-w-sm text-sm text-ink-400">{description}</p>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: BadgeTone;
}) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{label}</p>
      <p className="mt-2 font-display text-3xl leading-none text-ink-950">{value}</p>
      {hint ? (
        <Badge tone={tone} className="mt-3">
          {hint}
        </Badge>
      ) : null}
    </Card>
  );
}

/* --------------------------------- Sheet --------------------------------- */

/**
 * Bottom sheet sui telefoni, dialog centrato da `sm` in su.
 * Usato da tutti i form di creazione/modifica per tenere le azioni principali
 * vicine al pollice.
 *
 * `onClose` è facoltativo: quando manca il dialog non si chiude con la X, con
 * Esc né toccando lo sfondo. Serve alle domande che hanno una risposta per
 * entrambe le vie — come "aggiorni adesso o alla chiusura?" — dove una X
 * sarebbe una terza opzione che non esiste.
 */
export function Sheet({
  open,
  title,
  description,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-ink-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-ink-100 bg-[rgb(var(--card))] shadow-lift animate-sheet-in sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-ink-100 p-5 pb-4">
          <div className="flex-1">
            <h2 className="text-xl">{title}</h2>
            {description ? <p className="mt-1 text-sm text-ink-400">{description}</p> : null}
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Chiudi"
              className="-mr-1 rounded-full p-2 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-800"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="safe-bottom flex gap-2 border-t border-ink-100 bg-ink-50/60 p-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
