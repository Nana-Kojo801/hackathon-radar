import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowUpRight, CalendarDays, CalendarRange, Globe, MapPin, Monitor, Shuffle, Tag } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { CalendarButton, ShareButton } from "../components/Actions";
import { SearchField, TopBar } from "../components/Brand";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { fetchData, type Hackathon, type HackathonDetail } from "../lib/api";
import {
  categoryLabel,
  cleanText,
  closesText,
  daysLeft,
  dateRange,
  durationDays,
  eligibilityLabel,
  FORMAT_LABEL,
  fullDate,
  hostOf,
  mainCategory,
  money,
  prizeText,
  sourceName,
  timeAgo,
  timeUtc,
} from "../lib/format";
import { goBack } from "../lib/router";
import { cn } from "../lib/utils";

const FORMAT_ICON = { online: Monitor, in_person: MapPin, hybrid: Shuffle, unknown: Monitor } as const;

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "eligibility", label: "Eligibility" },
  { id: "key-dates", label: "Key dates" },
  { id: "prize-details", label: "Prize details" },
  { id: "source", label: "Source" },
] as const;

const reveal = {
  initial: { opacity: 0, y: 14 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "0px 0px -40px 0px" },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] },
} as const;

interface Props {
  id: string;
  initial?: Hackathon;
  totalCount: number;
  lastRefresh: string | null;
  query: string;
  onSearch: (q: string) => void;
}

export function Details({ id, initial, totalCount, lastRefresh, query, onSearch }: Props) {
  const [detail, setDetail] = useState<HackathonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setDetail(null);
    setError(null);
    fetchData<HackathonDetail>(`h/${id}.json`, `/hackathons/${id}`, ctrl.signal)
      .then(setDetail)
      .catch((e) => !ctrl.signal.aborted && setError(e instanceof Error ? e.message : String(e)));
    return () => ctrl.abort();
  }, [id]);

  const h: Hackathon | undefined = detail ?? initial;

  useEffect(() => {
    if (h) document.title = `${h.title} · Hackathon Radar`;
    return () => {
      document.title = "Hackathon Radar";
    };
  }, [h]);

  return (
    <div>
      <TopBar>
        <div className="ml-auto hidden items-center gap-7 wide:flex">
          <SearchField value={query} onChange={onSearch} placeholder="Search hackathons..." size="sm" className="w-[312px]" />
          <p className="text-[15px] whitespace-nowrap text-ink-2">
            {totalCount} hackathons <span className="mx-2 text-slate">•</span>
            <span className="text-slate">Updated {timeAgo(lastRefresh)}</span>
          </p>
        </div>
      </TopBar>
      {h ? (
        <Loaded h={h} detail={detail} />
      ) : error ? (
        <div className="px-6 py-24 text-center">
          <p className="text-[17px] font-semibold text-ink">We couldn't load this hackathon.</p>
          <p className="mt-1 text-body">{error}</p>
          <Button variant="soft" className="mt-5" onClick={() => goBack("/")}>
            <ArrowLeft className="h-4 w-4" /> All hackathons
          </Button>
        </div>
      ) : (
        <DetailSkeleton />
      )}
    </div>
  );
}

