import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import clsx from "clsx";
import {
  Plus,
  Pencil,
  Trash2,
  FileSpreadsheet,
  Upload,
  Siren,
  TriangleAlert,
  CalendarCheck,
  HeartPulse,
  Ban,
  UserX,
  Repeat,
  RotateCcw,
  ChartPie,
  Table2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  api,
  apiErrorMessage,
  downloadFile,
  uploadErrorMessage,
} from "../api/client";
import { useSiteParams } from "../hooks/useSiteParams";
import { useSelectableSites } from "../hooks/useReferenceData";
import { useAuth } from "../contexts/AuthContext";
import type {
  HseAccident,
  HseAccidentDecision,
  HseAccidentSummary,
  HseAccidentType,
  Paginated,
} from "../types";
import { PageHeader } from "../components/ui/PageHeader";
import { Button } from "../components/ui/Button";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable, type Column } from "../components/ui/DataTable";
import { Pagination } from "../components/ui/Pagination";
import { Modal } from "../components/ui/Modal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { SelectField, TextAreaField, TextField } from "../components/ui/Field";
import { EmployeeSelect } from "../components/ui/EmployeeSelect";
import { KpiCard } from "../components/ui/KpiCard";
import { DonutStat } from "../components/ui/DonutStat";
import { ChartTooltip } from "../components/ui/ChartTooltip";

const DAYS = [
  "Dimanche",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
];
const MONTHS = [
  "Janv.",
  "Févr.",
  "Mars",
  "Avr.",
  "Mai",
  "Juin",
  "Juil.",
  "Août",
  "Sept.",
  "Oct.",
  "Nov.",
  "Déc.",
];

const DECISIONS: {
  value: HseAccidentDecision;
  label: string;
  color: string;
  badge: string;
}[] = [
  {
    value: "map",
    label: "Mise à pied (MAP)",
    color: "#a855f7",
    badge:
      "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
  },
  {
    value: "repos_maladie",
    label: "Repos maladie",
    color: "#3b82f6",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  },
  {
    value: "licenciement",
    label: "Licenciement",
    color: "#ef4444",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  },
  {
    value: "avertissement",
    label: "Avertissement",
    color: "#f59e0b",
    badge:
      "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  {
    value: "en_poste",
    label: "En poste",
    color: "#22c55e",
    badge:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  {
    value: "autre",
    label: "Autre",
    color: "#64748b",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
];
const decisionMeta = (d: HseAccidentDecision | null) =>
  DECISIONS.find((x) => x.value === d);

const SHIFT_LABELS: Record<number, string> = {
  1: "1er shift",
  2: "2ème shift",
  3: "3ème shift",
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "29/04/2026 - Mercredi", like the company's bilan. */
function dayLabel(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return {
    date: `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`,
    day: DAYS[new Date(y, m - 1, d).getDay()],
  };
}

/** "18:30:00" -> "18H30" */
function timeLabel(t: string | null) {
  return t ? `${Number(t.slice(0, 2))}H${t.slice(3, 5)}` : null;
}

function daysBetween(from: string, to: string) {
  const [a, b] = [from, to].map((s) => {
    const [y, m, d] = s.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  });
  return Math.round((b - a) / 86400000);
}

/** Seniority at the event date from a fiche's entry date: "1 an et 7 mois", "4 mois", "12 jours". */
function seniority(entry: string | null | undefined, at: string) {
  if (!entry) return "";
  const [y1, m1, d1] = entry.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = at.slice(0, 10).split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  if (months < 0) return "";
  if (months === 0) {
    const days = daysBetween(entry, at);
    return `${days} jour${days > 1 ? "s" : ""}`;
  }
  const years = Math.floor(months / 12);
  months %= 12;
  return [
    years ? `${years} an${years > 1 ? "s" : ""}` : "",
    months ? `${months} mois` : "",
  ]
    .filter(Boolean)
    .join(" et ");
}

function TypeBadge({ type }: { type: HseAccidentType }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        type === "accident"
          ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
      )}
    >
      {type === "accident" ? <Siren size={12} /> : <TriangleAlert size={12} />}
      {type === "accident" ? "Accident" : "Incident"}
    </span>
  );
}

function ChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900",
        className,
      )}
    >
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function NoData({ height = "h-56" }: { height?: string }) {
  return (
    <div
      className={clsx(
        "flex items-center justify-center text-sm text-slate-400 dark:text-slate-500",
        height,
      )}
    >
      Aucune donnée
    </div>
  );
}

export default function HseAccidentsPage() {
  const { user } = useAuth();
  const siteParams = useSiteParams();
  const queryClient = useQueryClient();
  const isHse = user?.role === "hse";
  const fileInput = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [decision, setDecision] = useState("");
  const defaultFrom = `${new Date().getFullYear()}-01-01`;
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(today());
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<HseAccident | null | undefined>(
    undefined,
  );
  const [deleting, setDeleting] = useState<HseAccident | null>(null);
  const [importing, setImporting] = useState(false);
  const [skipped, setSkipped] = useState<string[] | null>(null);
  // The table is the page; the KPIs and charts live in "Synthèse" (?vue=synthese, so Back returns to the table).
  const [searchParams, setSearchParams] = useSearchParams();
  const isSynthese = searchParams.get("vue") === "synthese";
  const setSynthese = (on: boolean) =>
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (on) next.set("vue", "synthese");
      else next.delete("vue");
      return next;
    });

  const filters = {
    ...siteParams,
    search,
    type,
    decision,
    date_from: dateFrom,
    date_to: dateTo,
  };

  const listQuery = useQuery({
    queryKey: ["hse-accidents", "list", filters, page],
    queryFn: () =>
      api
        .get<Paginated<HseAccident>>("/hse-accidents", {
          params: { ...filters, page },
        })
        .then((r) => r.data),
  });
  const summaryQuery = useQuery({
    queryKey: ["hse-accidents", "summary", filters],
    queryFn: () =>
      api
        .get<HseAccidentSummary>("/hse-accidents/summary", { params: filters })
        .then((r) => r.data),
    enabled: isSynthese,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/hse-accidents/${id}`),
    onSuccess: () => {
      toast.success("Événement supprimé.");
      queryClient.invalidateQueries({ queryKey: ["hse-accidents"] });
      setDeleting(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const hasFilters =
    search !== "" ||
    type !== "" ||
    decision !== "" ||
    dateFrom !== defaultFrom ||
    dateTo !== today();
  function resetFilters() {
    setSearch("");
    setType("");
    setDecision("");
    setDateFrom(defaultFrom);
    setDateTo(today());
    setPage(1);
  }

  const canEdit = (a: HseAccident) => !isHse || a.created_by === user?.id;
  const changeFilter =
    <T,>(set: (v: T) => void) =>
    (v: T) => (set(v), setPage(1));

  async function importFile(file: File) {
    setImporting(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await api.post<{
        created: number;
        updated: number;
        total: number;
        skipped: string[];
      }>("/hse-accidents/import", form);
      toast.success(
        `${data.total} ligne(s) importée(s) : ${data.created} ajoutée(s), ${data.updated} mise(s) à jour.`,
        { duration: 6000 },
      );
      if (data.skipped.length) setSkipped(data.skipped);
      // Show everything that was imported, whatever its year.
      setDateFrom("");
      setPage(1);
      queryClient.invalidateQueries({ queryKey: ["hse-accidents"] });
    } catch (err) {
      toast.error(uploadErrorMessage(err, file), { duration: 8000 });
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function exportExcel() {
    downloadFile("/hse-accidents/export", filters, "bilan-atit.xlsx").catch(
      () => toast.error("Échec de l'export Excel."),
    );
  }

  const s = summaryQuery.data;
  const daysWithoutAccident = s?.totals.last_accident_date
    ? Math.max(daysBetween(s.totals.last_accident_date, today()), 0)
    : null;
  const monthData = useMemo(
    () =>
      (s?.by_month ?? []).map((m) => {
        const [y, mo] = m.month.split("-").map(Number);
        return { ...m, label: `${MONTHS[mo - 1]} ${String(y).slice(2)}` };
      }),
    [s],
  );

  const columns: Column<HseAccident>[] = [
    {
      header: "Date",
      accessor: (a) => {
        const { date, day } = dayLabel(a.occurred_on);
        return (
          <div className="whitespace-nowrap">
            <div className="font-medium text-slate-900 dark:text-slate-100">
              {date}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {day}
              {a.occurred_time && ` · ${timeLabel(a.occurred_time)}`}
              {a.shift && ` · ${a.shift === 1 ? "1er" : `${a.shift}ème`} shift`}
            </div>
          </div>
        );
      },
    },
    { header: "Type", accessor: (a) => <TypeBadge type={a.type} /> },
    {
      header: "Site / Zone",
      accessor: (a) => (
        <div>
          <div className="whitespace-nowrap text-slate-900 dark:text-slate-100">
            {a.site?.name ?? "—"}
          </div>
          {a.zone && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {a.zone}
            </div>
          )}
        </div>
      ),
    },
    {
      header: "Chauffeur",
      accessor: (a) => (
        <div className="min-w-36">
          <div className="font-medium text-slate-900 dark:text-slate-100">
            {a.driver_name}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {[
              a.driver_age ? `${a.driver_age} ans` : null,
              a.driver_seniority ? `Ancienneté ${a.driver_seniority}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      header: "Matériel",
      accessor: (a) => (
        <span className="font-mono text-xs font-semibold">
          {a.equipment || "—"}
        </span>
      ),
    },
    {
      header: "Détails de l'événement",
      accessor: (a) => (
        <div className="min-w-56 max-w-sm text-sm">{a.description}</div>
      ),
    },
    {
      header: "Causes",
      accessor: (a) => (
        <div className="min-w-48 max-w-xs text-sm text-slate-600 dark:text-slate-300">
          {a.causes || "—"}
        </div>
      ),
    },
    {
      header: "Décision",
      accessor: (a) =>
        a.decision ? (
          <span
            className={clsx(
              "inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
              decisionMeta(a.decision)?.badge,
            )}
          >
            {a.decision_label}
          </span>
        ) : (
          <span className="text-xs text-slate-400 dark:text-slate-500">
            À décider
          </span>
        ),
    },
    {
      header: "Actions",
      accessor: (a) =>
        canEdit(a) ? (
          <div className="flex items-center gap-1">
            <button
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              title="Modifier"
              onClick={() => setEditing(a)}
            >
              <Pencil size={16} />
            </button>
            <button
              className="rounded-md p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/15"
              title="Supprimer"
              onClick={() => setDeleting(a)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ) : null,
    },
  ];

  const selectClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suivi ATIT"
        description="Accidents et incidents de travail : saisie, suivi des décisions et bilan global"
        actions={
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) =>
                e.target.files?.[0] && importFile(e.target.files[0])
              }
            />
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
              title="Importer un « Bilan global des accidents » (.xlsx)"
            >
              <Upload size={16} /> {importing ? "Import…" : "Importer"}
            </Button>
            <Button
              variant={isSynthese ? "primary" : "secondary"}
              onClick={() => setSynthese(!isSynthese)}
            >
              {isSynthese ? <Table2 size={16} /> : <ChartPie size={16} />}{" "}
              {isSynthese ? "Tableau" : "Synthèse"}
            </Button>
            <Button variant="secondary" onClick={exportExcel}>
              <FileSpreadsheet size={16} /> Export Excel
            </Button>
            <Button
              variant={isSynthese ? "secondary" : "primary"}
              onClick={() => setEditing(null)}
            >
              <Plus size={16} /> Déclarer
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-64">
          <SearchInput
            placeholder="Chauffeur, matériel, zone, cause…"
            value={search}
            onChange={(e) => changeFilter(setSearch)(e.target.value)}
          />
        </div>
        <select
          value={type}
          onChange={(e) => changeFilter(setType)(e.target.value)}
          className={selectClass}
        >
          <option value="">Accidents et incidents</option>
          <option value="accident">Accidents</option>
          <option value="incident">Incidents</option>
        </select>
        <select
          value={decision}
          onChange={(e) => changeFilter(setDecision)(e.target.value)}
          className={selectClass}
        >
          <option value="">Toutes les décisions</option>
          {DECISIONS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
          <option value="none">À décider</option>
        </select>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>Du</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => changeFilter(setDateFrom)(e.target.value)}
            className={selectClass}
          />
          <span>au</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => changeFilter(setDateTo)(e.target.value)}
            className={selectClass}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
            title="Effacer la recherche et revenir à l'année en cours"
          >
            <RotateCcw size={15} /> Réinitialiser
          </button>
        )}
      </div>

      {isSynthese && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Accidents"
              value={s?.totals.accidents ?? "—"}
              icon={Siren}
              tone="red"
            />
            <KpiCard
              label="Incidents"
              value={s?.totals.incidents ?? "—"}
              icon={TriangleAlert}
              tone="amber"
            />
            <KpiCard
              label={
                daysWithoutAccident === null
                  ? "Aucun accident sur la période"
                  : "Jours sans accident"
              }
              value={daysWithoutAccident ?? "—"}
              icon={CalendarCheck}
              tone="green"
            />
            <KpiCard
              label={`Jours de repos maladie (${s?.totals.sick_count ?? 0} cas)`}
              value={s?.totals.sick_days ?? "—"}
              icon={HeartPulse}
              tone="blue"
            />
            <KpiCard
              label={`Jours de mise à pied (${s?.totals.map_count ?? 0} cas)`}
              value={s?.totals.map_days ?? "—"}
              icon={Ban}
              tone="purple"
            />
            <KpiCard
              label="Licenciements"
              value={s?.totals.licenciements ?? "—"}
              icon={UserX}
              tone="slate"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <ChartCard title="Évolution mensuelle" className="lg:col-span-2">
              {monthData.length === 0 ? (
                <NoData />
              ) : (
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart
                      data={monthData}
                      margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        strokeOpacity={0.2}
                        vertical={false}
                      />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: "rgba(148,163,184,0.08)", radius: 6 }}
                        content={<ChartTooltip showTotal />}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="accidents"
                        name="Accidents"
                        stackId="a"
                        fill="#ef4444"
                        radius={[0, 0, 0, 0]}
                        maxBarSize={36}
                      />
                      <Bar
                        dataKey="incidents"
                        name="Incidents"
                        stackId="a"
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            <DonutStat
              title="Décisions prises"
              segments={(s?.by_decision ?? []).map((d) => ({
                name: d.decision
                  ? (decisionMeta(d.decision)?.label ?? d.label)
                  : "À décider",
                value: d.count,
                color: d.decision
                  ? (decisionMeta(d.decision)?.color ?? "#64748b")
                  : "#cbd5e1",
              }))}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            {(s?.by_site.length ?? 0) > 1 ? (
              <ChartCard title="Par site">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart
                      data={s?.by_site}
                      margin={{ top: 5, right: 10, left: -20, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="#334155"
                        strokeOpacity={0.2}
                        vertical={false}
                      />
                      <XAxis dataKey="site_name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip
                        cursor={{ fill: "rgba(148,163,184,0.08)", radius: 6 }}
                        content={<ChartTooltip showTotal />}
                      />
                      <Bar
                        dataKey="accidents"
                        name="Accidents"
                        stackId="a"
                        fill="#ef4444"
                        maxBarSize={36}
                      />
                      <Bar
                        dataKey="incidents"
                        name="Incidents"
                        stackId="a"
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={36}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </ChartCard>
            ) : null}

            <DonutStat
              title="Par shift"
              segments={(s?.by_shift ?? []).map((x, i) => ({
                name: x.shift ? SHIFT_LABELS[x.shift] : "Non renseigné",
                value: x.count,
                color: x.shift
                  ? ["#3b82f6", "#6366f1", "#0ea5e9"][i % 3]
                  : "#cbd5e1",
              }))}
            />

            <ChartCard
              title="Accidents répétés"
              className={(s?.by_site.length ?? 0) > 1 ? "" : "lg:col-span-2"}
            >
              {!s ||
              (s.repeat_drivers.length === 0 &&
                s.repeat_equipment.length === 0) ? (
                <NoData height="h-40" />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { title: "Chauffeurs", rows: s.repeat_drivers },
                    { title: "Matériels", rows: s.repeat_equipment },
                  ].map((g) => (
                    <div key={g.title}>
                      <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {g.title}
                      </div>
                      {g.rows.length === 0 ? (
                        <div className="text-sm text-slate-400 dark:text-slate-500">
                          Aucun accident répété
                        </div>
                      ) : (
                        <ul className="space-y-1.5">
                          {g.rows.map((r) => (
                            <li key={r.label}>
                              <button
                                type="button"
                                onClick={() => (
                                  changeFilter(setSearch)(r.label),
                                  setSynthese(false)
                                )}
                                title="Voir ces événements dans le tableau"
                                className="flex w-full items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-left text-sm hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800"
                              >
                                <span className="truncate text-slate-800 dark:text-slate-200">
                                  {r.label}
                                </span>
                                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                                  <Repeat size={11} /> {r.count}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}

      {!isSynthese && (
        <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <DataTable
            columns={columns}
            rows={listQuery.data?.data ?? []}
            isLoading={listQuery.isLoading}
            keyFn={(a) => a.id}
            emptyMessage="Aucun accident ni incident sur la période."
          />
          {listQuery.data && (
            <Pagination
              page={listQuery.data.current_page}
              lastPage={listQuery.data.last_page}
              total={listQuery.data.total}
              onPageChange={setPage}
            />
          )}
        </div>
      )}

      {editing !== undefined && (
        <AccidentFormModal
          accident={editing}
          onClose={() => setEditing(undefined)}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title={
          deleting?.type === "incident"
            ? "Supprimer l'incident"
            : "Supprimer l'accident"
        }
        message={`L'événement du ${deleting ? dayLabel(deleting.occurred_on).date : ""} (${deleting?.driver_name}) sera supprimé. Continuer ?`}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        isLoading={deleteMutation.isPending}
      />

      <Modal
        open={!!skipped}
        onClose={() => setSkipped(null)}
        title="Lignes non importées"
      >
        <ul className="max-h-80 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-slate-700 dark:text-slate-300">
          {skipped?.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setSkipped(null)}>
            Fermer
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 border-t border-slate-100 pt-4 first:border-t-0 first:pt-0 dark:border-slate-800">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function AccidentFormModal({
  accident,
  onClose,
}: {
  accident: HseAccident | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { sites, needsSiteSelect } = useSelectableSites();
  const [entryDate, setEntryDate] = useState<string | null>(
    accident?.employee?.entry_date ?? null,
  );

  const [form, setForm] = useState({
    type: (accident?.type ?? "accident") as HseAccidentType,
    site_id: accident?.site_id ?? "",
    occurred_on: accident?.occurred_on?.slice(0, 10) ?? today(),
    occurred_time: accident?.occurred_time?.slice(0, 5) ?? "",
    shift: accident?.shift ? String(accident.shift) : "",
    zone: accident?.zone ?? "",
    employee_id: accident?.employee_id ?? null,
    driver_name: accident?.driver_name ?? "",
    driver_age: accident?.driver_age ? String(accident.driver_age) : "",
    driver_seniority: accident?.driver_seniority ?? "",
    equipment: accident?.equipment ?? "",
    description: accident?.description ?? "",
    causes: accident?.causes ?? "",
    decision: (accident?.decision ?? "") as HseAccidentDecision | "",
    decision_days: accident?.decision_days
      ? String(accident.decision_days)
      : "",
    decision_note: accident?.decision_note ?? "",
    notes: accident?.notes ?? "",
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const withDays = form.decision === "map" || form.decision === "repos_maladie";

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        site_id: form.site_id || undefined,
        occurred_time: form.occurred_time || null,
        shift: form.shift ? Number(form.shift) : null,
        driver_age: form.driver_age ? Number(form.driver_age) : null,
        decision: form.decision || null,
        decision_days:
          withDays && form.decision_days ? Number(form.decision_days) : null,
      };
      return accident
        ? api.put(`/hse-accidents/${accident.id}`, payload)
        : api.post("/hse-accidents", payload);
    },
    onSuccess: () => {
      toast.success(accident ? "Événement mis à jour." : "Événement déclaré.");
      queryClient.invalidateQueries({ queryKey: ["hse-accidents"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={
        accident ? "Modifier l'événement" : "Déclarer un accident / incident"
      }
      size="lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Section title="Informations générales">
          <div className="flex gap-2">
            {(["accident", "incident"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set("type", t)}
                className={clsx(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                  form.type === t
                    ? t === "accident"
                      ? "border-red-500 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                      : "border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                    : "border-slate-300 text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800",
                )}
              >
                {t === "accident" ? (
                  <Siren size={16} />
                ) : (
                  <TriangleAlert size={16} />
                )}
                {t === "accident" ? "Accident de travail" : "Incident"}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {needsSiteSelect && (
              <SelectField
                label="Site"
                required
                value={form.site_id}
                onChange={(e) => set("site_id", e.target.value)}
              >
                <option value="">Sélectionner...</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectField>
            )}
            <TextField
              label="Date"
              type="date"
              required
              max={today()}
              value={form.occurred_on}
              onChange={(e) => {
                set("occurred_on", e.target.value);
                if (entryDate && e.target.value)
                  set("driver_seniority", seniority(entryDate, e.target.value));
              }}
            />
            <TextField
              label="Heure"
              type="time"
              value={form.occurred_time}
              onChange={(e) => set("occurred_time", e.target.value)}
            />
            <SelectField
              label="Shift"
              value={form.shift}
              onChange={(e) => set("shift", e.target.value)}
            >
              <option value="">—</option>
              <option value="1">1er shift</option>
              <option value="2">2ème shift</option>
              <option value="3">3ème shift</option>
            </SelectField>
            <div
              className={needsSiteSelect ? "sm:col-span-2" : "sm:col-span-3"}
            >
              <TextField
                label="Zone"
                placeholder="Ex. P2T60, Box Cut Nord, stock phosphate…"
                value={form.zone}
                onChange={(e) => set("zone", e.target.value)}
              />
            </div>
          </div>
        </Section>

        <Section title="Profil du chauffeur">
          <EmployeeSelect
            label="Fiche employé (facultatif)"
            value={form.employee_id}
            onChange={(emp) => {
              setEntryDate(emp?.entry_date ?? null);
              setForm((f) => ({
                ...f,
                employee_id: emp?.id ?? null,
                driver_name: emp ? emp.full_name : f.driver_name,
                driver_seniority:
                  emp?.entry_date && f.occurred_on
                    ? seniority(emp.entry_date, f.occurred_on)
                    : f.driver_seniority,
              }));
            }}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <TextField
                label="Nom du chauffeur"
                required
                value={form.driver_name}
                onChange={(e) => set("driver_name", e.target.value)}
              />
            </div>
            <TextField
              label="Âge"
              type="number"
              min={14}
              max={99}
              value={form.driver_age}
              onChange={(e) => set("driver_age", e.target.value)}
            />
            <TextField
              label="Ancienneté"
              placeholder="Ex. 1 an et 7 mois"
              value={form.driver_seniority}
              onChange={(e) => set("driver_seniority", e.target.value)}
            />
          </div>
        </Section>

        <Section title="Matériel impliqué et événement">
          <TextField
            label="N° camion ou autre matériel"
            placeholder="Ex. D203"
            value={form.equipment}
            onChange={(e) => set("equipment", e.target.value)}
          />
          <TextAreaField
            label="Détails de l'événement"
            required
            placeholder="Ex. Renversement du camion lors d'une opération de déchargement"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
          <TextAreaField
            label="Causes"
            rows={2}
            placeholder="Ex. Manque de vigilance, décharge non aménagée…"
            value={form.causes}
            onChange={(e) => set("causes", e.target.value)}
          />
        </Section>

        <Section title="Décision prise à l'encontre du chauffeur">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Décision"
              value={form.decision}
              onChange={(e) =>
                set("decision", e.target.value as HseAccidentDecision | "")
              }
            >
              <option value="">À décider</option>
              {DECISIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </SelectField>
            {withDays && (
              <TextField
                label="Nombre de jours"
                type="number"
                min={1}
                required
                value={form.decision_days}
                onChange={(e) => set("decision_days", e.target.value)}
              />
            )}
            {form.decision === "autre" && (
              <TextField
                label="Précisez"
                required
                value={form.decision_note}
                onChange={(e) => set("decision_note", e.target.value)}
              />
            )}
          </div>
          <TextAreaField
            label="Observations"
            rows={2}
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Section>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
