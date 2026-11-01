// The phone's texts for what Len delivered (spec local 2026-10-31-len-movil, §5.1): the chat's cards and
// the viewer's buttons, in the 10 languages (namespace `movil.entregado`).
import type { Idioma } from "./config";

const es = { titulo: "Lo que te entregó Len", compartir: "Compartir", abrirCon: "Abrir con…", cerrar: "Cerrar", sinVista: "Vista previa no disponible", abriendo: "Abriendo…", fallo: "No se pudo abrir este archivo" };
type Texts = Record<keyof typeof es, string>;

export const deliveredTexts: Record<Idioma, Texts> = {
  es,
  en: { titulo: "What Len delivered", compartir: "Share", abrirCon: "Open with…", cerrar: "Close", sinVista: "No preview for this file", abriendo: "Opening…", fallo: "Couldn't open this file" },
  pt: { titulo: "O que o Len entregou", compartir: "Compartilhar", abrirCon: "Abrir com…", cerrar: "Fechar", sinVista: "Pré-visualização indisponível", abriendo: "Abrindo…", fallo: "Não foi possível abrir este arquivo" },
  fr: { titulo: "Ce que Len a livré", compartir: "Partager", abrirCon: "Ouvrir avec…", cerrar: "Fermer", sinVista: "Aperçu indisponible", abriendo: "Ouverture…", fallo: "Impossible d’ouvrir ce fichier" },
  de: { titulo: "Was Len geliefert hat", compartir: "Teilen", abrirCon: "Öffnen mit…", cerrar: "Schließen", sinVista: "Keine Vorschau verfügbar", abriendo: "Wird geöffnet…", fallo: "Datei konnte nicht geöffnet werden" },
  it: { titulo: "Cosa ha consegnato Len", compartir: "Condividi", abrirCon: "Apri con…", cerrar: "Chiudi", sinVista: "Anteprima non disponibile", abriendo: "Apertura…", fallo: "Impossibile aprire questo file" },
  ja: { titulo: "Lenが届けたもの", compartir: "共有", abrirCon: "ほかのアプリで開く…", cerrar: "閉じる", sinVista: "プレビューはありません", abriendo: "開いています…", fallo: "このファイルを開けませんでした" },
  ko: { titulo: "Len이 전달한 파일", compartir: "공유", abrirCon: "다른 앱으로 열기…", cerrar: "닫기", sinVista: "미리보기를 사용할 수 없어요", abriendo: "여는 중…", fallo: "이 파일을 열 수 없어요" },
  zh: { titulo: "Len 交付的文件", compartir: "分享", abrirCon: "用其他应用打开…", cerrar: "关闭", sinVista: "无法预览", abriendo: "正在打开…", fallo: "无法打开此文件" },
  nl: { titulo: "Wat Len heeft geleverd", compartir: "Delen", abrirCon: "Openen met…", cerrar: "Sluiten", sinVista: "Geen voorbeeld beschikbaar", abriendo: "Openen…", fallo: "Dit bestand kon niet worden geopend" },
};
