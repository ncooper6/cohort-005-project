// PROTOTYPE — throwaway. Lives on branch `prototype/notifications-ui`, never on main.
// Question: how should Notifications look and behave in Cadence?
// Three structurally different variants, switchable via `?variant=A|B|C`
// (or the floating bar / ← → keys), mounted inside the real app layout:
//   A — Bell + unread badge in the sidebar header, opens a compact dropdown
//   B — "Notifications" sidebar row, opens a full-height slide-over panel
//   C — "Inbox" sidebar row, links to a full Notifications page (/notifications)
// All state is in memory and seeded per role. No vendor, no DB writes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router";
import { Popover, Dialog } from "radix-ui";
import { toast } from "sonner";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MessageSquare,
  MessageSquareReply,
  Receipt,
  RotateCcw,
  Star,
  Trash2,
  UserPlus,
  X,
  Zap,
} from "lucide-react";
import { cn } from "~/lib/utils";
import { UserRole } from "~/db/schema";

// ─── Model ──────────────────────────────────────────────────────────────────

export type NotificationKind =
  | "refund-decided"
  | "refund-opened"
  | "reply"
  | "question"
  | "first-rating"
  | "seat-claimed";

export interface ProtoNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href: string;
  createdAt: number;
  read: boolean;
  /** Instructor question/rating lines group while unread. */
  groupCount?: number;
  groupKey?: string;
  /** e.g. "Decided by Priya" — read on your behalf by another Platform Admin. */
  readReason?: string;
}

export type Variant = "A" | "B" | "C";
export const VARIANTS: { key: Variant; name: string }[] = [
  { key: "A", name: "Bell dropdown" },
  { key: "B", name: "Slide-over panel" },
  { key: "C", name: "Full page" },
];

