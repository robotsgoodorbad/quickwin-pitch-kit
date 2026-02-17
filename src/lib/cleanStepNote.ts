/**
 * Sanitize an AnalysisStep note for checklist display.
 * Keeps friendly counts, strips technical diagnostics.
 * Returns null if the note should be hidden entirely.
 */
export function cleanStepNote(raw: string): string | null {
  // Extract a count phrase like "4 page(s)", "12 product(s)", "3 ideas"
  const countMatch = raw.match(/(\d+)\s+(page|heading|URL|headline|article|product|idea)\(?s?\)?/i);
  if (countMatch) {
    const n = parseInt(countMatch[1], 10);
    const unit = countMatch[2].toLowerCase();
    if (n === 0) return "none found";
    const plural = n === 1 ? unit : unit + "s";
    return `${n} ${plural}`;
  }

  // Zero results
  if (/0\s+found|no\s+articles|empty\s+results/i.test(raw)) return "none found";

  // Access / network problems
  if (/blocked|limited|access|403|401|timeout/i.test(raw)) return "limited access";
  if (/failed|error/i.test(raw)) return "limited access";

  // Nothing meaningful to show
  if (/no\s+.*URL|no\s+website|skipped/i.test(raw)) return null;

  // Brand theme notes — keep only the short summary before any "—"
  if (/neutral\s+theme|name-derived/i.test(raw)) {
    return raw.split("—")[0].trim() || null;
  }

  // Generation provider notes — just show the idea count
  if (/gemini|openai|mock|fallback/i.test(raw)) {
    const ideaCount = raw.match(/(\d+)\s+idea/i);
    return ideaCount ? `${ideaCount[1]} ideas` : null;
  }

  // Strip parenthetical diagnostics like "(cached)", "(domain: x.com)" etc.
  if (raw.includes("(") && raw.includes(")")) {
    const stripped = raw.replace(/\s*\([^)]*\)/g, "").trim();
    return stripped || null;
  }

  // Domain-only notes (e.g. "delta.com") — keep as-is
  return raw;
}
