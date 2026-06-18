export function nowUtc() {
  return new Date().toISOString();
}

export function prettify(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function makeParticipantId(email) {
  return `P-${stableHash(String(email || "").trim().toLowerCase()).toString(16).padStart(8, "0")}`;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSequence(comparisons, seedText) {
  const random = seededRandom(stableHash(seedText || "sakina"));
  const sequence = comparisons.map((comparison, index) => {
    const [a, b] = comparison.outputIds;
    const swap = random() > 0.5;
    return {
      id: comparison.id,
      comparisonId: comparison.id,
      originalOutputIds: comparison.outputIds,
      leftOutputId: swap ? b : a,
      rightOutputId: swap ? a : b,
      sequenceIndex: index + 1,
    };
  });

  for (let i = sequence.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
  }

  return sequence.map((item, index) => ({ ...item, sequenceIndex: index + 1 }));
}

export function containsArabic(value) {
  return /[\u0600-\u06ff]/.test(String(value || ""));
}

export function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function clipText(value, max = 5000) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
