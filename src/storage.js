const PREFIX = "sakina_soap_review_v1";

export const STORAGE_KEYS = {
  accounts: `${PREFIX}:accounts`,
  profile: `${PREFIX}:profile`,
  responses: `${PREFIX}:responses`,
  sequence: `${PREFIX}:sequence`,
  token: `${PREFIX}:token`,
};

export function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function clearStudyStorage() {
  localStorage.removeItem(STORAGE_KEYS.profile);
  localStorage.removeItem(STORAGE_KEYS.responses);
  localStorage.removeItem(STORAGE_KEYS.sequence);
  localStorage.removeItem(STORAGE_KEYS.token);
}
