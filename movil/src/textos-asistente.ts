// The phone's own texts for the person's own assistant (spec local 2026-11-06-asistente-propio, §4.6.3, phase 5), in
// the 10 languages (namespace `movil.asistente`). What her place on the web already says — Hablar, Conversaciones,
// Pedidos, a request card — the phone reads from the web's own messages (`own`, the web's `ownAssistant`, see
// textos.tsx), so both say the same thing; only what exists on the phone alone is here. No gender for her: her name.
import type { Idioma } from "./config";

const es = {
  hablarCon: "Hablar con {name}",
  cerrar: "Cerrar",
  reintentar: "Reintentar",
  noEsta: "{name} ya no está.",
  // Her app (spec local 2026-11-16-movil-es-tu-asistente, §5.3): Len's work in her sheet, and the sheet's button.
  lenTrabajando: "Len está trabajando",
  pedirCambio: "Pídele un cambio a {name}",
  // Len's card in her chat (spec local 2026-11-16-movil-es-tu-asistente, §5.4).
  lenEnCola: "Len lo tiene en cola",
  lenTrabajandoEn: "Len está trabajando en {project}",
  parar: "Parar",
  lenTermino: "Len terminó",
  antesAhora: "Antes / Ahora",
  publicar: "Publicar",
  lenNoPudo: "Len no pudo hacerlo",
  sinCreditos: "Te quedaste sin créditos",
  lenSePerdio: "Este pedido se perdió. Pídeselo otra vez a {name}.",
  verLoQueHizo: "Ver lo que hizo Len",
  // What Len did, to read (spec local 2026-11-16-movil-es-tu-asistente, §5.4.9).
  loQueHizoLen: "Lo que hizo Len",
  turnoNoEsta: "Este trabajo de Len ya no está",
  deElla: "De {name}",
  cargandoTurno: "Cargando…",
  // A project she doesn't serve (spec local 2026-11-16-movil-es-tu-asistente, §5.6).
  queLoAtienda: "Que {name} lo atienda",
  loAtiende: "Lo atiende {name}",
  cambiarA: "Cambiar a {name}",
  soloParaVer: "Sólo para ver",
  noSePudo: "No se pudo. Inténtalo de nuevo.",
};
type Texts = Record<keyof typeof es, string>;

