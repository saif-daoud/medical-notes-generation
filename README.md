# Sakina SOAP Expert Feedback

Local-first expert preference website for comparing anonymized SOAP JSON outputs from `sakinaai/out`.

## Local frontend

```bash
npm install
npm run dev
```

The app generates `public/data/study-data.json` before starting Vite when `sakinaai/out` is available. On GitHub Actions it reuses the committed anonymized `study-data.json`. Served study data removes model/provider metadata and exposes outputs only as `Output A`, `Output B`, etc.

## Cloudflare D1 API

The frontend works without a backend by saving responses in browser storage. To sync to Cloudflare later:

1. Create a D1 database.
2. Replace `database_id` in `worker/wrangler.toml`.
3. Set a Worker secret:

```bash
npx wrangler secret put TOKEN_SECRET
```

4. Apply migrations and deploy:

```bash
npm --prefix worker install
npm run worker:migrate:remote
npm run worker:deploy
```

5. Build the frontend with the deployed Worker URL:

```bash
VITE_API_BASE="https://your-worker.your-subdomain.workers.dev" npm run build
```

For GitHub Pages, set `VITE_BASE_PATH` to the repository path when building, for example:

```bash
VITE_BASE_PATH="/sakina-expert-feedback/" npm run build
```
