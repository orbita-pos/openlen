// lib/apps/iconos.ts — los iconos que una app web puede importar de
// `lucide-react` (D3 de la spec local docs/superpowers/specs/2026-10-07-apps-
// design.md, decidido el 2026-10-07: «router + iconos curados»).
//
// POR QUÉ UNA LISTA Y NO LUCIDE ENTERO. Sin bundler no hay tree-shaking en la
// app: `lucide-react` es UN módulo del catálogo, y lo que lleva lo descarga
// entero cada visitante de la app que importe un solo icono. Lucide trae casi
// 2.000; con todos pesaría más que React.
//
// Son los del editor (`lib/lucide-curated.ts`, pensados para landings) MÁS los
// que pide una app: caja, cocina, inventario, agenda, usuarios. Un nombre por
// icono basta: `npm run apps:vendor` exporta también sus ALIAS —el nombre viejo
// y el nuevo de lucide (`CheckCircle2` y `CircleCheck`), y el sufijo `Icon`—,
// porque los modelos escriben cualquiera de los tres.
//
// 🔴 ESTO ENTRA EN UN CATÁLOGO CONGELADO. Añadir un icono cambia los bytes de
// `lucide-react.js`: sólo vale en un catálogo NUEVO (lib/apps/dependencias.ts).
// El de un catálogo ya publicado se lee de su manifiesto, no de aquí.
//
// Puro: lo leen el script del vendor y las pruebas.

/** Los iconos del editor (`lib/lucide-curated.ts`). Una prueba exige que sigan
 *  siendo los mismos que importa ese fichero. */
export const ICONOS_DEL_EDITOR = [
  "Activity", "AlertCircle", "AlertTriangle", "Archive", "ArrowDown", "ArrowDownRight", "ArrowLeft", "ArrowRight",
  "ArrowUp", "ArrowUpRight", "AtSign", "Award", "BarChart", "BarChart2", "BarChart3", "Bell", "Bookmark", "Box",
  "Briefcase", "Building2", "Calendar", "Camera", "Check", "CheckCircle", "CheckCircle2", "ChevronDown", "ChevronLeft",
  "ChevronRight", "ChevronUp", "ChevronsRight", "Clock", "Cloud", "Code", "Code2", "Compass", "Copy", "Cpu", "CreditCard",
  "Database", "DollarSign", "Download", "Edit", "ExternalLink", "Eye", "File", "FileCheck", "FileCode", "FilePlus",
  "FileText", "Filter", "Flame", "Folder", "FolderOpen", "Gift", "GitBranch", "GitCommit", "GitPullRequest", "Globe",
  "Headphones", "Heart", "HelpCircle", "Image", "Inbox", "Info", "Key", "Layers", "LineChart", "Link", "Loader",
  "Loader2", "Lock", "Mail", "Map", "MapPin", "Menu", "MessageCircle", "MessageSquare", "Mic", "MicOff", "Minus", "Moon",
  "MoreHorizontal", "MoreVertical", "Music", "Package", "Pause", "Phone", "PieChart", "Play", "Plus", "RefreshCw",
  "Rocket", "Save", "Search", "Send", "Server", "Settings", "Share", "Share2", "Shield", "ShieldCheck", "ShoppingCart",
  "Sparkles", "Star", "Sun", "Target", "Terminal", "Timer", "Trash2", "TrendingDown", "TrendingUp", "Trophy", "Truck",
  "Unlock", "User", "Users", "Video", "Volume2", "Wand2", "X", "XCircle", "Zap",
] as const;

/** Lo que una app pide y una landing no. */
export const ICONOS_DE_APP = [
  // Caja y ventas
  "Receipt", "Printer", "Calculator", "Wallet", "Banknote", "Coins", "Euro", "PiggyBank", "Percent", "Tag", "Tags",
  "Store", "ShoppingBag", "ShoppingBasket", "Barcode", "ScanBarcode", "QrCode", "Ticket", "BadgePercent", "Handshake",
  // Cocina y comida
  "Coffee", "Utensils", "UtensilsCrossed", "Pizza", "CupSoda", "Wine", "Beer", "Cake", "Croissant", "Salad",
  // Inventario
  "PackageCheck", "PackagePlus", "Boxes", "Warehouse",
  // Agenda
  "CalendarDays", "CalendarCheck", "CalendarPlus", "CalendarClock", "History",
  // Edición y listas
  "Pencil", "SquarePen", "Undo2", "Redo2", "RotateCcw", "Upload", "Paperclip", "List", "ListOrdered", "ListChecks",
  "ClipboardList", "ClipboardCheck", "Table", "FileSpreadsheet", "FileDown", "Hash", "Square", "SquareCheck", "Circle",
  "CirclePlus", "CircleMinus", "Ellipsis", "ArrowUpDown", "ArrowLeftRight", "Maximize2", "Minimize2",
  "SlidersHorizontal", "ToggleLeft", "ToggleRight", "EyeOff", "Ban", "Flag", "BadgeCheck",
  // Pantallas y cuentas
  "House", "LayoutDashboard", "LayoutGrid", "LogIn", "LogOut", "UserPlus", "UserMinus", "UserCheck", "UserX",
  "CircleUser", "Building", "Power", "Wifi", "WifiOff", "Languages", "Monitor", "Smartphone", "Laptop", "Bot",
  "Megaphone", "Lightbulb", "Smile", "ThumbsUp", "ThumbsDown",
  // Otros negocios
  "Scissors", "Shirt", "Car", "Bike", "Plane", "Hotel", "Bed", "Stethoscope", "HeartPulse", "Dumbbell",
  "GraduationCap", "BookOpen", "PawPrint", "Leaf", "Wrench",
] as const;

/** Lo que construye el catálogo 2026-10: un nombre por icono, sin repetir. */
export const ICONOS_DE_LAS_APPS: readonly string[] = [...new Set<string>([...ICONOS_DEL_EDITOR, ...ICONOS_DE_APP])];
