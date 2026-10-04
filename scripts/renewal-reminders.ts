// El recordatorio de renovación. Lo corre openlen-renewal-reminders.timer una
// vez al día: pregunta a Polar por cada suscripción de pago y avisa por correo
// cuando faltan 6 días hábiles o menos (lib/billing/renewal-reminder.ts).
// Corta: conecta → avisa → sale.
//
// Sale con 1 si alguna suscripción falló, para que systemd lo marque y se vea
// en `journalctl -u openlen-renewal-reminders`.

import { getSubscription } from "@/lib/billing/polar";
import { listPaidUsers, markReminderSent } from "@/lib/billing/renewal-reminder-db";
import { runRenewalReminders } from "@/lib/billing/renewal-reminder";
import { sendRenewalReminderEmail } from "@/lib/email";
import { publicOrigin } from "@/lib/integrations/oauth";

async function main() {
  if (!process.env.POLAR_ACCESS_TOKEN?.trim()) {
    console.log("[renewal-reminders] sin POLAR_ACCESS_TOKEN: no hay cobro, nada que avisar");
    process.exit(0);
  }
  const r = await runRenewalReminders({
    now: new Date(),
    // Pide sesión y lleva al portal de Polar, donde se cancela o se cambia de plan.
    manageUrl: `${publicOrigin()}/api/billing/portal`,
    listPaidUsers,
    fetchSubscription: getSubscription,
    send: sendRenewalReminderEmail,
    markSent: markReminderSent,
  });
  console.log(`[renewal-reminders] ${r.checked} suscripciones, ${r.sent} avisos, ${r.failed} fallos`);
  process.exit(r.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[renewal-reminders] falló", e);
  process.exit(1);
});
