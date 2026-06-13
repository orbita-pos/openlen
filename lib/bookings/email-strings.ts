// Transactional copy for booking emails. en + es are the shipped languages
// (the product is bilingual; the site's publish locale picks one). Other
// locales fall back to en — full 10-locale email copy is later polish; the
// visitor-facing WIDGET (R6) carries all 10.

export interface BookingEmailStrings {
  confirmedSubject: string; // "{service} — confirmed"
  confirmedHeading: string;
  pendingSubject: string;
  pendingHeading: string;
  pendingNote: string;
  reminderSubject: string;
  reminderHeading: string;
  cancelledSubject: string;
  cancelledHeading: string;
  rescheduledSubject: string;
  rescheduledHeading: string;
  creatorNewSubject: string; // "{service} — new booking"
  creatorNewHeading: string;
  whenLabel: string;
  whoLabel: string;
  whereLabel: string;
  manageCta: string;
  manageHint: string;
  icsNote: string;
  ignore: string;
}

const en: BookingEmailStrings = {
  confirmedSubject: "{service} — booking confirmed",
  confirmedHeading: "Your booking is confirmed",
  pendingSubject: "{service} — booking received",
  pendingHeading: "We received your booking",
  pendingNote: "It's awaiting confirmation. You'll get another email once it's approved.",
  reminderSubject: "Reminder: {service}",
  reminderHeading: "Your booking is coming up",
  cancelledSubject: "{service} — booking cancelled",
  cancelledHeading: "Your booking was cancelled",
  rescheduledSubject: "{service} — booking updated",
  rescheduledHeading: "Your booking was moved",
  creatorNewSubject: "{service} — new booking",
  creatorNewHeading: "You have a new booking",
  whenLabel: "When",
  whoLabel: "Booked by",
  whereLabel: "Where",
  manageCta: "Manage booking",
  manageHint: "Need to change or cancel? Use the link above.",
  icsNote: "A calendar invite is attached.",
  ignore: "If you didn't make this booking, you can ignore this email.",
};

const es: BookingEmailStrings = {
  confirmedSubject: "{service} — reserva confirmada",
  confirmedHeading: "Tu reserva está confirmada",
  pendingSubject: "{service} — reserva recibida",
  pendingHeading: "Recibimos tu reserva",
  pendingNote: "Está pendiente de confirmación. Te avisaremos por correo cuando se apruebe.",
  reminderSubject: "Recordatorio: {service}",
  reminderHeading: "Tu reserva es pronto",
  cancelledSubject: "{service} — reserva cancelada",
  cancelledHeading: "Tu reserva fue cancelada",
  rescheduledSubject: "{service} — reserva actualizada",
  rescheduledHeading: "Tu reserva se cambió",
  creatorNewSubject: "{service} — nueva reserva",
  creatorNewHeading: "Tienes una nueva reserva",
  whenLabel: "Cuándo",
  whoLabel: "Reservado por",
  whereLabel: "Dónde",
  manageCta: "Gestionar reserva",
  manageHint: "¿Necesitas cambiar o cancelar? Usa el enlace de arriba.",
  icsNote: "Se adjunta una invitación de calendario.",
  ignore: "Si no hiciste esta reserva, puedes ignorar este correo.",
};

export function bookingEmailStringsFor(locale?: string | null): BookingEmailStrings {
  const l = (locale ?? "en").slice(0, 2).toLowerCase();
  return l === "es" ? es : en;
}
