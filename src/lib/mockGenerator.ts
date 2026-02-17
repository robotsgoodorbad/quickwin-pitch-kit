/* ── Deterministic "smart mock" generator ──
   Produces ideas and build plans that vary by company keywords
   when no AI key is configured. */

import type {
  Idea,
  IdeaOutline,
  EffortLevel,
  BuildPlan,
  BuildStep,
  CompanyContext,
} from "./types";
import { EFFORT_LEVELS } from "./effort";

/* ── Seeded PRNG (simple but deterministic) ── */
function seedHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ── Template pool ── */
interface Tpl {
  title: string;
  summary: string;
  outline: IdeaOutline;
}

const POOL: Record<EffortLevel, Tpl[]> = {
  "15min": [
    {
      title: "{co} Status Page",
      summary: "A single-page status dashboard showing whether {co}'s key services are up, with coloured indicators and last-checked timestamps.",
      outline: { pages: ["Status page"], components: ["StatusIndicator", "EndpointRow", "LastUpdated"], data: ["Hardcoded endpoint list"], niceToHave: ["Auto-refresh every 30 s"] },
    },
    {
      title: "{co} Changelog",
      summary: "A clean timeline displaying {co}'s recent updates and version releases in reverse chronological order.",
      outline: { pages: ["Changelog page"], components: ["TimelineEntry", "VersionBadge"], data: ["Static JSON entries"], niceToHave: ["RSS feed output"] },
    },
    {
      title: "{co} Feature Vote Board",
      summary: "A lightweight feature-request board where visitors can submit and upvote ideas for {co}.",
      outline: { pages: ["Vote board"], components: ["FeatureCard", "VoteButton", "SubmitForm"], data: ["In-memory feature list"], niceToHave: ["Sort by votes"] },
    },
    {
      title: "{co} FAQ Chat Widget",
      summary: "A chat-like FAQ widget that matches visitor questions against {co}'s most common queries and returns instant answers.",
      outline: { pages: ["Chat widget overlay"], components: ["ChatBubble", "MatchResult", "SearchInput"], data: ["FAQ entries JSON"], niceToHave: ["Fuzzy matching"] },
    },
    {
      title: "{co} Team Directory",
      summary: "A responsive grid of {co} team members with photos, titles, and social links.",
      outline: { pages: ["Team page"], components: ["MemberCard", "FilterBar"], data: ["Team JSON file"], niceToHave: ["Department filter"] },
    },
    {
      title: "{co} Pricing Snapshot",
      summary: "A side-by-side comparison of {co}'s pricing tiers with feature checkmarks and a highlighted recommended plan.",
      outline: { pages: ["Pricing page"], components: ["TierColumn", "FeatureRow", "CTAButton"], data: ["Pricing tiers JSON"], niceToHave: ["Monthly/annual toggle"] },
    },
    {
      title: "{co} Social Proof Wall",
      summary: "A masonry grid of customer testimonials, tweets, and logos showing real-world love for {co}.",
      outline: { pages: ["Testimonials page"], components: ["TestimonialCard", "LogoStrip"], data: ["Testimonials JSON"], niceToHave: ["Animated entrance"] },
    },
    {
      title: "{co} Wait-List Landing",
      summary: "A single-screen email-capture page with countdown timer for {co}'s upcoming launch.",
      outline: { pages: ["Landing page"], components: ["EmailForm", "CountdownTimer", "HeroBanner"], data: ["Launch date config"], niceToHave: ["Confetti on submit"] },
    },
  ],

  "1hr": [
    {
      title: "{co} Integration Finder",
      summary: "A searchable, filterable directory of integrations and plugins available for {co}, grouped by category.",
      outline: { pages: ["Directory page", "Detail page"], components: ["SearchBar", "FilterSidebar", "IntegrationCard", "CategoryTags"], data: ["Integrations JSON catalog"], niceToHave: ["Install-count badges"] },
    },
    {
      title: "{co} Onboarding Wizard",
      summary: "A step-by-step interactive setup flow that walks new {co} users through account configuration with progress tracking.",
      outline: { pages: ["Multi-step wizard"], components: ["StepIndicator", "ConfigForm", "ProgressBar", "SuccessScreen"], data: ["Steps config"], niceToHave: ["Skip option", "Video tips"] },
    },
    {
      title: "{co} Knowledge Base",
      summary: "A searchable help centre for {co} with categorised articles, breadcrumb navigation, and keyword highlighting.",
      outline: { pages: ["Home", "Category", "Article"], components: ["SearchBar", "ArticleCard", "Breadcrumbs", "TableOfContents"], data: ["Articles in markdown or JSON"], niceToHave: ["Full-text search", "Helpful vote"] },
    },
    {
      title: "{co} Event Calendar",
      summary: "An interactive calendar listing {co}'s upcoming webinars, launches, and meetups with RSVP functionality.",
      outline: { pages: ["Calendar view", "Event detail"], components: ["CalendarGrid", "EventCard", "RSVPButton"], data: ["Events JSON"], niceToHave: ["Add-to-calendar link"] },
    },
    {
      title: "{co} Case Study Viewer",
      summary: "A polished showcase of {co} customer success stories with metrics, quotes, and industry tags.",
      outline: { pages: ["Gallery page", "Case-study detail"], components: ["CaseCard", "MetricsBar", "QuoteBlock", "IndustryFilter"], data: ["Case studies JSON"], niceToHave: ["PDF export"] },
    },
    {
      title: "{co} Competitive Matrix",
      summary: "An interactive comparison chart that maps {co} against top competitors across features, pricing, and reviews.",
      outline: { pages: ["Comparison page"], components: ["MatrixTable", "FeatureToggle", "ScoreBadge", "Tooltip"], data: ["Competitor data JSON"], niceToHave: ["User-submitted ratings"] },
    },
    {
      title: "{co} Resource Hub",
      summary: "A curated library of {co} guides, templates, eBooks, and videos with search and category filtering.",
      outline: { pages: ["Hub page", "Resource detail"], components: ["ResourceCard", "TypeFilter", "DownloadButton"], data: ["Resources JSON"], niceToHave: ["View count", "Bookmarks"] },
    },
    {
      title: "{co} Job Board",
      summary: "A filterable listing of open positions at {co} with department tags, location badges, and apply links.",
      outline: { pages: ["Listings page", "Job detail"], components: ["JobCard", "DeptFilter", "LocationBadge", "ApplyButton"], data: ["Jobs JSON"], niceToHave: ["Search", "Remote tag"] },
    },
  ],

  "4hr": [
    {
      title: "{co} ROI Calculator",
      summary: "An interactive tool that helps prospects estimate time and cost savings of switching to {co}, with shareable result pages.",
      outline: { pages: ["Calculator", "Results", "Share"], components: ["SliderInput", "ResultChart", "ComparisonTable", "ShareButton"], data: ["Pricing tiers", "Industry benchmarks"], niceToHave: ["PDF export", "Email results"] },
    },
    {
      title: "{co} Developer Portal",
      summary: "A documentation-style portal for {co}'s API ecosystem with guides, code samples, and an interactive playground.",
      outline: { pages: ["Home", "Getting Started", "API Reference", "Playground"], components: ["Sidebar", "CodeBlock", "CopyButton", "ResponseViewer"], data: ["Markdown docs", "Endpoint catalog"], niceToHave: ["Dark mode", "cURL export"] },
    },
    {
      title: "{co} Interactive Demo",
      summary: "A guided product-tour simulation that walks prospects through {co}'s core workflows using annotated screenshots and tooltips.",
      outline: { pages: ["Tour launcher", "Step view", "Summary"], components: ["TourStep", "Tooltip", "ProgressDots", "CTAOverlay"], data: ["Tour steps JSON", "Screenshot assets"], niceToHave: ["Branching paths", "Analytics"] },
    },
    {
      title: "{co} Analytics Dashboard",
      summary: "A metrics dashboard for {co} users showing key performance indicators, trend charts, and exportable reports.",
      outline: { pages: ["Dashboard", "Detail drilldown"], components: ["MetricCard", "LineChart", "BarChart", "DatePicker", "ExportButton"], data: ["Mock time-series data"], niceToHave: ["Real-time updates", "Custom date ranges"] },
    },
    {
      title: "{co} Solution Finder",
      summary: "A guided questionnaire that helps visitors discover which {co} product or plan best matches their needs.",
      outline: { pages: ["Quiz flow", "Recommendation page"], components: ["QuestionCard", "OptionButton", "ProgressBar", "RecommendationCard"], data: ["Questions & scoring logic"], niceToHave: ["Email results", "Comparison"] },
    },
    {
      title: "{co} Migration Planner",
      summary: "A step-by-step migration tool that walks users through moving from a competitor to {co} with checklists and progress tracking.",
      outline: { pages: ["Overview", "Checklist", "Completion"], components: ["StepChecklist", "StatusBadge", "ProgressRing", "HelpTip"], data: ["Migration steps config"], niceToHave: ["Estimated time per step", "Rollback guide"] },
    },
    {
      title: "{co} Benchmark Tool",
      summary: "A benchmarking app that lets {co} users compare their metrics against industry averages and peer groups.",
      outline: { pages: ["Input form", "Results dashboard"], components: ["InputForm", "GaugeChart", "ComparisonBar", "PeerSelector"], data: ["Industry benchmarks JSON"], niceToHave: ["Historical tracking", "Share link"] },
    },
    {
      title: "{co} Referral Portal",
      summary: "A referral tracking portal where {co} users can invite contacts, monitor status, and earn rewards.",
      outline: { pages: ["Dashboard", "Invite page", "Rewards"], components: ["ReferralLink", "StatusTracker", "RewardCard", "LeaderBoard"], data: ["Referral rules config"], niceToHave: ["Social share buttons", "Email templates"] },
    },
  ],

  "8hr": [
    {
      title: "{co} Customer Portal",
      summary: "A self-service portal where {co} customers manage accounts, view billing, submit support tickets, and browse a knowledge base.",
      outline: { pages: ["Dashboard", "Billing", "Tickets", "Settings", "KB"], components: ["AccountCard", "InvoiceTable", "TicketForm", "TicketList", "ArticleViewer"], data: ["Mock account data", "Invoice history"], niceToHave: ["Live chat widget", "Usage graphs"] },
    },
    {
      title: "{co} Workflow Builder",
      summary: "A visual automation builder where {co} users create custom workflow rules with a drag-and-drop canvas and node editor.",
      outline: { pages: ["Workflow list", "Canvas", "Run history", "Templates"], components: ["DragDropCanvas", "NodeCard", "ConnectionLine", "PropertiesPanel"], data: ["Node types catalog", "Template workflows"], niceToHave: ["Conditional logic", "Webhook triggers"] },
    },
    {
      title: "{co} Learning Path",
      summary: "An interactive, multi-module learning experience that helps users master {co} features through lessons, quizzes, and badges.",
      outline: { pages: ["Course list", "Module view", "Quiz", "Progress dashboard"], components: ["ModuleCard", "LessonPlayer", "QuizEngine", "BadgeDisplay"], data: ["Course content JSON", "Quiz questions"], niceToHave: ["Completion certificate", "Streak tracking"] },
    },
    {
      title: "{co} Support Center",
      summary: "A full support hub for {co} with ticket submission, live status tracking, priority escalation, and satisfaction surveys.",
      outline: { pages: ["Submit ticket", "My tickets", "Ticket detail", "CSAT"], components: ["TicketForm", "StatusTimeline", "PriorityBadge", "SurveyForm"], data: ["Ticket categories", "Priority rules"], niceToHave: ["SLA indicators", "Auto-replies"] },
    },
    {
      title: "{co} Dashboard Builder",
      summary: "A customisable dashboard where {co} users arrange widgets (charts, tables, KPIs) via drag-and-drop to create their perfect view.",
      outline: { pages: ["Dashboard", "Widget library", "Settings"], components: ["WidgetGrid", "WidgetCard", "ChartWidget", "TableWidget", "DragHandle"], data: ["Widget definitions", "Mock data sources"], niceToHave: ["Dashboard templates", "Share/export"] },
    },
    {
      title: "{co} Reporting Tool",
      summary: "A report-generation tool that lets {co} users build custom reports by selecting metrics, filters, date ranges, and export formats.",
      outline: { pages: ["Report builder", "Report viewer", "Saved reports"], components: ["MetricSelector", "FilterBar", "DateRangePicker", "ReportPreview", "ExportButton"], data: ["Metrics catalog", "Mock data sets"], niceToHave: ["Scheduled reports", "PDF/CSV export"] },
    },
    {
      title: "{co} Feedback Analytics",
      summary: "An insights dashboard that aggregates, categorises, and visualises customer feedback for {co} across multiple channels.",
      outline: { pages: ["Overview", "Sentiment view", "Topic drilldown", "Raw feed"], components: ["SentimentChart", "TopicCloud", "FeedbackCard", "TrendLine"], data: ["Mock feedback entries"], niceToHave: ["AI sentiment labels", "Export"] },
    },
    {
      title: "{co} Campaign Manager",
      summary: "A marketing-campaign planner where {co} teams create, schedule, and track campaigns across email, social, and web channels.",
      outline: { pages: ["Campaign list", "Builder", "Calendar", "Analytics"], components: ["CampaignCard", "ChannelPicker", "CalendarView", "MetricsRow"], data: ["Campaign templates", "Channel config"], niceToHave: ["A/B test setup", "Budget tracker"] },
    },
  ],

  "1-3days": [
    {
      title: "{co} Community Hub",
      summary: "A full community platform for {co} users to ask questions, share projects, earn reputation, and connect with power users.",
      outline: { pages: ["Feed", "Question detail", "Showcase", "Profiles", "Tags"], components: ["PostCard", "AnswerThread", "VoteButtons", "TagCloud", "UserBadge"], data: ["Posts", "Users", "Tags/topics"], niceToHave: ["Notifications", "Markdown editor", "Image uploads"] },
    },
    {
      title: "{co} Learning Academy",
      summary: "A course platform with structured curricula, video lessons, quizzes, and completion certificates for mastering {co}.",
      outline: { pages: ["Catalog", "Course detail", "Lesson", "Quiz", "Certificate", "Dashboard"], components: ["CourseCard", "VideoPlayer", "QuizEngine", "CertificateView", "ProgressTracker"], data: ["Courses", "Quizzes", "Progress state"], niceToHave: ["Discussion forum", "Leaderboard"] },
    },
    {
      title: "{co} Marketplace",
      summary: "A plugin marketplace where third-party developers list, sell, and manage extensions for {co} with ratings and reviews.",
      outline: { pages: ["Browse", "Category", "Plugin detail", "Publisher dashboard", "Review page"], components: ["PluginCard", "RatingStars", "ReviewForm", "InstallButton", "PublisherProfile"], data: ["Plugin catalog", "Reviews", "Install stats"], niceToHave: ["Payment flow", "Version management"] },
    },
    {
      title: "{co} CRM Lite",
      summary: "A lightweight customer relationship manager built around {co}'s workflow — contact management, deal pipeline, and activity logs.",
      outline: { pages: ["Contacts", "Pipeline board", "Contact detail", "Activity log", "Settings"], components: ["ContactCard", "KanbanColumn", "DealCard", "ActivityFeed", "FilterBar"], data: ["Contacts", "Deals", "Activity events"], niceToHave: ["Email integration", "Import/export CSV"] },
    },
    {
      title: "{co} Project Tracker",
      summary: "A Kanban-style project management app tailored for {co} teams with boards, cards, deadlines, and team assignment.",
      outline: { pages: ["Board view", "List view", "Card detail", "Team", "Settings"], components: ["KanbanBoard", "TaskCard", "AssigneePicker", "DueDate", "CommentThread"], data: ["Projects", "Tasks", "Team members"], niceToHave: ["Calendar view", "Notifications", "File attachments"] },
    },
    {
      title: "{co} Event Platform",
      summary: "An event-management app for {co}-hosted events with registration, ticketing, schedule builder, and attendee networking.",
      outline: { pages: ["Event list", "Event detail", "Registration", "Schedule", "Networking"], components: ["EventHero", "RegistrationForm", "SessionCard", "AttendeeCard", "ScheduleTimeline"], data: ["Events", "Sessions", "Attendees"], niceToHave: ["QR check-in", "Live Q&A", "Sponsor slots"] },
    },
    {
      title: "{co} Survey Builder",
      summary: "A survey creation and analysis tool for {co} to collect structured feedback, with branching logic and real-time result charts.",
      outline: { pages: ["Builder", "Preview", "Share", "Results dashboard"], components: ["QuestionEditor", "BranchingLogic", "SurveyPreview", "ResultsChart", "ResponseTable"], data: ["Survey definitions", "Responses"], niceToHave: ["Logic jumps", "Export data", "Templates"] },
    },
    {
      title: "{co} Admin Console",
      summary: "A comprehensive admin panel for {co} with user management, role-based access, audit logs, and configuration controls.",
      outline: { pages: ["Dashboard", "Users", "Roles", "Audit log", "Settings", "Integrations"], components: ["DataTable", "UserForm", "RoleEditor", "AuditRow", "ConfigToggle"], data: ["Users", "Roles", "Audit events", "Settings"], niceToHave: ["Bulk actions", "2FA management", "API key management"] },
    },
  ],
};

