/* ── Shared types for Amuse Bouchenator ── */

export type EffortLevel = "15min" | "1hr" | "4hr" | "8hr" | "1-3days";

export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface AnalysisStep {
  id: string;
  label: string;
  status: StepStatus;
  note?: string;
}

export interface Theme {
  primary: string;
  accent: string;
  bg: string;
  text: string;
  fontFamily?: string;
  source: "site-css" | "favicon" | "default";
  note?: string;
  faviconUrl?: string;
  logoUrl?: string;
  companyName?: string;
  radiusPx?: number;
}

export interface PHInspiration {
  name: string;
  tagline: string;
  topics: string[];
  url?: string;
}

/* ── Wikidata enrichment ── */

export interface WikidataProfile {
  id: string;
  label: string;
  description: string;
  website?: string;
  industryHints: string[];
}

/* ── Observability evidence attached to every analysis job ── */

export interface EvidenceNewsItem {
  title: string;
  source: string;
  url: string;
  date?: string;
}

export interface EvidencePHItem {
  name: string;
  tagline?: string;
  url?: string;
}

/* ── Inspiration Pack (internal, not shown to user) ── */

export interface InspirationProduct {
  name: string;
  tagline: string;
  url?: string;
  topics: string[];
  inferredFeatures: string[];
}

export interface InspirationPack {
  modeUsed: "keyword" | "trending";
  keywords: string[];
  products: InspirationProduct[];
  commonPatterns: string[];
}

export interface WikidataEvidence {
  used: boolean;
  candidatesCount?: number;
  selectedId?: string;
}

export interface EvidenceNews {
  provider: string;
  count: number;
  items: EvidenceNewsItem[];
}

export interface JobEvidence {
  cache: { theme: boolean; news: boolean; productHunt: boolean };
  timingsMs: Record<string, number>;
  keyPages: string[];
  pressLinks: string[];
  news: EvidenceNews;
  productHunt: EvidencePHItem[];
  usedGemini: boolean;
  geminiError?: string;
  wikidata: WikidataEvidence;
  inspirationPack?: InspirationPack;
}

export interface CompanyContext {
  name: string;
  url?: string;
  description?: string;
  headings?: string[];
  navLabels?: string[];
  pressHeadlines?: string[];
  newsItems?: string[];
  productHuntInspiration?: PHInspiration[];
  wikidataId?: string;
  industryHints?: string[];
}

export interface IdeaOutline {
  pages: string[];
  components: string[];
  data: string[];
  niceToHave: string[];
}

export interface Idea {
  id: string;
  jobId: string;
  title: string;
  summary: string;
  effort: EffortLevel;
  outline: IdeaOutline;
  theme?: Theme;
  inspiredAngle?: string;
  source?: "generated" | "custom";
  originalPrompt?: string;
}

export interface Job {
  id: string;
  input: string;
  disambiguationChoice?: string;
  wikidataProfile?: WikidataProfile;
  steps: AnalysisStep[];
  status: "pending" | "running" | "done" | "failed";
  ideas: Idea[];
  companyContext: CompanyContext;
  theme?: Theme;
  evidence?: JobEvidence;
}

export interface BuildStep {
  title: string;
  role: string;
  instruction: string;
  cursorPrompt: string;
  doneLooksLike: string;
}

export interface BuildPlan {
  ideaId: string;
  bmadExplanation: string;
  terminalSetup: string;
  folderName: string;
  steps: BuildStep[];
}

export interface DisambiguationOption {
  label: string;
  description: string;
  domain?: string;
  wikidataId?: string;
}
