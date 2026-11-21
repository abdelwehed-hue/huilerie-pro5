import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertTriangle, Boxes, CalendarClock, ClipboardList, Factory, RefreshCw, ShoppingBasket, ShoppingCart, Users, Wallet, LogIn, LogOut, type LucideIcon } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";
import { fmtMoney, fmtNum, useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { Button } from "@/components/ui/button";

type Row = Record<string, any>;
type Overview = {
  active_season: string;
  supplier_olive_purchases: Row[];
  commercial_sales_invoices: Row[];
  traditional_invoices: Row[];
  summary: {
    supplier_olive_purchase_total: number | string;
    supplier_olive_paid_total: number | string;
    supplier_olive_outstanding_total: number | string;
    gs_sales_revenue_total: number | string;
    gs_sales_collected_total: number | string;
  };
};
type Stats = {
  today: string;
  season: string;
  loads_today: number;
  pending: number;
  olive_kg_today: number;
  oil_kg_today: number;
  olive_kg_total: number;
  oil_kg_total: number;
  revenue_today?: number;
  revenue_total?: number;
};
type Load = {
  id: string;
  oil_kg?: number | null;
  cancelled?: boolean;
  status?: string;
};
type AttendanceRecord = { worker_id: string; check_in?: string | null; check_out?: string | null };
type AttendanceRow = { id: string; full_name: string; username?: string; status: "absent" | "present" | "completed"; attendance?: AttendanceRecord | null };
type AttendanceResponse = { attendance_date: string; workers: AttendanceRow[] };

function Metric({ label, value, detail, icon: Icon, tone }: {
  label: string; value: string; detail: string; icon: LucideIcon; tone: string;
}) {
  return <section className={`min-w-0 rounded-2xl border p-4 shadow-sm ${tone}`}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm font-semibold opacity-80">{label}</p>
      <Icon className="size-5 shrink-0 opacity-80" />
    </div>
    <p className="mt-3 truncate text-2xl font-bold tabular-nums" dir="ltr">{value}</p>
    <p className="mt-1 text-xs opacity-70">{detail}</p>
  </section>;
}

function SummaryPanel({ title, icon: Icon, total, paid, remaining, labels, tone }: {
  title: string; icon: LucideIcon; total: string; paid: string; remaining: string;
  labels: { total: string; paid: string; remaining: string }; tone: string;
}) {
  return <section className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm ${tone}`}>
    <div className="mb-3 flex items-center gap-2">
      <span className="grid size-9 place-items-center rounded-xl bg-stone-100"><Icon className="size-5" /></span>
      <h2 className="font-bold">{title}</h2>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <div className="min-w-0"><p className="text-xs text-stone-500">{labels.total}</p><p className="mt-1 truncate text-sm font-bold tabular-nums" dir="ltr">{total}</p></div>
      <div className="min-w-0"><p className="text-xs text-stone-500">{labels.paid}</p><p className="mt-1 truncate text-sm font-bold text-emerald-700 tabular-nums" dir="ltr">{paid}</p></div>
      <div className="min-w-0"><p className="text-xs text-stone-500">{labels.remaining}</p><p className="mt-1 truncate text-sm font-bold text-rose-700 tabular-nums" dir="ltr">{remaining}</p></div>
    </div>
  </section>;
}

export default function ManagerDashboard() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const me = useMe();
  const qc = useQueryClient();
  const isAdmin = me.data?.role === "admin";
  const stats = useQuery({ queryKey: ["manager-dashboard", "stats"], queryFn: () => apiGet<Stats>("/stats"), refetchInterval: 15_000 });
  const loads = useQuery({ queryKey: ["manager-dashboard", "loads"], queryFn: () => apiGet<Load[]>("/loads"), refetchInterval: 15_000 });
  const users = useQuery({ queryKey: ["manager-dashboard", "users"], queryFn: () => apiGet<User[]>("/users"), enabled: !!isAdmin, refetchInterval: 30_000 });
  const accounting = useQuery({ queryKey: ["manager-dashboard", "accounting"], queryFn: () => apiGet<Overview>("/accounting/overview"), enabled: !!isAdmin, refetchInterval: 30_000, retry: false });
  const attendance = useQuery({ queryKey: ["manager-dashboard", "attendance"], queryFn: () => apiGet<AttendanceResponse>("/attendance/today"), enabled: !!isAdmin, refetchInterval: 15_000 });
  const attendanceAction = useMutation({ mutationFn: ({ workerId, action }: { workerId: string; action: "check-in" | "check-out" }) => apiPost<AttendanceRecord>(`/attendance/${encodeURIComponent(workerId)}/${action}`), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["manager-dashboard", "attendance"] }); } });

  if (me.isPending) return <div className="p-6 text-stone-500">{ar ? "جارٍ التحقق من الصلاحيات…" : "Vérification des autorisations…"}</div>;
  if (!isAdmin) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">{ar ? "هذه اللوحة متاحة للمدير فقط." : "Ce tableau de bord est réservé à l’administrateur."}</div>;

  const s = stats.data;
  const summary = accounting.data?.summary;
  const purchaseTotal = Number(summary?.supplier_olive_purchase_total ?? 0);
  const purchasePaid = Number(summary?.supplier_olive_paid_total ?? 0);
  const purchaseRemaining = Number(summary?.supplier_olive_outstanding_total ?? Math.max(0, purchaseTotal - purchasePaid));
  const salesTotal = Number(summary?.gs_sales_revenue_total ?? 0);
  const salesPaid = Number(summary?.gs_sales_collected_total ?? 0);
  const salesRemaining = Math.max(0, salesTotal - salesPaid);
  const activeWorkers = (users.data ?? []).filter((u) => u.role === "worker" && u.active).length;
  const currentLoads = (loads.data ?? []).filter((load) => !load.cancelled);
  const pendingLoads = currentLoads.filter((load) => load.oil_kg == null).length;
  const completedLoads = currentLoads.filter((load) => load.oil_kg != null).length;
  const loading = stats.isPending || loads.isPending || accounting.isPending || attendance.isPending;
  const failed = stats.isError || loads.isError || accounting.isError || attendance.isError;
  const money = (v: unknown) => fmtMoney(Number(v ?? 0));
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["manager-dashboard"] }); };

  return <div className="mx-auto max-w-[1600px] space-y-4 pb-6" data-testid="manager-dashboard">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-[#101C2B] px-5 py-4 text-white shadow-lg">
      <div>
        <div className="flex items-center gap-2"><Activity className="size-5 text-teal-300" /><h1 className="text-xl font-bold">{ar ? "لوحة المدير" : "Tableau de bord du directeur"}</h1></div>
        <p className="mt-1 text-sm text-slate-300">{ar ? "مراقبة المعصرة والعمليات التجارية في شاشة واحدة" : "Vue consolidée de l’huilerie et des opérations commerciales"}</p>
        <p className="mt-1 text-xs text-slate-400">{ar ? "الموسم الحالي" : "Saison active"}: {accounting.data?.active_season ?? s?.season ?? "—"}</p>
      </div>
      <Button variant="outline" size="sm" onClick={refresh} className="border-slate-600 bg-slate-800 text-white hover:bg-slate-700"><RefreshCw className="me-2 size-4" />{ar ? "تحديث" : "Actualiser"}</Button>
    </header>

    {failed && <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="size-4 shrink-0" />{ar ? "تعذر تحميل بعض المؤشرات. الأرقام غير المتاحة لا تُعرض كأنها صفر." : "Certaines données n’ont pas pu être chargées. Les valeurs indisponibles ne sont pas présentées comme zéro."}</div>}

    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <Metric label={ar ? "حمولات اليوم" : "Réceptions aujourd’hui"} value={s ? fmtNum(s.loads_today) : "—"} detail={ar ? "عدد الحمولات المسجلة اليوم" : "Nombre de réceptions du jour"} icon={Boxes} tone="border-sky-200 bg-sky-50 text-sky-950" />
      <Metric label={ar ? "الزيتون المعالج اليوم" : "Olives traitées aujourd’hui"} value={s ? `${fmtNum(s.olive_kg_today)} kg` : "—"} detail={ar ? "حسب سجل الحمولات" : "D’après les chargements"} icon={Factory} tone="border-lime-200 bg-lime-50 text-lime-950" />
      <Metric label={ar ? "الزيت المستخرج اليوم" : "Huile extraite aujourd’hui"} value={s ? `${fmtNum(s.oil_kg_today)} kg` : "—"} detail={ar ? "حسب وحدة سجل الإنتاج" : "Selon l’unité du registre de production"} icon={Activity} tone="border-amber-200 bg-amber-50 text-amber-950" />
      <Metric label={ar ? "مداخيل العصر اليوم" : "Recettes de pressage aujourd’hui"} value={s ? money(s.revenue_today) : "—"} detail="TND" icon={Wallet} tone="border-violet-200 bg-violet-50 text-violet-950" />
    </div>

    <div className="grid gap-3 lg:grid-cols-2">
      <SummaryPanel title={ar ? "شراء الزيتون من المزودين" : "Achats d’olives auprès des fournisseurs"} icon={ShoppingBasket}
        total={accounting.data ? money(purchaseTotal) : "—"} paid={accounting.data ? money(purchasePaid) : "—"} remaining={accounting.data ? money(purchaseRemaining) : "—"}
        labels={{ total: ar ? "قيمة المشتريات" : "Achats approuvés", paid: ar ? "المدفوع" : "Payé", remaining: ar ? "المتبقي" : "À payer" }} tone="border-emerald-200" />
      <SummaryPanel title={ar ? "بيع الزيت للحرفاء" : "Ventes d’huile aux clients"} icon={ShoppingCart}
        total={accounting.data ? money(salesTotal) : "—"} paid={accounting.data ? money(salesPaid) : "—"} remaining={accounting.data ? money(salesRemaining) : "—"}
        labels={{ total: ar ? "صافي المبيعات" : "Ventes nettes", paid: ar ? "المقبوض" : "Encaissé", remaining: ar ? "المتبقي" : "À encaisser" }} tone="border-blue-200" />
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-stone-700"><Users className="size-5 text-sky-700" /><h2 className="font-bold">{ar ? "جدول العمال والحضور والانصراف" : "Employés — présences et sorties"}</h2></div>
          <span className="text-xs text-stone-500">{attendance.data?.attendance_date ?? "—"} · {ar ? "توقيت تونس" : "Heure de Tunis"}</span>
        </div>
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-800">{ar ? "حاضرون" : "Présents"}: {attendance.data?.workers.filter((w) => w.status === "present").length ?? "—"}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">{ar ? "انصرفوا" : "Sortis"}: {attendance.data?.workers.filter((w) => w.status === "completed").length ?? "—"}</span>
          <span className="rounded-full bg-rose-50 px-3 py-1 text-rose-800">{ar ? "لم يسجل حضورهم" : "Non pointés"}: {attendance.data?.workers.filter((w) => w.status === "absent").length ?? "—"}</span>
        </div>
        {attendance.isError && <p className="mb-2 text-sm text-rose-700">{ar ? "تعذر تحميل سجل الحضور." : "Impossible de charger le registre de présence."}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead><tr className="border-b text-start text-xs text-stone-500"><th className="p-2 text-start">{ar ? "العامل" : "Employé"}</th><th className="p-2 text-start">{ar ? "الحضور" : "Arrivée"}</th><th className="p-2 text-start">{ar ? "الانصراف" : "Départ"}</th><th className="p-2 text-start">{ar ? "الحالة" : "Statut"}</th><th className="p-2 text-end">{ar ? "الإجراء" : "Action"}</th></tr></thead>
            <tbody>
              {(attendance.data?.workers ?? []).map((worker) => <tr key={worker.id} className="border-b last:border-0">
                <td className="p-2 font-medium">{worker.full_name}</td>
                <td className="p-2 tabular-nums" dir="ltr">{worker.attendance?.check_in ?? "—"}</td>
                <td className="p-2 tabular-nums" dir="ltr">{worker.attendance?.check_out ?? "—"}</td>
                <td className="p-2">{worker.status === "absent" ? (ar ? "لم يسجل" : "Non pointé") : worker.status === "present" ? (ar ? "حاضر" : "Présent") : (ar ? "انصرف" : "Sorti")}</td>
                <td className="p-2 text-end">
                  {worker.status === "absent" ? <Button size="sm" disabled={attendanceAction.isPending} onClick={() => attendanceAction.mutate({ workerId: worker.id, action: "check-in" })}><LogIn className="me-1 size-3.5"/>{ar ? "تسجيل الحضور" : "Pointer"}</Button> : worker.status === "present" ? <Button size="sm" variant="outline" disabled={attendanceAction.isPending} onClick={() => attendanceAction.mutate({ workerId: worker.id, action: "check-out" })}><LogOut className="me-1 size-3.5"/>{ar ? "تسجيل الانصراف" : "Sortie"}</Button> : <span className="text-xs text-emerald-700">{ar ? "مكتمل" : "Terminé"}</span>}
                </td>
              </tr>)}
              {attendance.data?.workers.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-sm text-stone-500">{ar ? "لا توجد حسابات عمال نشطة." : "Aucun employé actif."}</td></tr>}
            </tbody>
          </table>
        </div>
        {attendanceAction.isError && <p className="mt-2 text-sm text-rose-700">{ar ? "تعذر تسجيل العملية. حدّث الصفحة وتحقق من السجل." : "Action impossible. Actualisez et vérifiez le registre."}</p>}
      </section>
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-stone-700"><CalendarClock className="size-5 text-orange-700" /><h2 className="font-bold">{ar ? "حالة الحمولات" : "État des chargements"}</h2></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-2xl font-bold">{loads.data ? pendingLoads : "—"}</p><p className="text-xs text-stone-500">{ar ? "قيد المعالجة" : "En attente"}</p></div><div><p className="text-2xl font-bold">{loads.data ? completedLoads : "—"}</p><p className="text-xs text-stone-500">{ar ? "اكتملت" : "Terminés"}</p></div></div>
      </section>
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-stone-700"><ClipboardList className="size-5 text-indigo-700" /><h2 className="font-bold">{ar ? "الفواتير" : "Factures"}</h2></div>
        <p className="mt-3 text-3xl font-bold">{accounting.data ? accounting.data.traditional_invoices.length : "—"}</p>
        <p className="text-xs text-stone-500">{ar ? "فواتير العصر في السجل المعروض" : "Factures de pressage dans la liste chargée"}</p>
        <p className="mt-2 text-xs text-stone-400">{ar ? "قائمة المحاسبة تعرض أحدث السجلات فقط." : "La comptabilité charge une liste récente plafonnée."}</p>
      </section>
    </div>

    {loading && <p className="text-xs text-stone-500">{ar ? "جارٍ تحميل البيانات…" : "Chargement des données…"}</p>}
  </div>;
}
