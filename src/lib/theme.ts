// Light or dark Lamplight for member pages (staff portal, account, application links). Dark is the
// brand default and the public site is always dark; a member's pick is kept in this browser. The
// choice lives on <html data-theme>, and styles.css repaints only .ll-member pages with it.

export type Theme = "dark" | "light";

const KEY = "lamp.theme";

/** Runs in <head> before the first paint, so a light-mode visitor never sees a dark flash. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light")document.documentElement.dataset["theme"]="light"}catch(e){}`;

export function currentTheme(): Theme {
  return document.documentElement.dataset["theme"] === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset["theme"] = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode: the pick lasts for this page only
  }
  window.dispatchEvent(new Event("lamp-theme"));
}