const COURSE = {
  slug: "introduction-to-typescript",
  title: "Introduction to TypeScript",
  id: 1,
};
const COURSE2 = {
  slug: "design-systems-with-tailwind",
  title: "Design Systems with Tailwind",
  id: 3,
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let idCounter = 0;
const nid = () => `n${++idCounter}`;

type Seed = Omit<ProtoNotification, "id" | "createdAt"> & { ago: number };

function seedsFor(role: UserRole | null, isTeamAdmin: boolean): Seed[] {
  const seeds: Seed[] = [];
  if (role === UserRole.Student) {
    seeds.push(
      {
        kind: "refund-decided",
        title: "Your refund for Introduction to TypeScript was approved",
        body: "“Sorry it wasn't the right fit — refund on its way.”",
        href: `/courses/${COURSE.slug}`,
        read: false,
        ago: 12 * MIN,
      },
      {
        kind: "reply",
        title: "Sam Lee replied to your comment",
        body: "“Good question — generics are covered in module 3…”",
        href: `/courses/${COURSE.slug}/lessons/1#comments`,
        read: false,
        ago: 2 * HOUR,
      },
      {
        kind: "reply",
        title: "Alex Kim replied to your comment",
        body: "“Same issue here, restarting the dev server fixed it.”",
        href: `/courses/${COURSE2.slug}/lessons/1#comments`,
        read: true,
        ago: 3 * DAY,
      }
    );
  }
  if (role === UserRole.Instructor) {
    seeds.push(
      {
        kind: "question",
        title: `5 new questions on ${COURSE.title}`,
        href: "/instructor/questions",
        read: false,
        groupCount: 5,
        groupKey: `question:${COURSE.id}`,
        ago: 8 * MIN,
      },
      {
        kind: "first-rating",
        title: `${COURSE2.title} got its first rating`,
        body: "★★★★☆",
        href: `/instructor/${COURSE2.id}`,
        read: false,
        ago: 5 * HOUR,
      },
      {
        kind: "reply",
        title: "Jordan Patel replied to your comment",
        body: "“Thanks, that cleared it up!”",
        href: `/courses/${COURSE.slug}/lessons/1#comments`,
        read: true,
        ago: 2 * DAY,
      },
      {
        kind: "question",
        title: `2 new questions on ${COURSE2.title}`,
        href: "/instructor/questions",
        read: true,
        groupCount: 2,
        groupKey: `question:${COURSE2.id}:old`,
        ago: 4 * DAY,
      }
    );
  }
  if (role === UserRole.Admin) {
    seeds.push(
      {
        kind: "refund-opened",
        title: "New Refund Request from Jordan Patel",
        body: `${COURSE.title} · $49.00`,
        href: "/admin/refunds",
        read: false,
        ago: 25 * MIN,
      },
      {
        kind: "refund-opened",
        title: "New Refund Request from Casey Wong",
        body: `${COURSE2.title} · $79.00`,
        href: "/admin/refunds",
        read: true,
        readReason: "Approved by Priya Shah",
        ago: 6 * HOUR,
      },
      {
        kind: "reply",
        title: "Sam Lee replied to your comment",
        body: "“Fixed the broken link, thanks.”",
        href: `/courses/${COURSE.slug}/lessons/1#comments`,
        read: true,
        ago: 3 * DAY,
      }
    );
  }
  if (isTeamAdmin) {
    seeds.push({
      kind: "seat-claimed",
      title: "Riley Chen claimed a Seat on your Team Licence",
      body: `${COURSE.title} · 4 of 10 Seats used`,
      href: "/team",
      read: false,
      ago: 40 * MIN,
    });
  }
  return seeds;
}

function arrivalsFor(
  role: UserRole | null,
  isTeamAdmin: boolean
): Omit<Seed, "ago" | "read">[] {
  const list: Omit<Seed, "ago" | "read">[] = [];
  if (role === UserRole.Student)
    list.push(
      {
        kind: "reply",
        title: "Morgan Diaz replied to your comment",
        body: "“Try adding `as const` there.”",
        href: `/courses/${COURSE.slug}/lessons/1#comments`,
      },
      {
        kind: "refund-decided",
        title: "Your refund for Design Systems with Tailwind was declined",
        body: "“You've completed 80% of the course.”",
        href: `/courses/${COURSE2.slug}`,
      }
    );
  if (role === UserRole.Instructor)
    list.push(
      {
        kind: "question",
        title: `New question on ${COURSE.title}`,
        href: "/instructor/questions",
        groupKey: `question:${COURSE.id}`,
      },
      {
        kind: "first-rating",
        title: `${COURSE.title} got its first rating`,
        body: "★★★★★",
        href: `/instructor/${COURSE.id}`,
      }
    );
  if (role === UserRole.Admin)
    list.push({
      kind: "refund-opened",
      title: "New Refund Request from Taylor Brooks",
      body: `${COURSE.title} · $49.00`,
      href: "/admin/refunds",
    });
  if (isTeamAdmin)
    list.push({
      kind: "seat-claimed",
      title: "Avery Singh claimed a Seat on your Team Licence",
      body: `${COURSE.title} · 5 of 10 Seats used`,
      href: "/team",
    });
  if (list.length === 0)
    list.push({
      kind: "reply",
      title: "Someone replied to your comment",
      href: `/courses/${COURSE.slug}/lessons/1#comments`,
    });
  return list;
}

// ─── Store (in-memory context) ──────────────────────────────────────────────

interface Store {
  items: ProtoNotification[];
  unread: number;
  variant: Variant;
  setVariant: (v: Variant) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  open: (n: ProtoNotification) => void;
  simulateArrival: () => void;
  clearAll: () => void;
  reset: () => void;
  /** ids that arrived since the list was last opened (for the "new" highlight) */
  freshIds: Set<string>;
}

const Ctx = createContext<Store | null>(null);

export function useNotifications() {
  const s = useContext(Ctx);
  if (!s) throw new Error("NotificationsProvider missing");
  return s;
}

function build(role: UserRole | null, isTeamAdmin: boolean) {
  const now = Date.now();
  return seedsFor(role, isTeamAdmin)
    .map(({ ago, ...s }) => ({ ...s, id: nid(), createdAt: now - ago }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function NotificationsProvider({
  role,
  isTeamAdmin,
  children,
}: {
  role: UserRole | null;
  isTeamAdmin: boolean;
  children: React.ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlVariant = searchParams.get("variant") as Variant | null;
  const [variant, setVariantState] = useState<Variant>(
    urlVariant && VARIANTS.some((v) => v.key === urlVariant) ? urlVariant : "A"
  );
  const [items, setItems] = useState(() => build(role, isTeamAdmin));
  const [arrivalIdx, setArrivalIdx] = useState(0);
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const setVariant = useCallback(
    (v: Variant) => {
      setVariantState(v);
      setSearchParams(
        (p) => {
          p.set("variant", v);
          return p;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  const markRead = useCallback(
    (id: string) =>
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x))),
    []
  );
  const markAllRead = useCallback(
    () => setItems((xs) => xs.map((x) => ({ ...x, read: true }))),
    []
  );
  const open = useCallback(
    (n: ProtoNotification) => {
      markRead(n.id);
      const [path, hash] = n.href.split("#");
      navigate(`${path}?variant=${variant}${hash ? `#${hash}` : ""}`);
    },
    [markRead, navigate, variant]
  );

  const simulateArrival = useCallback(() => {
    const pool = arrivalsFor(role, isTeamAdmin);
    const tmpl = pool[arrivalIdx % pool.length];
    setArrivalIdx((i) => i + 1);
    // Grouping rule: an unread line with the same groupKey absorbs the event.
    const existing = tmpl.groupKey
      ? items.find((x) => x.groupKey === tmpl.groupKey && !x.read)
      : undefined;
    let arrived: ProtoNotification;
    let next: ProtoNotification[];
    if (existing) {
      const count = (existing.groupCount ?? 1) + 1;
      arrived = {
        ...existing,
        groupCount: count,
        title: `${count} new questions on ${COURSE.title}`,
        createdAt: Date.now(),
      };
      next = [arrived, ...items.filter((x) => x.id !== existing.id)];
    } else {
      arrived = {
        ...tmpl,
        id: nid(),
        createdAt: Date.now(),
        read: false,
        groupCount: tmpl.groupKey ? 1 : undefined,
      };
      // Once a grouped line is read, the next event starts a new line.
      next = [
        arrived,
        ...items.map((x) =>
          tmpl.groupKey && x.groupKey === tmpl.groupKey
            ? { ...x, groupKey: `${x.groupKey}:closed:${x.id}` }
            : x
        ),
      ];
    }
    setItems(next);
    setFreshIds((s) => new Set(s).add(arrived.id));
    toast(arrived.title, {
      description: arrived.body,
      icon: <KindIcon kind={arrived.kind} className="size-4" />,
      action: { label: "View", onClick: () => open(arrived) },
    });
  }, [role, isTeamAdmin, arrivalIdx, open, items]);

  const clearAll = useCallback(() => setItems([]), []);
  const reset = useCallback(() => {
    setItems(build(role, isTeamAdmin));
    setFreshIds(new Set());
  }, [role, isTeamAdmin]);

  const unread = items.filter((x) => !x.read).length;

  const value = useMemo(
    () => ({
      items,
      unread,
      variant,
      setVariant,
      markRead,
      markAllRead,
      open,
      simulateArrival,
      clearAll,
      reset,
      freshIds,
    }),
    [
      items,
      unread,
      variant,
      setVariant,
      markRead,
      markAllRead,
      open,
      simulateArrival,
      clearAll,
      reset,
      freshIds,
    ]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <PrototypeSwitcher />
    </Ctx.Provider>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function KindIcon({
  kind,
  className,
}: {
  kind: NotificationKind;
  className?: string;
}) {
  const Icon = {
    "refund-decided": Receipt,
    "refund-opened": Receipt,
    reply: MessageSquareReply,
    question: MessageSquare,
    "first-rating": Star,
    "seat-claimed": UserPlus,
  }[kind];
  return <Icon className={className} />;
}

const kindLabel: Record<NotificationKind, string> = {
  "refund-decided": "Refunds",
  "refund-opened": "Refunds",
  reply: "Replies",
  question: "Questions",
  "first-rating": "Ratings",
  "seat-claimed": "Seats",
};

const kindTint: Record<NotificationKind, string> = {
  "refund-decided": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  "refund-opened": "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  reply: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  question: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  "first-rating": "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  "seat-claimed": "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
};

function ago(ts: number) {
  const d = Date.now() - ts;
  if (d < MIN) return "just now";
  if (d < HOUR) return `${Math.floor(d / MIN)}m`;
  if (d < DAY) return `${Math.floor(d / HOUR)}h`;
  return `${Math.floor(d / DAY)}d`;
}

function useTick() {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
}

function CountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count === 0) return null;
  return (
    <span
      key={count} // re-mount → replays the pop animation on change
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[11px] font-semibold leading-5 text-white animate-in zoom-in-50 duration-300",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}

function EmptyState({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center text-muted-foreground",
        compact ? "py-10" : "py-24"
      )}
    >
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
        <BellOff className="size-5" />
      </div>
      <div className="text-sm font-medium text-foreground">
        You're all caught up
      </div>
      <div className="mt-1 text-xs">
        New Notifications will show up here as they happen.
      </div>
    </div>
  );
}

// ─── Variant A: bell + dropdown ─────────────────────────────────────────────

export function VariantABell() {
  const { items, unread, markRead, markAllRead, open } = useNotifications();
  useTick();
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label={`Notifications, ${unread} unread`}
        >
          <Bell className="size-5" />
          <CountBadge
            count={unread}
            className="absolute -right-1 -top-1 min-w-4 px-1 text-[10px] leading-4"
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={12}
          className="z-50 w-96 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl animate-in fade-in-0 zoom-in-95"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="text-sm font-semibold">
              Notifications{" "}
              {unread > 0 && (
                <span className="font-normal text-muted-foreground">
                  · {unread} unread
                </span>
              )}
            </div>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-40"
            >
              Mark all as read
            </button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <EmptyState compact />
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  className={cn(
                    "group relative flex gap-3 border-b px-4 py-3 last:border-0",
                    !n.read && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read ? "bg-transparent" : "bg-primary"
                    )}
                  />
                  <Popover.Close asChild>
                    <button
                      onClick={() => open(n)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div
                        className={cn(
                          "text-sm",
                          n.read
                            ? "text-muted-foreground"
                            : "font-semibold text-foreground"
                        )}
                      >
                        {n.title}
                      </div>
                      {n.body && (
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {n.body}
                        </div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {ago(n.createdAt)}
                        {n.readReason && ` · ${n.readReason}`}
                      </div>
                    </button>
                  </Popover.Close>
                  {!n.read && (
                    <button
                      onClick={() => markRead(n.id)}
                      title="Mark as read"
                      className="invisible self-start rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground group-hover:visible"
                    >
                      <Check className="size-4" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Variant B: sidebar row + slide-over ────────────────────────────────────

export function VariantBPanel() {
  const { items, unread, markRead, markAllRead, open, freshIds } =
    useNotifications();
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [isOpen, setIsOpen] = useState(false);
  useTick();

  const shown = tab === "unread" ? items.filter((n) => !n.read) : items;
  const today = shown.filter((n) => Date.now() - n.createdAt < DAY);
  const earlier = shown.filter((n) => Date.now() - n.createdAt >= DAY);

  const Section = ({
    label,
    list,
  }: {
    label: string;
    list: ProtoNotification[];
  }) =>
    list.length === 0 ? null : (
      <div className="mb-4">
        <div className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="space-y-2">
          {list.map((n) => (
            <div
              key={n.id}
              className={cn(
                "relative flex gap-3 rounded-lg border p-3 transition-colors",
                n.read
                  ? "border-transparent bg-transparent opacity-70 hover:bg-muted/50"
                  : "border-l-4 border-l-primary bg-card shadow-sm hover:shadow",
                freshIds.has(n.id) &&
                  !n.read &&
                  "animate-in slide-in-from-right-4 fade-in-0 duration-500"
              )}
            >
              <div
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  kindTint[n.kind]
                )}
              >
                <KindIcon kind={n.kind} className="size-4" />
              </div>
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => {
                  setIsOpen(false);
                  open(n);
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {kindLabel[n.kind]}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {ago(n.createdAt)}
                  </span>
                </div>
                <div
                  className={cn(
                    "mt-0.5 text-sm leading-snug",
                    !n.read && "font-semibold"
                  )}
                >
                  {n.title}
                  {n.groupCount && n.groupCount > 1 && (
                    <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      ×{n.groupCount}
                    </span>
                  )}
                </div>
                {n.body && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {n.body}
                  </div>
                )}
                {n.readReason && (
                  <div className="mt-1 inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    <Check className="size-3" /> {n.readReason}
                  </div>
                )}
              </button>
              {!n.read && (
                <button
                  onClick={() => markRead(n.id)}
                  className="self-start rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Mark read
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    );

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
          <Bell className="size-4" />
          Notifications
          <CountBadge count={unread} className="ml-auto" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 animate-in fade-in-0" />
        <Dialog.Content className="fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l bg-background shadow-2xl animate-in slide-in-from-right duration-300">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">
              Notifications
            </Dialog.Title>
            <Dialog.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="flex items-center justify-between border-b px-5 py-2">
            <div className="flex gap-1 rounded-md bg-muted p-1">
              {(["unread", "all"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium capitalize",
                    tab === t
                      ? "bg-background shadow-sm"
                      : "text-muted-foreground"
                  )}
                >
                  {t}
                  {t === "unread" && unread > 0 && ` (${unread})`}
                </button>
              ))}
            </div>
            <button
              onClick={markAllRead}
              disabled={unread === 0}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all as read
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {shown.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <Section label="Today" list={today} />
                <Section label="Earlier" list={earlier} />
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Variant C: sidebar row → full page ─────────────────────────────────────

export function VariantCNavItem() {
  const { unread, variant } = useNotifications();
  return (
    <NavLink
      to={`/notifications?variant=${variant}`}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        )
      }
    >
      <Inbox className="size-4" />
      Inbox
      {unread > 0 && (
        <span
          key={unread}
          className="ml-auto text-xs font-semibold text-primary animate-in zoom-in-50"
        >
          {unread}
        </span>
      )}
    </NavLink>
  );
}

const FILTERS = [
  "All",
  "Unread",
  "Refunds",
  "Questions",
  "Ratings",
  "Replies",
  "Seats",
] as const;
type Filter = (typeof FILTERS)[number];

export function VariantCPage() {
  const { items, unread, markRead, markAllRead, open, freshIds, variant } =
    useNotifications();
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(() => new Set(items.map((i) => i.id)));
  useTick();

  // Live arrivals while on the page don't reflow the list — they wait behind a pill.
  const pending = items.filter((n) => !seen.has(n.id));
  const visible = items.filter((n) => seen.has(n.id));

  const match = (n: ProtoNotification, f: Filter) =>
    f === "All" || (f === "Unread" ? !n.read : kindLabel[n.kind] === f);
  const shown = visible.filter((n) => match(n, filter));
  const counts = Object.fromEntries(
    FILTERS.map((f) => [f, items.filter((n) => match(n, f)).length])
  ) as Record<Filter, number>;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (variant !== "C") {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        The full Notifications page belongs to variant C.{" "}
        <Link to="?variant=C" className="text-primary underline">
          Switch to C
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inbox</h1>
          <p className="text-sm text-muted-foreground">
            {unread === 0 ? "No unread Notifications" : `${unread} unread`}
          </p>
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => {
                selected.forEach(markRead);
                setSelected(new Set());
              }}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Check className="size-4" /> Mark {selected.size} as read
            </button>
          )}
          <button
            onClick={markAllRead}
            disabled={unread === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <CheckCheck className="size-4" /> Mark all as read
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-6">
        <nav className="space-y-0.5">
          {FILTERS.filter(
            (f) => f === "All" || f === "Unread" || counts[f] > 0
          ).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm",
                filter === f
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              {f}
              <span className="text-xs">{counts[f]}</span>
            </button>
          ))}
        </nav>

        <div>
          {pending.length > 0 && (
            <button
              onClick={() =>
                setSeen((s) => new Set([...s, ...pending.map((p) => p.id)]))
              }
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-md bg-primary/10 py-2 text-sm font-medium text-primary hover:bg-primary/15 animate-in fade-in-0 slide-in-from-top-2"
            >
              <Zap className="size-4" /> {pending.length} new — show
            </button>
          )}
          <div className="overflow-hidden rounded-lg border">
            {shown.length === 0 ? (
              <EmptyState />
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {shown.map((n) => (
                    <tr
                      key={n.id}
                      onClick={() => open(n)}
                      className={cn(
                        "cursor-pointer border-b last:border-0 hover:bg-muted/50",
                        !n.read && "bg-primary/5",
                        freshIds.has(n.id) && "animate-in fade-in-0"
                      )}
                    >
                      <td
                        className="w-10 py-3 pl-4"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(n.id)}
                          onChange={() => toggle(n.id)}
                          className="size-4 accent-primary"
                        />
                      </td>
                      <td className="w-8 py-3">
                        <KindIcon
                          kind={n.kind}
                          className={cn(
                            "size-4",
                            n.read ? "text-muted-foreground" : "text-primary"
                          )}
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div
                          className={cn(
                            n.read
                              ? "text-muted-foreground"
                              : "font-semibold"
                          )}
                        >
                          {n.title}
                        </div>
                        {(n.body || n.readReason) && (
                          <div className="text-xs text-muted-foreground">
                            {[n.body, n.readReason].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </td>
                      <td className="w-28 whitespace-nowrap py-3 pr-2 text-right text-xs text-muted-foreground">
                        {kindLabel[n.kind]} · {ago(n.createdAt)}
                      </td>
                      <td
                        className="w-12 py-3 pr-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!n.read && (
                          <button
                            onClick={() => markRead(n.id)}
                            title="Mark as read"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Check className="size-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Floating switcher (dev only) ───────────────────────────────────────────

function PrototypeSwitcher() {
  const { variant, setVariant, items, unread, simulateArrival, clearAll, reset } =
    useNotifications();
  const idx = VARIANTS.findIndex((v) => v.key === variant);
  const go = useCallback(
    (d: number) =>
      setVariant(VARIANTS[(idx + d + VARIANTS.length) % VARIANTS.length].key),
    [idx, setVariant]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        t.closest("input, textarea, select, [contenteditable]") ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (!import.meta.env.DEV) return null;

  const btn =
    "rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40";
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full bg-zinc-900 px-2 py-1.5 text-xs text-white shadow-2xl ring-1 ring-white/10">
      <button className={btn} onClick={() => go(-1)} title="Previous variant (←)">
        <ChevronLeft className="size-4" />
      </button>
      <span className="min-w-36 text-center font-medium">
        {variant} · {VARIANTS[idx].name}
      </span>
      <button className={btn} onClick={() => go(1)} title="Next variant (→)">
        <ChevronRight className="size-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-white/20" />
      <button
        className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 hover:bg-white/20"
        onClick={simulateArrival}
        title="Push a role-appropriate Notification, as the vendor would"
      >
        <Zap className="size-3.5" /> Simulate arrival
      </button>
      <button className={btn} onClick={clearAll} title="Clear all (empty state)">
        <Trash2 className="size-4" />
      </button>
      <button className={btn} onClick={reset} title="Reset seeded Notifications">
        <RotateCcw className="size-4" />
      </button>
      <span className="ml-1 pr-2 tabular-nums text-white/60">
        {unread}/{items.length} unread
      </span>
    </div>
  );
}
