// sessionStorage can throw (private mode, blocked site data). Everything kept here is a
// convenience, so a failure just means starting fresh.
export function loadSession(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function saveSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* fine without */
  }
}