function StatusBadge({ h }: { h: Hackathon }) {
  const s =
    h.status === "open"
      ? { text: "Open", dot: "bg-[#16a34a]", cls: "bg-[#e2f6ed] text-[#124e18]" }
      : h.status === "upcoming"
        ? { text: "Upcoming", dot: "bg-[#2563eb]", cls: "bg-[#e5f1fd] text-[#173e8a]" }
        : { text: "Closed", dot: "bg-[#94a3b8]", cls: "bg-[#eef1f6] text-[#4b5563]" };
  return (
    <span className={cn("inline-flex h-[34px] items-center gap-2.5 rounded-[10px] px-3 text-[15px] font-medium", s.cls)}>
      <span className="relative flex h-2.5 w-2.5">
        {h.status === "open" && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-50", s.dot)} />}
        <span className={cn("relative h-2.5 w-2.5 rounded-full", s.dot)} />
      </span>
      {s.text}
    </span>
  );
}

/** "Closes in 12 days" for the summary card; nothing when there's no deadline. */
function closesIn(h: Hackathon): { text: string; tone: "red" | "sky" | "grey" } | null {
  const days = daysLeft(h);
  if (days === null) return null;
  if (days < 0) return { text: "Registration closed", tone: "grey" };
  return { text: closesText(days), tone: days <= 7 ? "red" : "sky" };
}

function statusNote(h: Hackathon): string {
  if (h.status === "open") return "Registrations are currently open. Check the organizer's page for the latest updates.";
  if (h.status === "upcoming") return "This hackathon hasn't started yet. Check the organizer's page for registration details.";
  return "Registration has closed. Check the organizer's page for future editions.";
}

function Loaded({ h, detail }: { h: Hackathon; detail: HackathonDetail | null }) {
  const elig = eligibilityLabel(h);
  const cat = mainCategory(h);
  const regDate = fullDate(h.registration_deadline);
  const regTime = timeUtc(h.registration_deadline);
  const dates = dateRange(h.start_date, h.end_date);
  const days = durationDays(h.start_date, h.end_date);
  const source = sourceName(h);
  const checked = timeAgo(h.last_seen_at);
  const paragraphs = useMemo(
    () => (detail?.description ?? "").split(/\n\s*\n/).map(cleanText).filter(Boolean),
    [detail?.description],
  );
  const description = paragraphs.join(" ");
  const lead = h.summary || (description ? description.split(/(?<=[.!?])\s/)[0] : null);
  const prizes = detail?.prizes ?? [];
  const register = `Register on ${source === "the web" ? hostOf(h.source_url) : source}`;

  const eligibility = [
    h.international_ok === true
      ? "International entries welcome"
      : h.international_ok === false
        ? "Open to some regions only"
        : "International eligibility: not specified",
    `Student-only: ${h.student_only === true ? "yes" : h.student_only === false ? "no" : "not specified"}`,
    "Check organizer rules for full eligibility details.",
  ];

  const FormatIcon = FORMAT_ICON[h.format];
  const formatIcon = <FormatIcon className="h-[22px] w-[22px] text-[#0e5e75]" strokeWidth={1.8} />;
  const globe = <Globe className="h-[22px] w-[22px] text-[#2563eb]" strokeWidth={1.8} />;
  const tag = <Tag className="h-[21px] w-[21px] text-ink" strokeWidth={1.8} />;
  const countdown = closesIn(h);
  const cal = <CalendarDays className="h-[21px] w-[21px] text-orange" strokeWidth={1.9} />;
  const eligPill = <Badge tone={elig.tone}>{elig.text}</Badge>;
  const catPill = cat ? <Badge tone="blue">{categoryLabel(cat)}</Badge> : <span className="text-[16px] whitespace-nowrap text-body">Not tagged</span>;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="pb-28 wide:pb-12">
      <div className="px-5 pt-4 wide:px-9 wide:pt-3">
        <div className="flex items-center justify-between">
          <Button variant="soft" size="sm" className="h-[34px] rounded-[10px] px-3 text-[15px]" onClick={() => goBack("/")}>
            <ArrowLeft className="h-[18px] w-[18px]" strokeWidth={2} />
            All hackathons
          </Button>
          <StatusBadge h={h} />
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 text-[30px] leading-[1.1] font-extrabold tracking-[-0.025em] text-ink wide:mt-3 wide:text-[50px]"
        >
          {h.title}
        </motion.h1>
        {h.organizer && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.08 }} className="mt-1.5 text-[17px] text-[#495184] wide:text-[19.5px]">
            Organized by <span className="font-semibold text-teal-text">{h.organizer}</span>
          </motion.p>
        )}

        {/* Desktop stats strip */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-7 hidden items-stretch divide-x divide-line wide:flex"
        >
          <Stat label="Prize pool" first>
            <div className="text-[29px] leading-tight font-bold tracking-[-0.01em] whitespace-nowrap text-ink">{prizeText(h)}</div>
          </Stat>
          <Stat label="Registration deadline">
            <IconLine icon={cal}>{regDate ?? "Not announced"}</IconLine>
            {regTime && <div className="mt-1 pl-[33px] text-[14px] text-slate">{regTime}</div>}
          </Stat>
          <Stat label="Event dates">
            <IconLine icon={cal}>{dates ?? "TBA"}</IconLine>
            {days && <div className="mt-1 pl-[33px] text-[14px] text-slate">{days}</div>}
          </Stat>
          <Stat label="Format">
            <IconLine icon={formatIcon}>{FORMAT_LABEL[h.format]}</IconLine>
          </Stat>
          <Stat label="Eligibility">
            <IconLine icon={globe}>{eligPill}</IconLine>
          </Stat>
          <Stat label="Category" last>
            <IconLine icon={tag}>{catPill}</IconLine>
          </Stat>
        </motion.div>

        {/* Mobile key facts: one summary card */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-5 overflow-hidden rounded-[14px] border border-line wide:hidden"
        >
          <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-[#eef8fb] to-[#f7fbfd] px-4 pt-3.5 pb-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-slate">Prize pool</div>
              <div className="mt-0.5 text-[26px] leading-tight font-bold tracking-[-0.01em] text-ink">{prizeText(h)}</div>
            </div>
            {countdown && (
              <Badge tone={countdown.tone} size="sm" className="mt-0.5 shrink-0 rounded-full px-2.5">
                {countdown.text}
              </Badge>
            )}
          </div>
          <div className="divide-y divide-line">
            <FactRow icon={<CalendarDays className="h-[18px] w-[18px]" strokeWidth={2} />} label="Registration deadline" value={regDate ?? "Not announced"} meta={regTime} />
            <FactRow icon={<CalendarRange className="h-[18px] w-[18px]" strokeWidth={2} />} label="Event dates" value={dates ?? "TBA"} meta={days} />
            <div className="flex flex-wrap gap-2 px-4 py-3.5">
              <Badge tone="grey" size="sm" className="h-[28px] gap-1.5 text-[13.5px] text-ink-2" title="Format">
                <span className="sr-only">Format: </span>
                <FormatIcon className="h-[15px] w-[15px] text-[#0e5e75]" strokeWidth={2} />
                {FORMAT_LABEL[h.format]}
              </Badge>
              <Badge tone={elig.tone} size="sm" className="h-[28px] gap-1.5 text-[13.5px]" title="Eligibility">
                <span className="sr-only">Eligibility: </span>
                <Globe className="h-[15px] w-[15px]" strokeWidth={2} />
                {elig.text}
              </Badge>
              {cat && (
                <Badge tone="blue" size="sm" className="h-[28px] gap-1.5 text-[13.5px]" title="Category">
                  <span className="sr-only">Category: </span>
                  <Tag className="h-[15px] w-[15px]" strokeWidth={2} />
                  {categoryLabel(cat)}
                </Badge>
              )}
            </div>
          </div>
        </motion.div>

        <div className="mt-3 grid grid-cols-2 gap-2.5 wide:hidden">
          <CalendarButton h={h} />
          <ShareButton h={h} />
        </div>

        <Tabs />

        <div className="wide:mt-6 wide:grid wide:grid-cols-[minmax(0,1fr)_310px] wide:gap-9">
          <div className="min-w-0">
            <Section id="overview" title="Overview" first>
              {lead && <p className="text-[16.5px] leading-snug text-lead wide:text-[19px]">{lead}</p>}
              {description && description !== lead ? (
                <Expandable paragraphs={paragraphs} />
              ) : !detail ? (
                <div className="mt-3 space-y-2">
                  <div className="skeleton h-4 w-full rounded" />
                  <div className="skeleton h-4 w-4/5 rounded" />
                </div>
              ) : !lead ? (
                <p className="text-[16px] text-body">No description yet. See the organizer's page for details.</p>
              ) : null}
            </Section>

            <Section id="eligibility" title="Eligibility">
              <ul className="space-y-1 pl-1">
                {eligibility.map((e) => (
                  <li key={e} className="flex gap-3 text-[15.5px] text-ink-2/85 wide:text-[17px]">
                    <span className="mt-[9px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#64748b] wide:mt-[10px]" />
                    <span className="pl-2">{e}</span>
                  </li>
                ))}
              </ul>
            </Section>

            <Section id="key-dates" title="Key dates">
              <dl>
                <DateRow label="Registration deadline" value={regDate ?? "Not announced"} sub={regTime} />
                <DateRow label="Event dates" value={dates ?? "TBA"} sub={days} last />
              </dl>
            </Section>

            <Section id="prize-details" title="Prize details" inline>
              <div className="flex flex-col gap-1 wide:flex-row wide:gap-9">
                <span className="text-[17px] font-semibold whitespace-nowrap text-ink">{prizeText(h)}</span>
                <span className="text-[14.5px] leading-snug text-body">
                  {h.prize_usd == null ? "No prize pool has been announced yet." : "Total advertised prize pool."}
                  <br />
                  {prizes.length ? "Breakdown as listed by the organizer:" : "See organizer for breakdown."}
                </span>
              </div>
              {prizes.length > 0 && <PrizeList prizes={prizes} />}
            </Section>

            <Section id="source" title="Source" inline last>
              <p className="text-[16px] text-ink">
                <span className="font-semibold">{source}</span> <span className="text-slate">· Checked {checked}</span>
              </p>
              <p className="mt-1 text-[13.5px] leading-snug text-body">
                Event information from {source}. Details may change — check the organizer's page for the latest information.
              </p>
              {h.alt_urls.length > 0 && (
                <p className="mt-2 text-[13.5px] text-body">
                  Also listed on{" "}
                  {h.alt_urls.map((u, i) => (
                    <span key={u}>
                      {i > 0 && ", "}
                      <a href={u} target="_blank" rel="noopener noreferrer" className="font-medium text-teal-text underline-offset-2 hover:underline">
                        {hostOf(u)}
                      </a>
                    </span>
                  ))}
                </p>
              )}
            </Section>
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden wide:block">
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.45, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="sticky top-[72px] border-l border-line pt-5 pl-6"
            >
              <Button asChild variant="primary" size="lg" className="h-[46px] w-full rounded-[8px] text-[17px]">
                <a href={h.source_url} target="_blank" rel="noopener noreferrer">
                  {register}
                  <ArrowUpRight className="h-[18px] w-[18px] transition-transform group-hover:translate-x-0.5" strokeWidth={2} />
                </a>
              </Button>
              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <CalendarButton h={h} className="h-10 text-[14.5px]" />
                <ShareButton h={h} className="h-10 text-[14.5px]" />
              </div>
              <dl className="mt-4">
                <SideRow label="Format" icon={formatIcon}>
                  <span className="text-[16.5px] font-medium text-ink">{FORMAT_LABEL[h.format]}</span>
                </SideRow>
                <SideRow label="Eligibility" icon={globe}>
                  {/* The sidebar is narrow: let a long label wrap inside the pill. */}
                  <Badge tone={elig.tone} className="h-auto min-h-[30px] py-1 leading-snug whitespace-normal">
                    {elig.text}
                  </Badge>
                </SideRow>
                <SideRow label="Category" icon={tag} last>
                  {catPill}
                </SideRow>
              </dl>
              <div className="border-t border-line py-4">
                <div className="text-[15px] text-slate">Organizer</div>
                <div className="mt-1 text-[16.5px] text-ink">{h.organizer ?? "Not listed"}</div>
              </div>
              <div className="border-t border-line py-4">
                <div className="text-[15px] text-slate">Source</div>
                <div className="mt-1 text-[16.5px] font-semibold text-ink">{source}</div>
                <div className="text-[15px] text-slate">Checked {checked}</div>
              </div>
              <div className="border-t border-line py-4">
                <div className="flex items-center gap-3 text-[16.5px] font-medium text-ink">
                  <span className={cn("h-3 w-3 rounded-full", h.status === "open" ? "bg-[#15803d]" : h.status === "upcoming" ? "bg-[#2563eb]" : "bg-[#94a3b8]")} />
                  {h.status === "open" ? "Open" : h.status === "upcoming" ? "Upcoming" : "Closed"}
                </div>
                <p className="mt-1 pl-6 text-[15px] leading-snug text-body">{statusNote(h)}</p>
              </div>
            </motion.div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky register */}
      <motion.div
        initial={{ y: 80 }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 30, delay: 0.2 }}
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur wide:hidden"
      >
        <Button asChild variant="primary" size="lg" className="h-12 w-full rounded-[8px] text-[17px]">
          <a href={h.source_url} target="_blank" rel="noopener noreferrer">
            {register}
            <ArrowUpRight className="h-[18px] w-[18px]" strokeWidth={2} />
          </a>
        </Button>
      </motion.div>
    </motion.div>
  );
}