/* ── Public: generate ideas ── */

export function generateMockIdeas(
  jobId: string,
  context: CompanyContext
): Idea[] {
  const co = context.name || "Acme";
  const seed = seedHash(co.toLowerCase());
  const ideas: Idea[] = [];

  for (const lvl of EFFORT_LEVELS) {
    const pool = POOL[lvl.key];
    const shuffled = seededShuffle(pool, seed + lvl.order);
    for (let i = 0; i < 3; i++) {
      const tpl = shuffled[i % shuffled.length];
      ideas.push({
        id: `${jobId}-${ideas.length}`,
        jobId,
        title: tpl.title.replace(/\{co\}/g, co),
        summary: tpl.summary.replace(/\{co\}/g, co),
        effort: lvl.key,
        outline: tpl.outline,
      });
    }
  }
  return ideas;
}

/* ── Public: generate build plan ── */

function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function buildFolderName(companyName: string, ideaTitle: string): string {
  const co = toSlug(companyName).slice(0, 20);
  const idea = toSlug(ideaTitle).slice(0, 25);
  return `v01-${co}-${idea}`;
}

function buildTerminalSetup(folderName: string): string {
  return [
    `cd ~/Desktop`,
    `mkdir -p cursor-prototypes && cd cursor-prototypes`,
    `mkdir ${folderName} && cd ${folderName}`,
    `npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm`,
    `npm run dev`,
  ].join("\n");
}

