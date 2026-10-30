import type { Idioma } from "./config";

// LEN WATCH en Gestión (spec local 2026-10-30-len-watch): los mismos textos que la web
// (messages/<idioma>/panelsChat.json y modalsDeploy.json, bloque `lenWatch`).
const es = {
  title: "Len Watch", intro: "Si tu sitio publicado deja de cargar, te avisamos.", watch: "Vigilar y avisar", autoFix: "Arreglar solo", autoFixHint: "Len empieza a arreglarlo en cuanto se cae. Usa tus créditos.", autoPublish: "Publicar solo", autoPublishHint: "Publica el arreglo sin esperarte, salvo que lo pare la revisión de seguridad o un cambio de datos.", ownerOnly: "Solo el dueño del proyecto puede cambiar esto.",
  working: "Tu sitio publicado no carga. Len está en ello.", down: "Tu sitio publicado no carga.", ready: "Len arregló tu sitio. Falta publicar el arreglo.", shipsUnpublished: "Saldrán también tus cambios sin publicar.", fix: "Arreglar con Len", approve: "Publicar el arreglo", review: "La publicación necesita tu revisión: usa «Publicar los cambios».", failed: "No se pudo. Prueba otra vez.", changed: "El borrador cambió después del arreglo de Len: esos cambios saldrían también.", publishAnyway: "Publicar igual",
};
type TextosLenWatch = Record<keyof typeof es, string>;
export const textosLenWatch: Record<Idioma, TextosLenWatch> = {
  es,
  en: {
    title: "Len Watch", intro: "If your published site stops loading, we let you know.", watch: "Watch and notify", autoFix: "Fix on its own", autoFixHint: "Len starts fixing it as soon as it goes down. It uses your credits.", autoPublish: "Publish on its own", autoPublishHint: "Publishes the fix without waiting for you, unless the security review or a data change stops it.", ownerOnly: "Only the project's owner can change this.",
    working: "Your published site isn't loading. Len is on it.", down: "Your published site isn't loading.", ready: "Len fixed your site. The fix isn't published yet.", shipsUnpublished: "Your unpublished changes will go out too.", fix: "Fix with Len", approve: "Publish the fix", review: "Publishing needs your review: use «Publish changes».", failed: "That didn't work. Try again.", changed: "The draft changed after Len's fix: those edits would go out too.", publishAnyway: "Publish anyway",
  },
  pt: {
    title: "Len Watch", intro: "Se o seu site publicado parar de carregar, avisamos você.", watch: "Vigiar e avisar", autoFix: "Corrigir sozinho", autoFixHint: "O Len começa a corrigir assim que ele cai. Usa seus créditos.", autoPublish: "Publicar sozinho", autoPublishHint: "Publica a correção sem esperar por você, a menos que a revisão de segurança ou uma mudança de dados impeça.", ownerOnly: "Só o dono do projeto pode mudar isso.",
    working: "Seu site publicado não carrega. O Len está cuidando disso.", down: "Seu site publicado não carrega.", ready: "O Len corrigiu seu site. Falta publicar a correção.", shipsUnpublished: "Suas alterações não publicadas também sairão.", fix: "Corrigir com o Len", approve: "Publicar a correção", review: "A publicação precisa da sua revisão: use «Publicar alterações».", failed: "Não deu certo. Tente de novo.", changed: "O rascunho mudou depois da correção do Len: essas alterações também sairiam.", publishAnyway: "Publicar mesmo assim",
  },
  fr: {
    title: "Len Watch", intro: "Si votre site publié cesse de se charger, nous vous prévenons.", watch: "Surveiller et prévenir", autoFix: "Réparer tout seul", autoFixHint: "Len commence à le réparer dès qu'il tombe. Cela utilise vos crédits.", autoPublish: "Publier tout seul", autoPublishHint: "Publie la correction sans vous attendre, sauf si la vérification de sécurité ou un changement de données l'arrête.", ownerOnly: "Seul le propriétaire du projet peut modifier ceci.",
    working: "Votre site publié ne se charge pas. Len s'en occupe.", down: "Votre site publié ne se charge pas.", ready: "Len a réparé votre site. La correction n'est pas encore publiée.", shipsUnpublished: "Vos modifications non publiées seront publiées aussi.", fix: "Réparer avec Len", approve: "Publier la correction", review: "La publication demande votre vérification : utilisez « Publier les modifications ».", failed: "Ça n'a pas marché. Réessayez.", changed: "Le brouillon a changé après la correction de Len : ces modifications seraient publiées aussi.", publishAnyway: "Publier quand même",
  },
  de: {
    title: "Len Watch", intro: "Wenn deine veröffentlichte Seite nicht mehr lädt, sagen wir dir Bescheid.", watch: "Überwachen und benachrichtigen", autoFix: "Selbst reparieren", autoFixHint: "Len beginnt mit der Reparatur, sobald sie ausfällt. Das verbraucht deine Credits.", autoPublish: "Selbst veröffentlichen", autoPublishHint: "Veröffentlicht die Korrektur, ohne auf dich zu warten, außer die Sicherheitsprüfung oder eine Datenänderung hält sie auf.", ownerOnly: "Nur der Eigentümer des Projekts kann das ändern.",
    working: "Deine veröffentlichte Seite lädt nicht. Len ist dran.", down: "Deine veröffentlichte Seite lädt nicht.", ready: "Len hat deine Seite repariert. Die Korrektur ist noch nicht veröffentlicht.", shipsUnpublished: "Deine unveröffentlichten Änderungen gehen auch online.", fix: "Mit Len reparieren", approve: "Korrektur veröffentlichen", review: "Die Veröffentlichung braucht deine Prüfung: Nutze „Änderungen veröffentlichen“.", failed: "Das hat nicht geklappt. Versuch es noch einmal.", changed: "Der Entwurf hat sich nach Lens Korrektur geändert: Diese Änderungen gingen auch online.", publishAnyway: "Trotzdem veröffentlichen",
  },
  it: {
    title: "Len Watch", intro: "Se il tuo sito pubblicato smette di caricarsi, ti avvisiamo.", watch: "Controlla e avvisa", autoFix: "Sistema da solo", autoFixHint: "Len inizia a sistemarlo appena va giù. Usa i tuoi crediti.", autoPublish: "Pubblica da solo", autoPublishHint: "Pubblica la correzione senza aspettarti, a meno che la revisione di sicurezza o una modifica ai dati la fermi.", ownerOnly: "Solo il proprietario del progetto può cambiarlo.",
    working: "Il tuo sito pubblicato non si carica. Len ci sta lavorando.", down: "Il tuo sito pubblicato non si carica.", ready: "Len ha sistemato il tuo sito. La correzione non è ancora pubblicata.", shipsUnpublished: "Usciranno anche le tue modifiche non pubblicate.", fix: "Sistema con Len", approve: "Pubblica la correzione", review: "La pubblicazione richiede la tua revisione: usa «Pubblica modifiche».", failed: "Non è andata. Riprova.", changed: "La bozza è cambiata dopo la correzione di Len: usciranno anche quelle modifiche.", publishAnyway: "Pubblica comunque",
  },
  ja: {
    title: "Len Watch", intro: "公開中のサイトが表示されなくなったらお知らせします。", watch: "監視して通知", autoFix: "自動で修正", autoFixHint: "サイトが落ちるとすぐに Len が修正を始めます。クレジットを使います。", autoPublish: "自動で公開", autoPublishHint: "あなたを待たずに修正を公開します。ただし、セキュリティレビューやデータの変更で止まる場合があります。", ownerOnly: "これを変更できるのはプロジェクトのオーナーだけです。",
    working: "公開中のサイトが表示されません。Len が対応しています。", down: "公開中のサイトが表示されません。", ready: "Len がサイトを修正しました。修正はまだ公開されていません。", shipsUnpublished: "まだ公開していない変更も一緒に公開されます。", fix: "Len に修正を頼む", approve: "修正を公開", review: "公開する前に確認が必要です。「変更を公開」から確認してください。", failed: "うまくいきませんでした。もう一度お試しください。", changed: "Len の修正のあとで下書きが変わりました。その変更も一緒に公開されます。", publishAnyway: "このまま公開",
  },
  ko: {
    title: "Len Watch", intro: "게시된 사이트가 열리지 않으면 알려 드려요.", watch: "감시하고 알리기", autoFix: "알아서 고치기", autoFixHint: "사이트가 멈추면 Len이 바로 고치기 시작해요. 크레딧을 사용해요.", autoPublish: "알아서 게시하기", autoPublishHint: "보안 검토나 데이터 변경으로 멈추지 않는 한, 기다리지 않고 수정 사항을 게시해요.", ownerOnly: "프로젝트 소유자만 바꿀 수 있어요.",
    working: "게시된 사이트가 열리지 않아요. Len이 고치고 있어요.", down: "게시된 사이트가 열리지 않아요.", ready: "Len이 사이트를 고쳤어요. 수정 사항은 아직 게시되지 않았어요.", shipsUnpublished: "게시하지 않은 변경 사항도 함께 게시돼요.", fix: "Len에게 고쳐 달라고 하기", approve: "수정 사항 게시", review: "게시하려면 확인이 필요해요. '변경 사항 게시'를 사용하세요.", failed: "잘 안 됐어요. 다시 시도해 주세요.", changed: "Len이 고친 뒤에 초안이 바뀌었어요. 그 변경 사항도 함께 게시돼요.", publishAnyway: "그래도 게시",
  },
  zh: {
    title: "Len Watch", intro: "如果你发布的网站无法加载，我们会通知你。", watch: "监控并通知", autoFix: "自动修复", autoFixHint: "网站一出问题，Len 就开始修复。会使用你的额度。", autoPublish: "自动发布", autoPublishHint: "不等你就发布修复，除非安全审查或数据更改阻止了它。", ownerOnly: "只有项目所有者可以更改此项。",
    working: "你发布的网站无法加载。Len 正在处理。", down: "你发布的网站无法加载。", ready: "Len 修复了你的网站。修复尚未发布。", shipsUnpublished: "你尚未发布的更改也会一起发布。", fix: "让 Len 修复", approve: "发布修复", review: "发布前需要你检查：请使用「发布更改」。", failed: "没有成功，请重试。", changed: "Len 修复后草稿又有改动：这些改动也会一起发布。", publishAnyway: "仍然发布",
  },
  nl: {
    title: "Len Watch", intro: "Als je gepubliceerde site niet meer laadt, laten we het je weten.", watch: "Bewaken en melden", autoFix: "Zelf repareren", autoFixHint: "Len begint met repareren zodra hij plat gaat. Dit gebruikt je credits.", autoPublish: "Zelf publiceren", autoPublishHint: "Publiceert de oplossing zonder op je te wachten, tenzij de beveiligingscontrole of een datawijziging het tegenhoudt.", ownerOnly: "Alleen de eigenaar van het project kan dit wijzigen.",
    working: "Je gepubliceerde site laadt niet. Len is ermee bezig.", down: "Je gepubliceerde site laadt niet.", ready: "Len heeft je site gerepareerd. De oplossing is nog niet gepubliceerd.", shipsUnpublished: "Je niet-gepubliceerde wijzigingen gaan ook live.", fix: "Repareren met Len", approve: "Oplossing publiceren", review: "Publiceren heeft je controle nodig: gebruik „Wijzigingen publiceren”.", failed: "Dat lukte niet. Probeer het opnieuw.", changed: "Het concept is gewijzigd na de oplossing van Len: die wijzigingen gaan ook live.", publishAnyway: "Toch publiceren",
  },
};
