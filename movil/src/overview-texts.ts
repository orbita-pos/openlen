// The phone's texts for «Entregado» and «Tareas» (spec local 2026-10-31-len-movil, §5.3–5.5), in the 10
// languages (namespace `movil.resumen`).
import type { Idioma } from "./config";

const es = {
  entregado: "Entregado", tareas: "Tareas", cerrar: "Cerrar", error: "No se pudo cargar.", reintentar: "Reintentar", cargando: "Cargando…",
  vacioEntregado: "Len todavía no te ha entregado archivos.", vacioTareas: "Nada por aquí todavía. Pídele a Len una tarea programada en el chat de tu proyecto.",
  teNecesita: "Te necesita", trabajando: "Trabajando", programadas: "Programadas", resueltas: "Resueltas", nada: "Nada", lenTrabajando: "Len está trabajando",
  lenWatch: "Len Watch: tu app necesita atención", incidenteResuelto: "Caída resuelta", ultimaBien: "la última salió bien", ultimaMal: "la última no salió",
  enPausa: "En pausa", proxima: "Próxima: {when}", confirmarBorrar: "¿Borrar esta tarea?", borrar: "Borrar", cancelar: "Cancelar", reanudar: "Reanudar",
  pausar: "Pausar", editar: "Editar", nombre: "Nombre", queHacer: "Qué hacer", cuando: "Cuándo", zona: "Zona horaria", guardar: "Guardar",
  frecuencia_once: "Una vez", frecuencia_daily: "Cada día", frecuencia_weekly: "Cada semana", frecuencia_hours: "Cada X horas", frecuencia_cron: "Cron", accionFallo: "No se pudo. Vuelve a intentarlo.",
};
type Texts = Record<keyof typeof es, string>;

