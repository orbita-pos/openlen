// THE BROWSER'S OFFER TO INSTALL, KEPT FOR THE WINDOW (spec local 2026-11-26-apps-en-el-escritorio, §4.1). `beforeinstallprompt`
// fires ONCE, soon after the page loads; a page that is still hydrating would miss it and tell the person their browser can't
// install the app. So the layout puts this in the `<head>`, before any script of ours: it keeps the event on `window` and the
// window's install card takes it from there. A plain module — a server layout can't read a string out of a client file.
export const EARLY_INSTALL_PROMPT_KEY = "__openlenInstallPrompt";

export const EARLY_INSTALL_PROMPT_SCRIPT = `window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.${EARLY_INSTALL_PROMPT_KEY}=e;});`;