export const textosAsistente: Record<Idioma, Texts> = {
  es,
  en: { hablarCon: "Talk to {name}", cerrar: "Close", reintentar: "Try again", noEsta: "{name} is no longer here.", lenTrabajando: "Len is working", pedirCambio: "Ask {name} for a change", lenEnCola: "Len has it in line", lenTrabajandoEn: "Len is working on {project}", parar: "Stop", lenTermino: "Len is done", antesAhora: "Before / Now", publicar: "Publish", lenNoPudo: "Len couldn't do it", sinCreditos: "You ran out of credits", lenSePerdio: "This request got lost. Ask {name} again.", verLoQueHizo: "See what Len did", loQueHizoLen: "What Len did", turnoNoEsta: "This work of Len's is no longer here", deElla: "From {name}", cargandoTurno: "Loading…", queLoAtienda: "Let {name} handle it", loAtiende: "{name} handles it", cambiarA: "Switch to {name}", soloParaVer: "View only", noSePudo: "That didn't work. Try again." },
  pt: { hablarCon: "Falar com {name}", cerrar: "Fechar", reintentar: "Tentar de novo", noEsta: "{name} não está mais aqui.", lenTrabajando: "Len está trabalhando", pedirCambio: "Peça uma mudança a {name}", lenEnCola: "O Len já tem isso na fila", lenTrabajandoEn: "Len está trabalhando em {project}", parar: "Parar", lenTermino: "Len terminou", antesAhora: "Antes / Agora", publicar: "Publicar", lenNoPudo: "Len não conseguiu fazer", sinCreditos: "Seus créditos acabaram", lenSePerdio: "Este pedido se perdeu. Peça de novo a {name}.", verLoQueHizo: "Ver o que o Len fez", loQueHizoLen: "O que o Len fez", turnoNoEsta: "Este trabalho do Len não está mais aqui", deElla: "De {name}", cargandoTurno: "Carregando…", queLoAtienda: "Que {name} cuide dele", loAtiende: "{name} cuida dele", cambiarA: "Mudar para {name}", soloParaVer: "Só para ver", noSePudo: "Não deu certo. Tente de novo." },
  fr: { hablarCon: "Parler à {name}", cerrar: "Fermer", reintentar: "Réessayer", noEsta: "{name} n’est plus là.", lenTrabajando: "Len travaille", pedirCambio: "Demander un changement à {name}", lenEnCola: "Len l’a dans sa file", lenTrabajandoEn: "Len travaille sur {project}", parar: "Arrêter", lenTermino: "Len a terminé", antesAhora: "Avant / Maintenant", publicar: "Publier", lenNoPudo: "Len n’a pas pu le faire", sinCreditos: "Vous n’avez plus de crédits", lenSePerdio: "Cette demande s’est perdue. Redemandez-la à {name}.", verLoQueHizo: "Voir ce que Len a fait", loQueHizoLen: "Ce que Len a fait", turnoNoEsta: "Ce travail de Len n’est plus là", deElla: "De {name}", cargandoTurno: "Chargement…", queLoAtienda: "Confier à {name}", loAtiende: "{name} s’en occupe", cambiarA: "Passer à {name}", soloParaVer: "Lecture seule", noSePudo: "Ça n’a pas marché. Réessayez." },
  de: { hablarCon: "Mit {name} sprechen", cerrar: "Schließen", reintentar: "Erneut versuchen", noEsta: "{name} gibt es nicht mehr.", lenTrabajando: "Len arbeitet", pedirCambio: "{name} um eine Änderung bitten", lenEnCola: "Len hat es in der Warteschlange", lenTrabajandoEn: "Len arbeitet an {project}", parar: "Stoppen", lenTermino: "Len ist fertig", antesAhora: "Vorher / Jetzt", publicar: "Veröffentlichen", lenNoPudo: "Len konnte es nicht machen", sinCreditos: "Deine Credits sind aufgebraucht", lenSePerdio: "Diese Anfrage ging verloren. Bitte {name} noch einmal darum.", verLoQueHizo: "Ansehen, was Len gemacht hat", loQueHizoLen: "Was Len gemacht hat", turnoNoEsta: "Diese Arbeit von Len gibt es nicht mehr", deElla: "Von {name}", cargandoTurno: "Wird geladen…", queLoAtienda: "{name} übernehmen lassen", loAtiende: "{name} kümmert sich darum", cambiarA: "Zu {name} wechseln", soloParaVer: "Nur ansehen", noSePudo: "Das hat nicht geklappt. Versuch es noch einmal." },
  it: { hablarCon: "Parla con {name}", cerrar: "Chiudi", reintentar: "Riprova", noEsta: "{name} non c’è più.", lenTrabajando: "Len sta lavorando", pedirCambio: "Chiedi una modifica a {name}", lenEnCola: "Len ce l’ha in coda", lenTrabajandoEn: "Len sta lavorando su {project}", parar: "Ferma", lenTermino: "Len ha finito", antesAhora: "Prima / Ora", publicar: "Pubblica", lenNoPudo: "Len non è riuscito a farlo", sinCreditos: "Hai finito i crediti", lenSePerdio: "Questa richiesta è andata persa. Chiedila di nuovo a {name}.", verLoQueHizo: "Vedi cosa ha fatto Len", loQueHizoLen: "Cosa ha fatto Len", turnoNoEsta: "Questo lavoro di Len non c’è più", deElla: "Da {name}", cargandoTurno: "Caricamento…", queLoAtienda: "Lascia che se ne occupi {name}", loAtiende: "Se ne occupa {name}", cambiarA: "Passa a {name}", soloParaVer: "Solo da vedere", noSePudo: "Non ha funzionato. Riprova." },
  ja: { hablarCon: "{name}と話す", cerrar: "閉じる", reintentar: "もう一度", noEsta: "{name}はもういません。", lenTrabajando: "Lenが作業中", pedirCambio: "{name}に変更を頼む", lenEnCola: "Lenが順番待ちで受け取りました", lenTrabajandoEn: "Lenが{project}で作業中", parar: "止める", lenTermino: "Lenが完了しました", antesAhora: "前 / 今", publicar: "公開する", lenNoPudo: "Lenはできませんでした", sinCreditos: "クレジットがなくなりました", lenSePerdio: "この依頼は失われました。{name}にもう一度頼んでください。", verLoQueHizo: "Lenがしたことを見る", loQueHizoLen: "Lenがしたこと", turnoNoEsta: "このLenの作業はもうありません", deElla: "{name}から", cargandoTurno: "読み込み中…", queLoAtienda: "{name}に任せる", loAtiende: "{name}が担当しています", cambiarA: "{name}に切り替える", soloParaVer: "閲覧のみ", noSePudo: "うまくいきませんでした。もう一度お試しください。" },
  ko: { hablarCon: "{name}에게 말하기", cerrar: "닫기", reintentar: "다시 시도", noEsta: "{name}: 더 이상 없어요.", lenTrabajando: "Len이 작업 중", pedirCambio: "{name}에게 변경 요청하기", lenEnCola: "Len이 대기열에 넣었어요", lenTrabajandoEn: "Len이 {project}에서 작업 중", parar: "멈추기", lenTermino: "Len이 끝냈어요", antesAhora: "전 / 후", publicar: "게시하기", lenNoPudo: "Len이 하지 못했어요", sinCreditos: "크레딧이 다 떨어졌어요", lenSePerdio: "이 요청이 사라졌어요. {name}에게 다시 부탁해 주세요.", verLoQueHizo: "Len이 한 일 보기", loQueHizoLen: "Len이 한 일", turnoNoEsta: "Len의 이 작업은 더 이상 없어요", deElla: "{name}에게서", cargandoTurno: "불러오는 중…", queLoAtienda: "{name}에게 맡기기", loAtiende: "{name}이(가) 맡고 있어요", cambiarA: "{name}(으)로 바꾸기", soloParaVer: "보기 전용", noSePudo: "되지 않았어요. 다시 시도해 주세요." },
  zh: { hablarCon: "和{name}聊聊", cerrar: "关闭", reintentar: "重试", noEsta: "{name}已不在。", lenTrabajando: "Len 正在工作", pedirCambio: "请{name}做个修改", lenEnCola: "Len 已排上队", lenTrabajandoEn: "Len 正在处理 {project}", parar: "停止", lenTermino: "Len 完成了", antesAhora: "之前 / 现在", publicar: "发布", lenNoPudo: "Len 没能完成", sinCreditos: "你的额度用完了", lenSePerdio: "这个请求丢失了。请再跟{name}说一次。", verLoQueHizo: "看看 Len 做了什么", loQueHizoLen: "Len 做了什么", turnoNoEsta: "Len 的这项工作已不在了", deElla: "来自{name}", cargandoTurno: "加载中…", queLoAtienda: "交给{name}", loAtiende: "由{name}负责", cambiarA: "切换到{name}", soloParaVer: "仅可查看", noSePudo: "没成功，请再试一次。" },
  nl: { hablarCon: "Praat met {name}", cerrar: "Sluiten", reintentar: "Opnieuw proberen", noEsta: "{name} is er niet meer.", lenTrabajando: "Len is aan het werk", pedirCambio: "Vraag {name} om een wijziging", lenEnCola: "Len heeft het in de wachtrij", lenTrabajandoEn: "Len werkt aan {project}", parar: "Stoppen", lenTermino: "Len is klaar", antesAhora: "Voor / Nu", publicar: "Publiceren", lenNoPudo: "Len kon het niet doen", sinCreditos: "Je credits zijn op", lenSePerdio: "Dit verzoek is verloren gegaan. Vraag het {name} opnieuw.", verLoQueHizo: "Bekijk wat Len heeft gedaan", loQueHizoLen: "Wat Len heeft gedaan", turnoNoEsta: "Dit werk van Len is er niet meer", deElla: "Van {name}", cargandoTurno: "Laden…", queLoAtienda: "Laat {name} het doen", loAtiende: "{name} doet dit", cambiarA: "Overschakelen naar {name}", soloParaVer: "Alleen bekijken", noSePudo: "Dat lukte niet. Probeer het opnieuw." },
};
