import AttendanceRegister from "@/components/AttendanceRegister";
import { useI18n } from "@/lib/i18n";
import { useMe } from "@/lib/useMe";

export default function WorkersAttendance() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const me = useMe();

  if (me.isPending) {
    return <div className="p-6 text-stone-500">{ar ? "جارٍ التحقق من الصلاحيات…" : "Vérification des autorisations…"}</div>;
  }
  if (me.data?.role !== "admin") {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">{ar ? "سجل العمال متاح للمدير فقط." : "Le registre des employés est réservé à l’administrateur."}</div>;
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 pb-6" data-testid="workers-attendance-page">
      <header className="rounded-2xl border bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold text-stone-900">{ar ? "جدول العمال والحضور والانصراف" : "Employés, présences et départs"}</h1>
        <p className="mt-1 text-sm text-stone-500">{ar ? "تسجيل حضور العمال ومتابعة ساعات العمل اليومية والأسبوعية والشهرية." : "Enregistrer les présences et suivre les heures quotidiennes, hebdomadaires et mensuelles."}</p>
      </header>
      <AttendanceRegister />
    </div>
  );
}
