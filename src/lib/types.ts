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

export interface PageFetchAttempt {
  url: string;
  status: "ok" | "blocked" | "timeout" | "error" | "not_found" | "empty";
  statusCode?: number;
  headingCount?: number;
  note?: string;
}

export interface NewsFetchAttempt {
  source: string;
  count: number;
  note?: string;
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
  resolvedBaseUrl?: string;
  pageFetchAttempts?: PageFetchAttempt[];
  newsFetchAttempts?: NewsFetchAttempt[];
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
  contextBundle?: ContextBundle;
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

/* ── ContextBundle: single source of truth for idea generation ── */

export interface ContextBundleCompany {
  name: string;
  url?: string;
  description?: string;
  wikidataId?: string;
  industryHints: string[];
}

export interface ContextBundlePage {
  url: string;
  headings: string[];
}

export interface ContextBundlePages {
  items: ContextBundlePage[];
  navLabels: string[];
  thinContent: boolean;
}

export interface ContextBundleBrand {
  found: boolean;
  source?: "site-css" | "favicon" | "default";
  primary?: string;
  accent?: string;
  fontFamily?: string;
  faviconUrl?: string;
}

export interface ContextBundlePressItem {
  url: string;
  title?: string;
}

export interface ContextBundlePress {
  items: ContextBundlePressItem[];
  headlines: string[];
}

export interface ContextBundleGdeltItem {
  title: string;
  source: string;
  url: string;
  date?: string;
}

export interface ContextBundleGdelt {
  items: ContextBundleGdeltItem[];
}

export interface ContextBundlePHItem {
  name: string;
  tagline: string;
  url?: string;
}

export interface ContextBundleProductHunt {
  items: ContextBundlePHItem[];
  keywords: string[];
  modeUsed?: "keyword" | "trending";
  commonPatterns: string[];
}

export interface ContextBundle {
  company: ContextBundleCompany;
  pages: ContextBundlePages;
  brand: ContextBundleBrand;
  press: ContextBundlePress;
  gdelt: ContextBundleGdelt;
  productHunt: ContextBundleProductHunt;
}