/** Return the target prompt count for a given effort level. */
function promptCountForEffort(effort: EffortLevel): number {
  switch (effort) {
    case "15min": return 2;
    case "1hr": return 4;
    case "4hr": return 6;
    case "8hr": return 7;
    case "1-3days": return 10;
  }
}

export function generateMockBuildPlan(idea: Idea, companyName?: string): BuildPlan {
  const o = idea.outline;
  const name = idea.title;
  const co = companyName || name.split(" ")[0];
  const folderName = buildFolderName(co, name);
  const count = promptCountForEffort(idea.effort);

  const steps: BuildStep[] = [];

  /* ── Prompt 1: PM+UX — Brand + skeleton (always present) ── */
  steps.push({
    title: "Set up the branded page skeleton",
    role: "PM+UX",
    instruction: `Create the branded page skeleton for "${name}" with header, hero, placeholder sections, and TODO markers.`,
    cursorPrompt: [
      `BMAD ROLE: PM+UX — Create the branded page skeleton with layout, CSS variables, and TODO markers. Do not implement real features yet.`,
      ``,
      `Prototype: "${name}"`,
      `${idea.summary}`,
      ``,
      `Replace src/app/page.tsx with a "use client" page (TypeScript, Tailwind).`,
      ``,
      `Page structure:`,
      `1. Header — "${co}" + "Prototype" badge`,
      `2. Hero — "${name}" as h1, one-liner pitch`,
      `3. Main section — placeholder cards for:`,
      ...o.pages.map((p) => `   • ${p}`),
      `   Mark each with {/* TODO: implement */} comments`,
      `4. Primary CTA button + secondary ghost button`,
      `5. Footer — "Built with Amuse Bouchenator"`,
      ``,
      `Styling:`,
      `- Wrap in a <div> with CSS vars: --ab-primary, --ab-accent, --ab-bg, --ab-text, --ab-font`,
      `- Buttons: bg var(--ab-primary), border-radius 12px`,
      `- Cards: border-radius 12px, hover ring var(--ab-accent)`,
      ``,
      `Stub components: ${o.components.slice(0, 5).join(", ")}`,
      `Define TypeScript interfaces for: ${o.data.join(", ")}`,
      ``,
      `Do NOT implement real logic. Just the skeleton + TODOs.`,
    ].join("\n"),
    doneLooksLike: [
      `• localhost:3000 renders with header, hero, placeholder cards`,
      `• CSS var wrapper present, buttons/cards use var(--ab-primary)`,
      `• TODO markers visible in code for each section`,
    ].join("\n"),
  });

  /* ── Middle prompts: FE — Build features (variable count) ── */
  const feCount = Math.max(1, count - 2);
  const componentChunks = chunkArray(o.components, feCount);

  for (let i = 0; i < feCount; i++) {
    const comps = componentChunks[i] || o.components.slice(0, 2);
    const isLast = i === feCount - 1;
    steps.push({
      title: feCount === 1
        ? "Build the core features"
        : `Build features — part ${i + 1} of ${feCount}`,
      role: "FE",
      instruction: `Implement ${comps.join(", ")} with real data and interaction.`,
      cursorPrompt: [
        `BMAD ROLE: FE — Implement real interaction and data wiring. Keep it simple and demo-safe.`,
        ``,
        `In src/app/page.tsx, replace the TODO markers for these components with working code:`,
        ...comps.map((c) => `  - ${c}: implement with typed props and real inline data`),
        ``,
        `Requirements:`,
        `- Wire inline data so lists/cards show real content`,
        `- Buttons trigger visible state changes`,
        `- Use existing CSS vars (--ab-primary, --ab-accent)`,
        `- Keep it responsive (mobile-first Tailwind)`,
        isLast && o.niceToHave.length
          ? `- Nice-to-have (only if quick): ${o.niceToHave.join(", ")}`
          : ``,
        ``,
        `No external APIs. No new UI libraries.`,
      ].filter(Boolean).join("\n"),
      doneLooksLike: [
        `• ${comps[0] || "Component"} renders with real data`,
        `• Clicking buttons triggers visible feedback`,
        `• No console errors`,
      ].join("\n"),
    });
  }

  /* ── Last prompt: FE+QA — Fix + polish (always present) ── */
  steps.push({
    title: "Fix errors and add polish",
    role: "FE+QA",
    instruction: `Fix any errors, add empty state, tighten spacing, and add one microinteraction to "${name}".`,
    cursorPrompt: [
      `BMAD ROLE: FE+QA — Fix errors, tighten polish, and add one microinteraction. No new libraries.`,
      ``,
      `Review src/app/page.tsx and any supporting files:`,
      ``,
      `1. Fix any TypeScript or ESLint errors`,
      `2. Fix any runtime/console errors`,
      `3. Add empty state for lists with no data ("Nothing here yet")`,
      `4. Tighten spacing: consistent padding, no awkward gaps`,
      `5. Add one microinteraction: hover:scale-[1.02] on cards or a fade-in entrance`,
      ``,
      `Do NOT add new npm packages. Just polish what exists.`,
    ].join("\n"),
    doneLooksLike: [
      `• npx tsc --noEmit passes clean`,
      `• No console errors at runtime`,
      `• One visible micro-animation on hover or entrance`,
    ].join("\n"),
  });

  return {
    ideaId: idea.id,
    bmadExplanation: "",
    terminalSetup: buildTerminalSetup(folderName),
    folderName,
    steps,
  };
}

/** Split an array into N roughly equal chunks. */
function chunkArray<T>(arr: T[], n: number): T[][] {
  if (n <= 0) return [arr];
  const result: T[][] = [];
  const size = Math.ceil(arr.length / n);
  for (let i = 0; i < n; i++) {
    result.push(arr.slice(i * size, (i + 1) * size));
  }
  return result;
}

/* ── Public: custom idea mock ── */

export function generateMockCustomPlan(
  text: string,
  companyName: string
): { idea: Idea; plan: BuildPlan } {
  const idea: Idea = {
    id: `custom-${seedHash(text)}`,
    jobId: "custom",
    title: text.length > 60 ? text.slice(0, 57) + "..." : text,
    summary: text,
    effort: text.length < 80 ? "1hr" : text.length < 200 ? "4hr" : "8hr",
    outline: {
      pages: ["Main page", "Detail page"],
      components: ["Hero", "ContentCard", "ActionButton"],
      data: ["In-memory mock data"],
      niceToHave: ["Dark mode", "Share link"],
    },
  };

  return {
    idea,
    plan: generateMockBuildPlan(
      { ...idea, title: `${companyName} — ${idea.title}` },
      companyName
    ),
  };
}
