# Deploying the website

The website has two parts:

| Part | What it is | Where it runs |
|---|---|---|
| **Backend** | `api/server.py`: accounts, database, optimiser runs | **Render** (a server that keeps running) |
| **Website** | `frontend/`: the pages people open | **Vercel** and/or **GitHub Pages** (static hosting) |

Vercel's Python functions and GitHub Pages cannot run the backend: it keeps a SQLite database on disk and runs the
optimiser as a background job, which serverless and static hosts do not support.

Settings used by the code:

| Setting | Where | Meaning |
|---|---|---|
| `CLOCKWORK_ADMIN_PASSWORD` | Render | Password of the first `admin` account (the database starts empty). Without it the password would be `admin`. |
| `CLOCKWORK_ALLOWED_ORIGINS` | Render | The website addresses allowed to call the backend, comma-separated, **origin only** (no path), e.g. `https://krisharmaa.github.io,https://clockwork.vercel.app` |
| `VITE_API_URL` | Vercel / GitHub (`CLOCKWORK_API_URL` variable) | The backend's address, e.g. `https://clockwork-api.onrender.com`, used when the website is built |
| `VITE_BASE` | set by the Pages workflow | `/<repository>/`, because GitHub Pages serves the site under that path |

## Steps (about 15 minutes)

### 1. Put the code on your fork's `main`
GitHub Pages only deploys from the default branch. On GitHub, open a pull request **in your fork**
(`krisharmaa/...`: base `main` ← compare `timetable-manager`) and merge it.

### 2. Backend on Render
1. Sign in at <https://render.com> with your GitHub account.
2. **New → Blueprint**, choose your fork. Render reads `render.yaml`.
3. When asked:
   - `CLOCKWORK_ADMIN_PASSWORD`: a strong password (you will sign in as `admin` with it);
   - `CLOCKWORK_ALLOWED_ORIGINS`: `https://krisharmaa.github.io` for now (the Vercel address is added in step 5).
4. **Apply / Deploy**. When it is live, copy the service address, e.g. `https://clockwork-api.onrender.com`, and check
   that `<address>/api/health` shows `{"ok": true, ...}`.

### 3. Website on GitHub Pages
1. In your fork: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   name `CLOCKWORK_API_URL`, value = the Render address from step 2 (no trailing slash).
3. **Actions → "Deploy website to GitHub Pages" → Run workflow** (branch `main`).
4. The site is at `https://krisharmaa.github.io/Optimization-Project-OT-BY-AKSHAT-MANAV-KRISH-PARTH/`.
   Later pushes to `main` that change `frontend/` redeploy it automatically.

### 4. Website on Vercel
1. **Add New → Project**, import your fork.
2. **Root Directory: `frontend`**. Framework: Vite (build `npm run build`, output `dist`).
3. **Environment Variables**: `VITE_API_URL` = the Render address.
4. **Deploy**, then copy the address, e.g. `https://your-project.vercel.app`.
   (If you change `VITE_API_URL` later, redeploy: it is read at build time.)

### 5. Allow both websites on the backend
Render → your service → **Environment** → set `CLOCKWORK_ALLOWED_ORIGINS` to
`https://krisharmaa.github.io,https://your-project.vercel.app` → **Save** (the service restarts).

### 6. Use it
Open either website, sign in as `admin` with your password, and create accounts under **Manage** as usual.

## Things to know
- **Free Render services sleep** after about 15 minutes without visitors; the first request then takes up to a minute.
- **Data on the free plan is not permanent**: the database (accounts, saved timetables, publishes) is reset when the
  service restarts or redeploys. For a permanent database, add a Render disk (paid), mount it at `/var/data` and set
  `CLOCKWORK_DB=/var/data/clockwork.db`.
- Everything in the demo data is synthetic. Do not put real student data on a public demo without your institution's
  permission.
- Troubleshooting: if sign-in fails with a network error, check that the website's address is in
  `CLOCKWORK_ALLOWED_ORIGINS` exactly (scheme + host, no path, no trailing slash) and that `VITE_API_URL` points at the
  Render address.
