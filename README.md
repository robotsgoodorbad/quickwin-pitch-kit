# Amuse Bouchenator

A taster-menu generator for quick-win prototypes — with Cursor-ready build steps.

Enter any company name or website and get 15 prototype ideas (3 per effort level: 15 min, 1 hr, 4 hr, 8 hr, 1–3 days). Click any idea to see a detailed build outline and generate step-by-step Cursor AI prompts.

## How to Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

All env vars go in `.env.local` at the project root (git-ignored). **Restart the dev server after editing.**

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | No | Enables AI-generated ideas via GPT-4o-mini |
| `GEMINI_API_KEY` | No | Fallback AI provider (Gemini 2.0 Flash) |
| `PRODUCT_HUNT_TOKEN` | No | Fetches trending PH products for inspiration |
| `PRODUCT_HUNT_API_KEY` | No | Product Hunt API key (not currently used in queries) |
| `PRODUCT_HUNT_API_SECRET` | No | Product Hunt API secret (not currently used in queries) |

### What works without keys

- **No AI keys**: The app uses a deterministic "smart mock" generator that produces company-specific ideas based on keyword analysis. Ideas vary by company name.
- **No Product Hunt token**: The "Checking Product Hunt" step is marked as skipped and the app continues normally.
- **All integrations are best-effort**: If a website can't be fetched, news can't be found, or any external call fails, the step is marked "skipped" and analysis continues.

### Verify env setup

Visit [http://localhost:3000/api/debug/env](http://localhost:3000/api/debug/env) to confirm `hasProductHuntToken: true`.

## Architecture

```
src/
├── app/
│   ├── page.tsx                          # Homepage (input → progress → results)
│   ├── idea/[ideaId]/page.tsx            # Idea detail + build steps
│   ├── api/
│   │   ├── analyze/route.ts              # POST: start analysis job
│   │   ├── jobs/[jobId]/route.ts         # GET: poll job status
│   │   ├── idea/[ideaId]/route.ts        # GET: fetch single idea
│   │   ├── idea/[ideaId]/steps/route.ts  # POST: generate build steps
│   │   ├── custom-idea/route.ts          # POST: custom idea builder
│   │   ├── inspiration/producthunt/      # GET: trending PH products
│   │   └── debug/env/route.ts            # GET: verify env vars
├── components/
│   ├── HomePage.tsx                      # Main homepage client component
│   └── IdeaDetailView.tsx                # Detail page client component
├── lib/
│   ├── types.ts                          # Shared TypeScript types
│   ├── effort.ts                         # Effort level definitions
│   ├── jobStore.ts                       # In-memory Map store (no DB)
│   ├── disambiguate.ts                   # Company name disambiguation
│   ├── siteFetch.ts                      # Website scraping utilities
│   ├── producthunt.ts                    # PH GraphQL + 10-min cache
│   ├── ai.ts                             # OpenAI/Gemini wrapper + fallback
│   ├── mockGenerator.ts                  # Deterministic idea/plan generator
│   └── analyzer.ts                       # Analysis step orchestrator
```

## Known Limitations

- **In-memory store**: All data (jobs, ideas, build plans) lives in a `Map` in server memory. Data is lost on server restart. This is intentional for demo reliability.
- **Site scraping**: Uses regex-based HTML parsing (no cheerio/DOM parser). Works for most sites but may miss content behind JS rendering.
- **External news**: Only attempts RSS feed discovery on the target site. No external news API.
- **Rate limits**: Product Hunt API may rate-limit with frequent restarts. Results are cached for 10 minutes.
- **Single-server**: The in-memory store means this won't work across multiple server instances.
