// Light or dark Lamplight. Dark is the brand default; a visitor's pick is kept in this browser.
// The choice lives on <html data-theme>, so styles.css can repaint everything without a re-render.

export type Theme = "dark" | "light";

const KEY = "lamp.theme";
const BAR = { dark: "#0b140f", light: "#f6f7f2" } as const;

/** Runs in <head> before the first paint, so a light-mode visitor never sees a dark flash. */
export const THEME_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light"){document.documentElement.dataset["theme"]="light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.content="${BAR.light}"}}catch(e){}`;

export function currentTheme(): Theme {
  return document.documentElement.dataset["theme"] === "light" ? "light" : "dark";
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset["theme"] = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[theme]);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // private mode: the pick lasts for this page only
  }
  window.dispatchEvent(new Event("lamp-theme"));
}
