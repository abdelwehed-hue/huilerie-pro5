import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Clock3, LogIn, LogOut, UserRoundCheck } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

type Worker = { id: string; full_name: string; active: boolean };
type AttendanceRecord = {
  id: string;
  worker_id: string;
  worker_name: string;
  day: string;
  status: "present" | "absent";
  check_in: string | null;
  check_out: string | null;
  duration_minutes: number | null;
  duration_review_required?: boolean;
};
type AttendanceData = {
  timezone: string;
  today: string;
  start_date: string;
  end_date: string;
  workers: Worker[];
  records: AttendanceRecord[];
};

function addDays(day: string, amount: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function mondayOf(day: string) {
  const date = new Date(day + "T00:00:00Z");
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return date.toISOString().slice(0, 10);
}
function durationLabel(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}س ${String(minutes % 60).padStart(2, "0")}د`;
}
function clockLabel(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Africa/Tunis", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
function sumMinutes(records: AttendanceRecord[]) {
  return records.reduce((total, record) => total + (record.duration_minutes ?? 0), 0);
}

export default function AttendanceRegister() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const queryClient = useQueryClient();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [absenceDate, setAbsenceDate] = useState("");

  const attendance = useQuery({
    queryKey: ["manager-attendance", startDate, endDate],
    queryFn: () => apiGet<AttendanceData>(
      startDate && endDate
        ? `/attendance?start_date=${startDate}&end_date=${endDate}`
        : "/attendance",
    ),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (attendance.data && !startDate && !endDate) {
      setStartDate(attendance.data.start_date);
      setEndDate(attendance.data.end_date);
      setAbsenceDate(attendance.data.today);
    }
  }, [attendance.data, startDate, endDate]);

  const mutation = useMutation({
    mutationFn: async (input: { workerId: string; action: "check-in" | "check-out" | "absence"; day?: string }) => {
      if (input.action === "absence") {
        return apiPost(`/attendance/${encodeURIComponent(input.workerId)}/absence`, { day: input.day });
      }
      return apiPost(`/attendance/${encodeURIComponent(input.workerId)}/${input.action}`);
    },
    onSuccess: async () => {
      toast.success(ar ? "تم تحديث سجل الحضور" : "Registre de présence mis à jour");
      await queryClient.invalidateQueries({ queryKey: ["manager-attendance"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : (ar ? "تعذر تحديث الحضور" : "Mise à jour impossible")),
  });

  const data = attendance.data;
  const activeWorkers = useMemo(() => (data?.workers ?? []).filter((worker) => worker.active), [data?.workers]);
  const recordsByWorkerDay = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const record of data?.records ?? []) map.set(`${record.worker_id}|${record.day}`, record);
    return map;
  }, [data?.records]);

  const openShiftByWorker = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    for (const record of data?.records ?? []) {
      if (record.status === "present" && !record.check_out) {
        const previous = map.get(record.worker_id);
        if (!previous || record.day > previous.day) map.set(record.worker_id, record);
      }
    }
    return map;
  }, [data?.records]);

  const weekStarts = useMemo(() => {
    if (!startDate || !endDate) return [];
    const weeks: string[] = [];
    let cursor = mondayOf(startDate);
    const last = mondayOf(endDate);
    while (cursor <= last) {
      weeks.push(cursor);
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }, [startDate, endDate]);

  const weeklyRows = useMemo(() => {
    if (!data) return [];
    return weekStarts.flatMap((weekStart) => {
      const weekEnd = addDays(weekStart, 6);
      return activeWorkers.map((worker) => {
        const rows = data.records.filter((record) =>
          record.worker_id === worker.id && record.day >= (weekStart < startDate ? startDate : weekStart) && record.day <= (weekEnd > endDate ? endDate : weekEnd)
        );
        return {
          key: `${worker.id}|${weekStart}`,
          worker: worker.full_name,
          weekStart,
          weekEnd,
          minutes: sumMinutes(rows),
          complete: rows.filter((record) => record.status === "present" && record.duration_minutes != null).length,
          incomplete: rows.filter((record) => record.status === "present" && record.duration_minutes == null).length,
          absent: rows.filter((record) => record.status === "absent").length,
        };
      });
    });
  }, [data, weekStarts, activeWorkers, startDate, endDate]);

  const selectedRecords = useMemo(() => (data?.records ?? []).filter((record) =>
    record.day >= startDate && record.day <= endDate
  ), [data?.records, startDate, endDate]);

  const todayStatus = (workerId: string) => {
    const record = recordsByWorkerDay.get(`${workerId}|${data?.today}`);
    if (!record) {
      const openShift = openShiftByWorker.get(workerId);
      if (openShift) return ar ? "وردية مفتوحة منذ " + openShift.day : "Service ouvert depuis le " + openShift.day;
      return ar ? "لا يوجد سجل" : "Aucun pointage";
    }
    if (record.status === "absent") return ar ? "غياب مؤكد" : "Absence confirmée";
    if (!record.check_out) return ar ? "حضور دون خروج" : "Présence sans sortie";
    if (record.duration_review_required) return ar ? "مدة تحتاج مراجعة" : "Durée à vérifier";
    return ar ? "حضور مكتمل" : "Présence complète";
  };
  const hoursFor = (workerId: string, predicate: (record: AttendanceRecord) => boolean) =>
    sumMinutes((data?.records ?? []).filter((record) => record.worker_id === workerId && predicate(record)));
  const currentWeekStart = data ? mondayOf(data.today) : "";
  const currentMonth = data?.today.slice(0, 7) ?? "";

  return (
    <section className="rounded-2xl border bg-white p-4 shadow-sm space-y-4" data-testid="attendance-register">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-sky-100 text-sky-800"><UserRoundCheck className="size-5" /></span>
        <div>
          <h2 className="font-bold">{ar ? "سجل حضور العمال وساعات العمل" : "Présence et heures de travail"}</h2>
          <p className="text-xs text-stone-500">{ar ? "التوقيت المعتمد: تونس · دون خصم الاستراحة" : "Heure de Tunisie · aucune pause déduite"}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-stone-600">
          {ar ? "من تاريخ" : "Du"}
          <Input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-stone-600">
          {ar ? "إلى تاريخ" : "Au"}
          <Input type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} />
        </label>
        <label className="grid gap-1 text-xs font-medium text-stone-600">
          {ar ? "تاريخ تسجيل الغياب" : "Date d’absence à confirmer"}
          <Input type="date" value={absenceDate} min={startDate || undefined} max={endDate && data?.today && endDate < data.today ? endDate : data?.today} onChange={(event) => setAbsenceDate(event.target.value)} />
        </label>
      </div>

      {attendance.isError && <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{ar ? "تعذر تحميل سجل الحضور." : "Impossible de charger le registre de présence."}</p>}
      {attendance.isPending && <p className="text-sm text-stone-500">{ar ? "جارٍ تحميل السجل…" : "Chargement du registre…"}</p>}

      {data && <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-stone-500">{ar ? "الأزرار التالية تسجل الوقت الفعلي على الخادم." : "Les actions enregistrent l’heure réelle du serveur."}</p>
          <Button variant="outline" size="sm" onClick={() => { setStartDate(addDays(data.today, -6)); setEndDate(data.today); }}>
            <CalendarDays className="me-2 size-4" />{ar ? "آخر 7 أيام" : "7 derniers jours"}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b bg-stone-50 text-xs text-stone-500">
              <th className="p-2 text-start">{ar ? "العامل" : "Employé"}</th>
              <th className="p-2 text-start">{ar ? "حالة اليوم" : "Statut du jour"}</th>
              <th className="p-2 text-start">{ar ? "اليوم" : "Aujourd’hui"}</th>
              <th className="p-2 text-start">{ar ? "الأسبوع الحالي" : "Cette semaine"}</th>
              <th className="p-2 text-start">{ar ? "الشهر الحالي" : "Ce mois-ci"}</th>
              <th className="p-2 text-start">{ar ? "الفترة المختارة" : "Période choisie"}</th>
              <th className="p-2 text-start">{ar ? "إجراء" : "Action"}</th>
            </tr></thead>
            <tbody>
              {activeWorkers.map((worker) => {
                const todayRecord = recordsByWorkerDay.get(`${worker.id}|${data.today}`);
                const todayMinutes = hoursFor(worker.id, (record) => record.day === data.today);
                const weekMinutes = hoursFor(worker.id, (record) => record.day >= currentWeekStart && record.day <= data.today);
                const monthMinutes = hoursFor(worker.id, (record) => record.day.slice(0, 7) === currentMonth);
                const rangeMinutes = hoursFor(worker.id, (record) => record.day >= startDate && record.day <= endDate);
                return <tr key={worker.id} className="border-b last:border-0">
                  <td className="p-2 font-medium">{worker.full_name}</td>
                  <td className="p-2"><span className={todayRecord?.status === "absent" ? "text-rose-700" : todayRecord?.check_out ? "text-emerald-700" : "text-stone-600"}>{todayStatus(worker.id)}</span></td>
                  <td className="p-2 tabular-nums">{durationLabel(todayMinutes)}</td>
                  <td className="p-2 tabular-nums">{durationLabel(weekMinutes)}</td>
                  <td className="p-2 tabular-nums">{durationLabel(monthMinutes)}</td>
                  <td className="p-2 tabular-nums font-semibold">{durationLabel(rangeMinutes)}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {openShiftByWorker.has(worker.id) && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ workerId: worker.id, action: "check-out" })}><LogOut className="me-1 size-3" />{ar ? "خروج" : "Sortie"}</Button>}
                      {!todayRecord && !openShiftByWorker.has(worker.id) && <Button size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate({ workerId: worker.id, action: "check-in" })}><LogIn className="me-1 size-3" />{ar ? "دخول" : "Entrée"}</Button>}
                      {!recordsByWorkerDay.has(`${worker.id}|${absenceDate}`) && !openShiftByWorker.has(worker.id) && absenceDate && absenceDate >= startDate && absenceDate <= endDate && absenceDate <= data.today && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate({ workerId: worker.id, action: "absence", day: absenceDate })}>{ar ? "غياب" : "Absent"}</Button>}
                    </div>
                  </td>
                </tr>;
              })}
              {activeWorkers.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-stone-500">{ar ? "لا توجد حسابات عمال نشطة." : "Aucun employé actif."}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-semibold"><Clock3 className="size-4" />{ar ? "التفصيل الأسبوعي (الاثنين إلى الأحد)" : "Détail hebdomadaire (lundi à dimanche)"}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b bg-stone-50 text-xs text-stone-500">
                <th className="p-2 text-start">{ar ? "الأسبوع" : "Semaine"}</th>
                <th className="p-2 text-start">{ar ? "العامل" : "Employé"}</th>
                <th className="p-2 text-start">{ar ? "الساعات" : "Heures"}</th>
                <th className="p-2 text-start">{ar ? "حضور مكتمل" : "Présences complètes"}</th>
                <th className="p-2 text-start">{ar ? "دون خروج" : "Sans sortie"}</th>
                <th className="p-2 text-start">{ar ? "غياب مؤكد" : "Absences confirmées"}</th>
              </tr></thead>
              <tbody>
                {weeklyRows.map((row) => <tr key={row.key} className="border-b last:border-0">
                  <td className="p-2 tabular-nums">{row.weekStart} – {row.weekEnd}</td>
                  <td className="p-2">{row.worker}</td>
                  <td className="p-2 font-semibold tabular-nums">{durationLabel(row.minutes)}</td>
                  <td className="p-2">{row.complete}</td>
                  <td className="p-2">{row.incomplete}</td>
                  <td className="p-2">{row.absent}</td>
                </tr>)}
                {weeklyRows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-stone-500">{ar ? "لا توجد سجلات ضمن الفترة." : "Aucun pointage sur cette période."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">{ar ? "التفاصيل اليومية المسجلة" : "Détail quotidien enregistré"}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead><tr className="border-b bg-stone-50 text-xs text-stone-500">
                <th className="p-2 text-start">{ar ? "التاريخ" : "Date"}</th>
                <th className="p-2 text-start">{ar ? "العامل" : "Employé"}</th>
                <th className="p-2 text-start">{ar ? "الدخول" : "Entrée"}</th>
                <th className="p-2 text-start">{ar ? "الخروج" : "Sortie"}</th>
                <th className="p-2 text-start">{ar ? "المدة" : "Durée"}</th>
                <th className="p-2 text-start">{ar ? "الحالة" : "Statut"}</th>
              </tr></thead>
              <tbody>
                {[...selectedRecords].sort((a, b) => b.day.localeCompare(a.day) || a.worker_name.localeCompare(b.worker_name)).map((record) => <tr key={record.id} className="border-b last:border-0">
                  <td className="p-2 tabular-nums">{record.day}</td>
                  <td className="p-2">{record.worker_name}</td>
                  <td className="p-2 tabular-nums">{clockLabel(record.check_in)}</td>
                  <td className="p-2 tabular-nums">{clockLabel(record.check_out)}</td>
                  <td className="p-2 tabular-nums">{durationLabel(record.duration_minutes)}</td>
                  <td className="p-2">{record.status === "absent" ? (ar ? "غياب مؤكد" : "Absence confirmée") : record.duration_review_required ? (ar ? "مدة تحتاج مراجعة" : "Durée à vérifier") : record.check_out ? (ar ? "حضور مكتمل" : "Présence complète") : (ar ? "حضور دون خروج" : "Présence sans sortie")}</td>
                </tr>)}
                {selectedRecords.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-stone-500">{ar ? "لا توجد سجلات في الفترة المختارة. عدم وجود سجل لا يعني غياباً." : "Aucun pointage. L’absence de pointage ne signifie pas une absence confirmée."}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </>}
    </section>
  );
}