function Stat({ label, children, first, last }: { label: string; children: ReactNode; first?: boolean; last?: boolean }) {
  return (
    <div className={cn("min-w-0 flex-[0_1_auto] px-5", first && "shrink-0 pl-0", last && "pr-0")}>
      <div className="mb-2 text-[14.5px] text-slate">{label}</div>
      {children}
    </div>
  );
}

function FactRow({ icon, label, value, meta }: { icon: ReactNode; label: string; value: string; meta: string | null }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#fff1e6] text-orange">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] text-slate">{label}</div>
        <div className="text-[15.5px] leading-snug font-semibold text-ink">
          <Breakable text={value} />
        </div>
      </div>
      {meta && <div className="shrink-0 self-end pb-px text-[12.5px] text-slate">{meta}</div>}
    </div>
  );
}

function IconLine({ icon, children, small }: { icon: ReactNode; children: ReactNode; small?: boolean }) {
  return (
    <div className={cn("flex items-start gap-2.5 leading-[1.4] font-semibold text-ink", small ? "text-[15.5px]" : "text-[19px]")}>
      <span className="flex h-[1.4em] w-[22px] shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0">{typeof children === "string" ? <Breakable text={children} /> : children}</span>
    </div>
  );
}

/** Long dates may wrap, but only between the two ends of a range, never inside a date. */
function Breakable({ text }: { text: string }) {
  const parts = text.split(" – ");
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " – "}
          <span className="whitespace-nowrap">{part}</span>
        </span>
      ))}
    </>
  );
}

