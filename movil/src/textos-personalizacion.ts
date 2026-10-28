import type { Idioma } from "./config";

const presets = "clasico profe chef michi cool vaquero mago dj pirata invierno vikingo artista graduado fiesta skater primavera navidad rey monito bigoton".split(" ");
const cabezas = "chef vaquero gorra lana boina fiesta corona mago vikingo birrete santa pirata flor michi audifonos mono".split(" ");
const caras = "lentes sol rubor bigote parche gato".split(" ");
const campos = "titulo descripcion aplicar cancelar anterior siguiente personalizado cabeza cara nada vista estilos cargando error reintentar".split(" ");
function mensajes(ui: string, looks: string, head: string, face: string) {
  const map = (keys: string[], values: string) => Object.fromEntries(keys.map((key, i) => [key, values.split("|")[i]]));
  return { ...map(campos, ui), looks: map(presets, looks), cabezas: map(cabezas, head), caras: map(caras, face) };
}

export const textosPersonalizacion: Record<Idioma, object> = {
  es: mensajes("Tu Len|Cambia cómo se ve. Trabaja igual.|Aplicar|Cancelar|Anterior|Siguiente|A tu manera|Cabeza|Cara|Nada|Vista previa de Len|Estilos|Cargando estilos…|No se pudo guardar o cargar el estilo. Inténtalo de nuevo.|Reintentar",
    "Clásico|Profe|Chef|Michi|Cool|Vaquero|Mago|DJ|Pirata|Invierno|Vikingo|Artista|Graduado|Fiesta|Skater|Primavera|Navidad|Rey|Moñito|Bigotón",
    "Gorro de chef|Sombrero vaquero|Gorra|Gorro de lana|Boina|Gorro de fiesta|Corona|Sombrero de mago|Casco vikingo|Birrete|Gorro navideño|Pañuelo pirata|Flor|Orejas de gato|Audífonos|Moño",
    "Lentes|Lentes de sol|Chapitas|Bigote|Parche|Bigotes de gato"),
  en: mensajes("Your Len|Change the look. Same helpful Len.|Apply|Cancel|Previous|Next|Your own style|Head|Face|None|Len preview|Styles|Loading styles…|Could not save or load the style. Please try again.|Retry",
    "Classic|Teacher|Chef|Kitty|Cool|Cowboy|Wizard|DJ|Pirate|Winter|Viking|Artist|Graduate|Party|Skater|Spring|Christmas|King|Bow|Mustache",
    "Chef hat|Cowboy hat|Cap|Wool hat|Beret|Party hat|Crown|Wizard hat|Viking helmet|Graduation cap|Christmas hat|Pirate bandana|Flower|Cat ears|Headphones|Bow",
    "Glasses|Sunglasses|Blush|Mustache|Eye patch|Cat whiskers"),
  pt: mensajes("Seu Len|Mude o visual. Ele trabalha igual.|Aplicar|Cancelar|Anterior|Próximo|Do seu jeito|Cabeça|Rosto|Nenhum|Prévia do Len|Estilos|Carregando estilos…|Não foi possível salvar ou carregar o estilo. Tente novamente.|Tentar novamente",
    "Clássico|Professor|Chef|Gatinho|Descolado|Vaqueiro|Mago|DJ|Pirata|Inverno|Viking|Artista|Formado|Festa|Skatista|Primavera|Natal|Rei|Lacinho|Bigodudo",
    "Chapéu de chef|Chapéu de vaqueiro|Boné|Gorro de lã|Boina|Chapéu de festa|Coroa|Chapéu de mago|Capacete viking|Capelo|Gorro de Natal|Lenço de pirata|Flor|Orelhas de gato|Fones de ouvido|Laço",
    "Óculos|Óculos de sol|Bochechas rosadas|Bigode|Tapa-olho|Bigodes de gato"),
  fr: mensajes("Votre Len|Un autre look. Toujours le même Len.|Appliquer|Annuler|Précédent|Suivant|À votre façon|Tête|Visage|Aucun|Aperçu de Len|Styles|Chargement des styles…|Impossible de charger ou d’enregistrer le style. Réessayez.|Réessayer",
    "Classique|Prof|Chef|Chaton|Cool|Cow-boy|Magicien|DJ|Pirate|Hiver|Viking|Artiste|Diplômé|Fête|Skateur|Printemps|Noël|Roi|Petit nœud|Moustachu",
    "Toque de chef|Chapeau de cow-boy|Casquette|Bonnet de laine|Béret|Chapeau de fête|Couronne|Chapeau de magicien|Casque viking|Toque de diplômé|Bonnet de Noël|Bandana de pirate|Fleur|Oreilles de chat|Casque audio|Nœud",
    "Lunettes|Lunettes de soleil|Joues roses|Moustache|Cache-œil|Moustaches de chat"),
  de: mensajes("Dein Len|Neuer Look. Derselbe hilfreiche Len.|Anwenden|Abbrechen|Zurück|Weiter|Dein eigener Stil|Kopf|Gesicht|Keine|Len-Vorschau|Stile|Stile werden geladen…|Der Stil konnte nicht geladen oder gespeichert werden. Versuche es erneut.|Erneut versuchen",
    "Klassisch|Lehrer|Koch|Kätzchen|Cool|Cowboy|Zauberer|DJ|Pirat|Winter|Wikinger|Künstler|Absolvent|Party|Skater|Frühling|Weihnachten|König|Schleife|Schnurrbart",
    "Kochmütze|Cowboyhut|Kappe|Wollmütze|Baskenmütze|Partyhut|Krone|Zauberhut|Wikingerhelm|Doktorhut|Weihnachtsmütze|Piratentuch|Blume|Katzenohren|Kopfhörer|Schleife",
    "Brille|Sonnenbrille|Rote Wangen|Schnurrbart|Augenklappe|Katzenschnurrhaare"),
  it: mensajes("Il tuo Len|Cambia il look. Lavora come sempre.|Applica|Annulla|Precedente|Successivo|A modo tuo|Testa|Viso|Nessuno|Anteprima di Len|Stili|Caricamento degli stili…|Impossibile salvare o caricare lo stile. Riprova.|Riprova",
    "Classico|Prof|Chef|Gattino|Cool|Cowboy|Mago|DJ|Pirata|Inverno|Vichingo|Artista|Laureato|Festa|Skater|Primavera|Natale|Re|Fiocchetto|Baffuto",
    "Cappello da chef|Cappello da cowboy|Berretto|Cappello di lana|Basco|Cappello da festa|Corona|Cappello da mago|Elmo vichingo|Tocco|Cappello di Natale|Bandana da pirata|Fiore|Orecchie da gatto|Cuffie|Fiocco",
    "Occhiali|Occhiali da sole|Guance rosate|Baffi|Benda sull’occhio|Baffi da gatto"),
  ja: mensajes("あなたのLen|見た目を変えても、働きはそのまま。|適用|キャンセル|前へ|次へ|自分だけのスタイル|頭|顔|なし|Lenのプレビュー|スタイル|スタイルを読み込み中…|スタイルを保存または読み込めませんでした。もう一度お試しください。|再試行",
    "クラシック|先生|シェフ|ねこ|クール|カウボーイ|魔法使い|DJ|海賊|冬|バイキング|芸術家|卒業生|パーティー|スケーター|春|クリスマス|王様|リボン|ひげ",
    "シェフ帽|カウボーイハット|キャップ|ニット帽|ベレー帽|パーティー帽|王冠|魔法使いの帽子|バイキングの兜|卒業帽|サンタ帽|海賊のバンダナ|花|ねこ耳|ヘッドホン|リボン",
    "メガネ|サングラス|チーク|口ひげ|眼帯|ねこのひげ"),
  ko: mensajes("나만의 Len|모습은 달라도 일은 그대로예요.|적용|취소|이전|다음|나만의 스타일|머리|얼굴|없음|Len 미리 보기|스타일|스타일 불러오는 중…|스타일을 저장하거나 불러올 수 없어요. 다시 시도해 주세요.|다시 시도",
    "클래식|선생님|셰프|고양이|쿨|카우보이|마법사|DJ|해적|겨울|바이킹|예술가|졸업생|파티|스케이터|봄|크리스마스|왕|리본|콧수염",
    "셰프 모자|카우보이 모자|캡 모자|털모자|베레모|파티 모자|왕관|마법사 모자|바이킹 투구|학사모|크리스마스 모자|해적 두건|꽃|고양이 귀|헤드폰|리본",
    "안경|선글라스|볼터치|콧수염|안대|고양이 수염"),
  zh: mensajes("你的Len|换个造型，工作照常。|应用|取消|上一个|下一个|自定义风格|头部|脸部|无|Len预览|风格|正在加载风格…|无法保存或加载风格，请重试。|重试",
    "经典|老师|厨师|小猫|酷酷|牛仔|魔法师|DJ|海盗|冬日|维京人|艺术家|毕业生|派对|滑板手|春日|圣诞|国王|蝴蝶结|大胡子",
    "厨师帽|牛仔帽|鸭舌帽|毛线帽|贝雷帽|派对帽|王冠|魔法帽|维京头盔|学士帽|圣诞帽|海盗头巾|花朵|猫耳|耳机|蝴蝶结",
    "眼镜|墨镜|腮红|胡子|眼罩|猫须"),
  nl: mensajes("Jouw Len|Een andere look. Dezelfde behulpzame Len.|Toepassen|Annuleren|Vorige|Volgende|Jouw eigen stijl|Hoofd|Gezicht|Geen|Voorbeeld van Len|Stijlen|Stijlen laden…|De stijl kon niet worden opgeslagen of geladen. Probeer het opnieuw.|Opnieuw proberen",
    "Klassiek|Leraar|Chef|Katje|Cool|Cowboy|Tovenaar|DJ|Piraat|Winter|Viking|Artiest|Afgestudeerd|Feest|Skater|Lente|Kerst|Koning|Strikje|Snor",
    "Koksmuts|Cowboyhoed|Pet|Wollen muts|Baret|Feesthoed|Kroon|Tovenaarshoed|Vikinghelm|Afstudeerhoed|Kerstmuts|Piratenbandana|Bloem|Kattenoren|Koptelefoon|Strik",
    "Bril|Zonnebril|Roze wangen|Snor|Ooglapje|Kattensnorharen"),
};
