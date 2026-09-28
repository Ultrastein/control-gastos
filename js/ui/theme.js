// Tema: 'auto' (sigue al sistema), 'light' o 'dark'. Se aplica con data-theme en <html>.
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}