function Tabs() {
  const [active, setActive] = useState<string>("overview");
  const clicking = useRef(false);

  useEffect(() => {
    const els = TABS.map((t) => document.getElementById(t.id)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        if (clicking.current) return;
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const go = (id: string) => {
    setActive(id);
    clicking.current = true;
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 70, behavior: "smooth" });
    setTimeout(() => (clicking.current = false), 700);
  };

  return (
    <nav className="sticky top-0 z-10 -mx-9 mt-8 hidden bg-white/95 px-9 backdrop-blur wide:block" aria-label="Sections">
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => go(t.id)}
            aria-current={active === t.id ? "true" : undefined}
            className={cn(
              "relative px-4 pt-1 pb-3.5 text-[16px] transition-colors first:pl-4",
              active === t.id ? "font-medium text-[#017a92]" : "text-[#555a88] hover:text-ink",
            )}
          >
            {t.label}
            {active === t.id && (
              <motion.span layoutId="tab-underline" className="absolute inset-x-0 -bottom-px h-[2.5px] rounded-full bg-[#03879a]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Section({ id, title, children, first, last, inline }: { id: string; title: string; children: ReactNode; first?: boolean; last?: boolean; inline?: boolean }) {
  return (
    <motion.section
      id={id}
      {...reveal}
      className={cn(
        "scroll-mt-20 border-line py-5",
        !last && "border-b",
        first && "pt-6 wide:pt-0",
        inline && "wide:grid wide:grid-cols-[280px_minmax(0,1fr)] wide:items-baseline",
      )}
    >
      <h2 className={cn("text-[24px] font-bold tracking-[-0.015em] text-ink wide:text-[30px]", inline ? "mb-2 wide:mb-0" : "mb-2")}>{title}</h2>
      <div>{children}</div>
    </motion.section>
  );
}

function DateRow({ label, value, sub, last }: { label: string; value: string; sub?: string | null; last?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[1fr_1.1fr] gap-4 py-2.5 wide:grid-cols-[280px_minmax(0,1fr)]", !last && "border-b border-line")}>
      <dt className="text-[15.5px] text-slate wide:text-[17px]">{label}</dt>
      <dd>
        <div className="text-[15.5px] font-semibold text-ink wide:text-[17px]">{value}</div>
        {sub && <div className="text-[14.5px] text-slate wide:text-[15.5px]">{sub}</div>}
      </dd>
    </div>
  );
}

function SideRow({ label, icon, children, last }: { label: string; icon: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <div className={cn("grid grid-cols-[96px_minmax(0,1fr)] items-center py-3", !last && "border-b border-line")}>
      <dt className="text-[15.5px] text-slate">{label}</dt>
      <dd className="flex items-center gap-3">
        <span className="flex w-[22px] justify-center">{icon}</span>
        {children}
      </dd>
    </div>
  );
}

function Expandable({ paragraphs }: { paragraphs: string[] }) {
  const [open, setOpen] = useState(false);
  const long = paragraphs.join(" ").length > 420 || paragraphs.length > 3;
  return (
    <div className="mt-2">
      <motion.div
        initial={false}
        animate={{ height: open || !long ? "auto" : 96 }}
        transition={{ type: "spring", stiffness: 260, damping: 34 }}
        className="relative overflow-hidden"
      >
        <div className="space-y-2.5 text-[14.5px] leading-[1.55] text-body wide:text-[15.5px]">
          {paragraphs.map((t, i) => (
            <p key={i}>{t}</p>
          ))}
        </div>
        {long && !open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />}
      </motion.div>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1.5 text-[15px] font-semibold text-teal-text hover:underline">
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function PrizeList({ prizes }: { prizes: HackathonDetail["prizes"] }) {
  const [all, setAll] = useState(false);
  const shown = useMemo(() => (all ? prizes : prizes.slice(0, 6)), [all, prizes]);
  return (
    <div className="mt-4">
      <ul className="divide-y divide-line rounded-[12px] border border-line">
        <AnimatePresence initial={false}>
          {shown.map((p, i) => (
            <motion.li
              key={`${p.name}-${i}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-start justify-between gap-4 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="text-[15.5px] font-medium text-ink">{p.name}</div>
                {p.perks.length > 0 && <div className="mt-0.5 text-[13.5px] leading-snug text-body">{p.perks.join(" · ")}</div>}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[15.5px] font-semibold whitespace-nowrap text-ink">
                  {p.amount_text ?? (p.amount_usd ? money(p.amount_usd) : "Non-cash")}
                </div>
                {p.winners > 1 && <div className="text-[13px] text-slate">each, {p.winners} winners</div>}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {prizes.length > 6 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-2 text-[15px] font-semibold text-teal-text hover:underline">
          {all ? "Show fewer prizes" : `Show all ${prizes.length} prizes`}
        </button>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="px-5 pt-4 wide:px-9">
      <div className="flex justify-between">
        <div className="skeleton h-[34px] w-40 rounded-[10px]" />
        <div className="skeleton h-[34px] w-20 rounded-[10px]" />
      </div>
      <div className="skeleton mt-5 h-12 w-3/4 rounded-lg" />
      <div className="skeleton mt-3 h-5 w-1/3 rounded" />
      <div className="mt-8 grid grid-cols-2 gap-6 wide:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton h-7 w-full rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
