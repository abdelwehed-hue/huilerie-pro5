import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Boxes, CalendarClock, ClipboardList, Factory, RefreshCw, ShoppingBasket, ShoppingCart, Wallet, type LucideIcon } from "lucide-react";
import { apiGet } from "@/lib/api";
import { fmtMoney, fmtNum, useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

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
  loads_total: number;
  pending: number;
  olive_kg_today: number;
  oil_kg_today: number;
  olive_kg_total: number;
  oil_kg_total: number;
  revenue_today?: number;
  revenue_total?: number;
};

function Metric({ label, value, detail, icon: Icon, tone, to }: {
  label: string; value: string; detail: string; icon: LucideIcon; tone: string; to: string;
}) {
  return <Link to={to} className="block rounded-2xl outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-500">
    <section className={`min-w-0 rounded-2xl border p-4 shadow-sm ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold opacity-80">{label}</p>
        <Icon className="size-5 shrink-0 opacity-80" />
      </div>
      <p className="mt-3 truncate text-2xl font-bold tabular-nums" dir="ltr">{value}</p>
      <p className="mt-1 text-xs opacity-70">{detail}</p>
    </section>
  </Link>;
}

function SummaryPanel({ title, icon: Icon, total, paid, remaining, labels, tone, to }: {
  title: string; icon: LucideIcon; total: string; paid: string; remaining: string;
  labels: { total: string; paid: string; remaining: string }; tone: string; to: string;
}) {
  return <Link to={to} className="block rounded-2xl outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-500">
    <section className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm ${tone}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-9 place-items-center rounded-xl bg-stone-100"><Icon className="size-5" /></span>
        <h2 className="font-bold">{title}</h2>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="min-w-0"><p className="text-xs text-stone-500">{labels.total}</p><p className="mt-1 truncate text-sm font-bold tabular-nums" dir="ltr">{total}</p></div>
        <div className="min-w-0"><p className="text-xs text-stone-500">{labels.paid}</p><p className="mt-1 truncate text-sm font-bold text-emerald-700 tabular-nums" dir="ltr">{paid}</p></div>
        <div className="min-w-0"><p className="text-xs text-stone-500">{labels.remaining}</p><p className="mt-1 truncate text-sm font-bold text-rose-700 tabular-nums" dir="ltr">{remaining}</p></div>
      </div>
    </section>
  </Link>;
}

export default function ManagerDashboard() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const me = useMe();
  const isAdmin = me.data?.role === "admin";
  const stats = useQuery({ queryKey: ["manager-dashboard", "stats"], queryFn: () => apiGet<Stats>("/stats"), enabled: !!isAdmin, refetchInterval: 15_000 });
  const accounting = useQuery({ queryKey: ["manager-dashboard", "accounting"], queryFn: () => apiGet<Overview>("/accounting/overview"), enabled: !!isAdmin, refetchInterval: 30_000, retry: false });
  const workers = useQuery({ queryKey: ["manager-dashboard", "workers"], queryFn: () => apiGet<Row[]>("/users"), enabled: !!isAdmin, refetchInterval: 30_000 });

  if (me.isPending) return <div className="p-6 text-stone-500">{ar ? "جارٍ التحقق من الصلاحيات…" : "Vérification des autorisations…"}</div>;
  if (!isAdmin) return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">{ar ? "هذه اللوحة متاحة للمدير فقط." : "Ce tableau de bord est réservé à l’administrateur."}</div>;

  const s = stats.data;
  const summary = accounting.data?.summary;
  const purchaseTotal = summary?.supplier_olive_purchase_total;
  const purchasePaid = summary?.supplier_olive_paid_total;
  const purchaseRemaining = summary?.supplier_olive_outstanding_total
    ?? (purchaseTotal != null && purchasePaid != null ? Number(purchaseTotal) - Number(purchasePaid) : null);
  const salesTotal = summary?.gs_sales_revenue_total;
  const salesPaid = summary?.gs_sales_collected_total;
  const salesRemaining = salesTotal != null && salesPaid != null
    ? Number(salesTotal) - Number(salesPaid)
    : null;
  const loading = stats.isPending || accounting.isPending;
  const failed = stats.isError || accounting.isError;
  const money = (v: unknown) => fmtMoney(Number(v ?? 0));
  const moneyOrDash = (v: unknown) => v == null ? "—" : money(v);
  const refresh = () => { void Promise.all([stats.refetch(), accounting.refetch()]); };

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
      <Metric label={ar ? "حمولات اليوم" : "Réceptions aujourd’hui"} value={s ? fmtNum(s.loads_today) : "—"} detail={ar ? "عدد الحمولات المسجلة اليوم" : "Nombre de réceptions du jour"} icon={Boxes} tone="border-sky-200 bg-sky-50 text-sky-950" to="/loads" />
      <Metric label={ar ? "الزيتون المعالج اليوم" : "Olives traitées aujourd’hui"} value={s ? `${fmtNum(s.olive_kg_today)} kg` : "—"} detail={ar ? "حسب سجل الحمولات" : "D’après les chargements"} icon={Factory} tone="border-lime-200 bg-lime-50 text-lime-950" to="/loads" />
      <Metric label={ar ? "الزيت المستخرج اليوم" : "Huile extraite aujourd’hui"} value={s ? `${fmtNum(s.oil_kg_today)} kg` : "—"} detail={ar ? "حسب وحدة سجل الإنتاج" : "Selon l’unité du registre de production"} icon={Activity} tone="border-amber-200 bg-amber-50 text-amber-950" to="/loads" />
      <Metric label={ar ? "مداخيل العصر اليوم" : "Recettes de pressage aujourd’hui"} value={s ? money(s.revenue_today) : "—"} detail="TND" icon={Wallet} tone="border-violet-200 bg-violet-50 text-violet-950" to="/comptabilite" />
    </div>

    <div className="grid gap-3 lg:grid-cols-2">
      <SummaryPanel title={ar ? "شراء الزيتون من المزودين" : "Achats d’olives auprès des fournisseurs"} icon={ShoppingBasket}
        total={moneyOrDash(purchaseTotal)} paid={moneyOrDash(purchasePaid)} remaining={moneyOrDash(purchaseRemaining)}
        labels={{ total: ar ? "قيمة المشتريات" : "Achats approuvés", paid: ar ? "المدفوع" : "Payé", remaining: ar ? "المتبقي" : "À payer" }} tone="border-emerald-200" to="/commercial?tab=purchases" />
      <SummaryPanel title={ar ? "بيع الزيت للحرفاء" : "Ventes d’huile aux clients"} icon={ShoppingCart}
        total={moneyOrDash(salesTotal)} paid={moneyOrDash(salesPaid)} remaining={moneyOrDash(salesRemaining)}
        labels={{ total: ar ? "صافي المبيعات" : "Ventes nettes", paid: ar ? "المقبوض" : "Encaissé", remaining: ar ? "المتبقي" : "À encaisser" }} tone="border-blue-200" to="/commercial?tab=sales" />
    </div>

    <div className="grid gap-3 md:grid-cols-3">
      <section className="rounded-2xl border bg-white p-4 shadow-sm md:col-span-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-bold">{ar ? "العمال النشطون" : "Employés actifs"}</h2>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">{workers.data ? workers.data.filter((worker) => worker.role === "worker" && worker.active).length : "—"}</span>
        </div>
        {workers.isError ? <p className="text-sm text-amber-700">{ar ? "تعذر تحميل قائمة العمال." : "Impossible de charger la liste des employés."}</p> :
          workers.isPending ? <p className="text-sm text-stone-500">{ar ? "جارٍ تحميل العمال…" : "Chargement des employés…"}</p> :
          workers.data.filter((worker) => worker.role === "worker" && worker.active).length === 0
            ? <p className="text-sm text-stone-500">{ar ? "لا يوجد عمال نشطون." : "Aucun employé actif."}</p>
            : <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {workers.data.filter((worker) => worker.role === "worker" && worker.active).map((worker) => (
                  <div key={String(worker.id ?? worker._id ?? worker.username)} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-3">
                    <span className="min-w-0 truncate font-medium text-stone-800">{worker.full_name || worker.username || "—"}</span>
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">{ar ? "الحساب نشط" : "Compte actif"}</span>
                  </div>
                ))}
              </div>}
        <p className="mt-3 text-xs text-stone-500">{ar ? "هذه حالة الحساب فقط؛ لا يعرض التطبيق حالياً سجلاً يومياً موثوقاً للحضور والانصراف." : "Il s’agit uniquement de l’état du compte ; l’application ne fournit pas actuellement de registre journalier fiable des présences."}</p>
      </section>
      <Link to="/loads" className="block rounded-2xl outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-500"><section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-stone-700"><CalendarClock className="size-5 text-orange-700" /><h2 className="font-bold">{ar ? "حالة الحمولات" : "État des chargements"}</h2></div>
        <div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-2xl font-bold">{s ? fmtNum(s.pending) : "—"}</p><p className="text-xs text-stone-500">{ar ? "قيد المعالجة" : "En attente"}</p></div><div><p className="text-2xl font-bold">{s ? fmtNum(s.loads_total - s.pending) : "—"}</p><p className="text-xs text-stone-500">{ar ? "اكتملت" : "Terminés"}</p></div></div>
      </section></Link>
      <Link to="/factures" className="block rounded-2xl outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-500"><section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 text-stone-700"><ClipboardList className="size-5 text-indigo-700" /><h2 className="font-bold">{ar ? "الفواتير" : "Factures"}</h2></div>
        <p className="mt-3 text-3xl font-bold">{accounting.data ? accounting.data.traditional_invoices.length : "—"}</p>
        <p className="text-xs text-stone-500">{ar ? "فواتير العصر في السجل المعروض" : "Factures de pressage dans la liste chargée"}</p>
        <p className="mt-2 text-xs text-stone-400">{ar ? "قائمة المحاسبة تعرض أحدث السجلات فقط." : "La comptabilité charge une liste récente plafonnée."}</p>
      </section></Link>
    </div>

    {loading && <p className="text-xs text-stone-500">{ar ? "جارٍ تحميل البيانات…" : "Chargement des données…"}</p>}
  </div>;
}