export const overviewTexts: Record<Idioma, Texts> = {
  es,
  en: {
    entregado: "Delivered", tareas: "Tasks", cerrar: "Close", error: "Couldn't load.", reintentar: "Try again", cargando: "Loading…",
    vacioEntregado: "Len hasn't delivered any files yet.", vacioTareas: "Nothing here yet. Ask Len for a scheduled task in your project's chat.",
    teNecesita: "Needs you", trabajando: "Working", programadas: "Scheduled", resueltas: "Resolved", nada: "Nothing", lenTrabajando: "Len is working",
    lenWatch: "Len Watch: your app needs attention", incidenteResuelto: "Outage resolved", ultimaBien: "the last run went well", ultimaMal: "the last run didn't go through",
    enPausa: "Paused", proxima: "Next: {when}", confirmarBorrar: "Delete this task?", borrar: "Delete", cancelar: "Cancel", reanudar: "Resume",
    pausar: "Pause", editar: "Edit", nombre: "Name", queHacer: "What to do", cuando: "When", zona: "Time zone", guardar: "Save",
    frecuencia_once: "Once", frecuencia_daily: "Every day", frecuencia_weekly: "Every week", frecuencia_hours: "Every X hours", frecuencia_cron: "Cron", accionFallo: "That didn't work. Try again.",
  },
  pt: {
    entregado: "Entregue", tareas: "Tarefas", cerrar: "Fechar", error: "Não foi possível carregar.", reintentar: "Tentar novamente", cargando: "Carregando…",
    vacioEntregado: "O Len ainda não entregou arquivos.", vacioTareas: "Nada por aqui ainda. Peça ao Len uma tarefa agendada no chat do seu projeto.",
    teNecesita: "Precisa de você", trabajando: "Trabalhando", programadas: "Agendadas", resueltas: "Resolvidas", nada: "Nada", lenTrabajando: "O Len está trabalhando",
    lenWatch: "Len Watch: seu app precisa de atenção", incidenteResuelto: "Queda resolvida", ultimaBien: "a última deu certo", ultimaMal: "a última não deu certo",
    enPausa: "Em pausa", proxima: "Próxima: {when}", confirmarBorrar: "Apagar esta tarefa?", borrar: "Apagar", cancelar: "Cancelar", reanudar: "Retomar",
    pausar: "Pausar", editar: "Editar", nombre: "Nome", queHacer: "O que fazer", cuando: "Quando", zona: "Fuso horário", guardar: "Salvar",
    frecuencia_once: "Uma vez", frecuencia_daily: "Todo dia", frecuencia_weekly: "Toda semana", frecuencia_hours: "A cada X horas", frecuencia_cron: "Cron", accionFallo: "Não deu certo. Tente novamente.",
  },
  fr: {
    entregado: "Livré", tareas: "Tâches", cerrar: "Fermer", error: "Chargement impossible.", reintentar: "Réessayer", cargando: "Chargement…",
    vacioEntregado: "Len ne t’a encore livré aucun fichier.", vacioTareas: "Rien pour l’instant. Demande à Len une tâche programmée dans le chat de ton projet.",
    teNecesita: "T’attend", trabajando: "En cours", programadas: "Programmées", resueltas: "Résolues", nada: "Rien", lenTrabajando: "Len travaille",
    lenWatch: "Len Watch : ton app a besoin d’attention", incidenteResuelto: "Panne résolue", ultimaBien: "la dernière s’est bien passée", ultimaMal: "la dernière n’a pas abouti",
    enPausa: "En pause", proxima: "Prochaine : {when}", confirmarBorrar: "Supprimer cette tâche ?", borrar: "Supprimer", cancelar: "Annuler", reanudar: "Reprendre",
    pausar: "Mettre en pause", editar: "Modifier", nombre: "Nom", queHacer: "Quoi faire", cuando: "Quand", zona: "Fuseau horaire", guardar: "Enregistrer",
    frecuencia_once: "Une fois", frecuencia_daily: "Chaque jour", frecuencia_weekly: "Chaque semaine", frecuencia_hours: "Toutes les X heures", frecuencia_cron: "Cron", accionFallo: "Ça n'a pas marché. Réessayez.",
  },
  de: {
    entregado: "Geliefert", tareas: "Aufgaben", cerrar: "Schließen", error: "Konnte nicht geladen werden.", reintentar: "Erneut versuchen", cargando: "Wird geladen…",
    vacioEntregado: "Len hat dir noch keine Dateien geliefert.", vacioTareas: "Noch nichts hier. Bitte Len im Chat deines Projekts um eine geplante Aufgabe.",
    teNecesita: "Braucht dich", trabajando: "In Arbeit", programadas: "Geplant", resueltas: "Erledigt", nada: "Nichts", lenTrabajando: "Len arbeitet",
    lenWatch: "Len Watch: deine App braucht Aufmerksamkeit", incidenteResuelto: "Ausfall behoben", ultimaBien: "der letzte Lauf hat geklappt", ultimaMal: "der letzte Lauf hat nicht geklappt",
    enPausa: "Pausiert", proxima: "Nächste: {when}", confirmarBorrar: "Diese Aufgabe löschen?", borrar: "Löschen", cancelar: "Abbrechen", reanudar: "Fortsetzen",
    pausar: "Pausieren", editar: "Bearbeiten", nombre: "Name", queHacer: "Was tun", cuando: "Wann", zona: "Zeitzone", guardar: "Speichern",
    frecuencia_once: "Einmal", frecuencia_daily: "Jeden Tag", frecuencia_weekly: "Jede Woche", frecuencia_hours: "Alle X Stunden", frecuencia_cron: "Cron", accionFallo: "Das hat nicht geklappt. Versuche es noch einmal.",
  },
  it: {
    entregado: "Consegnati", tareas: "Attività", cerrar: "Chiudi", error: "Impossibile caricare.", reintentar: "Riprova", cargando: "Caricamento…",
    vacioEntregado: "Len non ti ha ancora consegnato file.", vacioTareas: "Ancora niente qui. Chiedi a Len un’attività programmata nella chat del progetto.",
    teNecesita: "Ha bisogno di te", trabajando: "In corso", programadas: "Programmate", resueltas: "Risolte", nada: "Niente", lenTrabajando: "Len sta lavorando",
    lenWatch: "Len Watch: la tua app ha bisogno di attenzione", incidenteResuelto: "Guasto risolto", ultimaBien: "l’ultima è andata bene", ultimaMal: "l’ultima non è andata a buon fine",
    enPausa: "In pausa", proxima: "Prossima: {when}", confirmarBorrar: "Eliminare questa attività?", borrar: "Elimina", cancelar: "Annulla", reanudar: "Riprendi",
    pausar: "Metti in pausa", editar: "Modifica", nombre: "Nome", queHacer: "Cosa fare", cuando: "Quando", zona: "Fuso orario", guardar: "Salva",
    frecuencia_once: "Una volta", frecuencia_daily: "Ogni giorno", frecuencia_weekly: "Ogni settimana", frecuencia_hours: "Ogni X ore", frecuencia_cron: "Cron", accionFallo: "Non è riuscito. Riprova.",
  },
  ja: {
    entregado: "納品", tareas: "タスク", cerrar: "閉じる", error: "読み込めませんでした。", reintentar: "再試行", cargando: "読み込み中…",
    vacioEntregado: "Lenからのファイルはまだありません。", vacioTareas: "まだ何もありません。プロジェクトのチャットでLenに予定タスクを頼んでください。",
    teNecesita: "あなたの対応が必要", trabajando: "作業中", programadas: "予定", resueltas: "完了", nada: "なし", lenTrabajando: "Lenが作業中です",
    lenWatch: "Len Watch：アプリに対応が必要です", incidenteResuelto: "障害は解決しました", ultimaBien: "前回は成功しました", ultimaMal: "前回は完了しませんでした",
    enPausa: "一時停止中", proxima: "次回：{when}", confirmarBorrar: "このタスクを削除しますか？", borrar: "削除", cancelar: "キャンセル", reanudar: "再開",
    pausar: "一時停止", editar: "編集", nombre: "名前", queHacer: "やること", cuando: "いつ", zona: "タイムゾーン", guardar: "保存",
    frecuencia_once: "1回", frecuencia_daily: "毎日", frecuencia_weekly: "毎週", frecuencia_hours: "X時間ごと", frecuencia_cron: "Cron", accionFallo: "うまくいきませんでした。もう一度お試しください。",
  },
  ko: {
    entregado: "전달됨", tareas: "작업", cerrar: "닫기", error: "불러오지 못했어요.", reintentar: "다시 시도", cargando: "불러오는 중…",
    vacioEntregado: "Len이 아직 전달한 파일이 없어요.", vacioTareas: "아직 아무것도 없어요. 프로젝트 채팅에서 Len에게 예약 작업을 요청하세요.",
    teNecesita: "확인 필요", trabajando: "진행 중", programadas: "예약됨", resueltas: "해결됨", nada: "없음", lenTrabajando: "Len이 작업 중이에요",
    lenWatch: "Len Watch: 앱에 확인이 필요해요", incidenteResuelto: "장애 해결됨", ultimaBien: "지난 실행은 성공했어요", ultimaMal: "지난 실행은 완료되지 않았어요",
    enPausa: "일시 중지됨", proxima: "다음: {when}", confirmarBorrar: "이 작업을 삭제할까요?", borrar: "삭제", cancelar: "취소", reanudar: "다시 시작",
    pausar: "일시 중지", editar: "편집", nombre: "이름", queHacer: "할 일", cuando: "언제", zona: "시간대", guardar: "저장",
    frecuencia_once: "한 번", frecuencia_daily: "매일", frecuencia_weekly: "매주", frecuencia_hours: "X시간마다", frecuencia_cron: "Cron", accionFallo: "되지 않았습니다. 다시 시도해 주세요.",
  },
  zh: {
    entregado: "已交付", tareas: "任务", cerrar: "关闭", error: "无法加载。", reintentar: "重试", cargando: "正在加载…",
    vacioEntregado: "Len 还没有交付文件。", vacioTareas: "这里还没有内容。在项目聊天中让 Len 创建定时任务。",
    teNecesita: "需要你处理", trabajando: "进行中", programadas: "已计划", resueltas: "已解决", nada: "无", lenTrabajando: "Len 正在工作",
    lenWatch: "Len Watch：你的应用需要处理", incidenteResuelto: "故障已解决", ultimaBien: "上次运行成功", ultimaMal: "上次运行未完成",
    enPausa: "已暂停", proxima: "下次：{when}", confirmarBorrar: "删除此任务？", borrar: "删除", cancelar: "取消", reanudar: "恢复",
    pausar: "暂停", editar: "编辑", nombre: "名称", queHacer: "要做什么", cuando: "时间", zona: "时区", guardar: "保存",
    frecuencia_once: "一次", frecuencia_daily: "每天", frecuencia_weekly: "每周", frecuencia_hours: "每 X 小时", frecuencia_cron: "Cron", accionFallo: "没有成功，请再试一次。",
  },
  nl: {
    entregado: "Geleverd", tareas: "Taken", cerrar: "Sluiten", error: "Laden mislukt.", reintentar: "Opnieuw proberen", cargando: "Laden…",
    vacioEntregado: "Len heeft je nog geen bestanden geleverd.", vacioTareas: "Nog niets hier. Vraag Len in de chat van je project om een geplande taak.",
    teNecesita: "Wacht op jou", trabajando: "Bezig", programadas: "Gepland", resueltas: "Opgelost", nada: "Niets", lenTrabajando: "Len is bezig",
    lenWatch: "Len Watch: je app heeft aandacht nodig", incidenteResuelto: "Storing opgelost", ultimaBien: "de laatste ging goed", ultimaMal: "de laatste lukte niet",
    enPausa: "Gepauzeerd", proxima: "Volgende: {when}", confirmarBorrar: "Deze taak verwijderen?", borrar: "Verwijderen", cancelar: "Annuleren", reanudar: "Hervatten",
    pausar: "Pauzeren", editar: "Bewerken", nombre: "Naam", queHacer: "Wat te doen", cuando: "Wanneer", zona: "Tijdzone", guardar: "Opslaan",
    frecuencia_once: "Eén keer", frecuencia_daily: "Elke dag", frecuencia_weekly: "Elke week", frecuencia_hours: "Elke X uur", frecuencia_cron: "Cron", accionFallo: "Dat lukte niet. Probeer het opnieuw.",
  },
};
