# Swaranbhumi Enterprise Real Estate CRM

A production-ready decoupled desktop application and REST API system designed to manage real estate leads, properties booking invoices, Meta Lead Ads integration, and employee performance tracking.

---

## Technical Architecture

The system consists of two main decoupled modules:
1. **Backend Server (`backend/`)**: Fastify REST API with WebSockets for real-time synchronization, Prisma ORM targeting PostgreSQL, Rate Limiting, JWT + Refresh session management, and AES-256-GCM settings encryption.
2. **Desktop Application (`desktop/`)**: Electron wrapper running a Vite + React 19 + TypeScript SPA, featuring state management via Zustand, UI micro-animations with Framer Motion, analytics graphs with Recharts, and native desktop notifications.

---

## Project Structure

```
crm_swarnbhumi/
├── backend/                  # Fastify REST API, DB, and WebSockets
│   ├── prisma/               # Schema and database seed scripts
│   ├── src/                  # Source files
│   └── Dockerfile            # Production Dockerfile
├── desktop/                  # Electron + React Application
│   ├── src/
│   │   ├── main/             # Electron main processes
│   │   ├── preload/          # Electron Context Isolation preload
│   │   └── renderer/         # React 19 Frontend SPA
│   ├── tsconfig.json
│   └── package.json
└── README.md                 # Setup & Deployment Guide
```

---

## Quick Start Guide

### Prerequisites
- [Node.js v20+](https://nodejs.org/)
- [Docker Desktop](https://www.docker.com/) (for PostgreSQL database)

---

### Step 1: Initialize Database & Services
Spin up the local PostgreSQL database:
```bash
cd backend
docker-compose up -d
```

### Step 2: Configure Environment Variables
Inside `backend/` directory, verify that the `.env` configuration contains:
```env
PORT=5000
DATABASE_URL="postgresql://postgres:crmpassword@localhost:5432/swaranbhumi_crm?schema=public"
JWT_SECRET="swaranbhumi_super_secret_jwt_access_token_key_2026_xyz"
JWT_REFRESH_SECRET="swaranbhumi_super_secret_jwt_refresh_token_key_2026_abc"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
DEFAULT_VERIFY_TOKEN="swaranbhumi_meta_verify_token"
```

### Step 3: Run Database Migrations & Seed
Run Prisma migrations to create the database schema, generate Client bindings, and seed initial users and leads:
```bash
# Generate Client bindings
npx prisma generate

# Execute Migrations
npx prisma migrate dev --name init

# Seed database with sample sales executives & demo leads
npm run prisma:seed
```

### Step 4: Launch Backend Server
Start the Fastify API server in development mode:
```bash
npm run dev
```
*Server runs on `http://localhost:5000` with WebSockets accessible at `ws://localhost:5000/ws`.*

---

### Step 5: Start Desktop Application
In a separate terminal tab, enter the desktop folder and start Vite + Electron:
```bash
cd desktop
npm install
npm run dev
```

---

## Meta Facebook Lead Ads Integration

### Setup Webhook Subscriptions
1. Log into the [Facebook Developer Console](https://developers.facebook.com/).
2. Setup Webhook subscriptions for your App, point the Webhook Endpoint URL to:
   `https://<your-public-domain>/meta/webhook`
3. Configure the **Verify Token** matching the database settings (default: `swaranbhumi_meta_verify_token`).
4. Subscribe to the `leadgen` field feed under the page object parameters.

### Local Webhook Testing (Tunnel)
To test webhook subscriptions locally:
1. Run a tunnel (e.g., [ngrok](https://ngrok.com/)):
   ```bash
   ngrok http 5000
   ```
2. Copy the secure HTTPS URL provided by ngrok and use it as the Callback URL in the Meta developer portal.
3. Test using Meta's **Lead Ads RTU Debugging Tool** to send mock JSON payloads to your webhook endpoint.

---

## Packaging the App (.exe Installer)
To compile and package the Electron app into a standalone Windows installer (`.exe`), run:
```bash
cd desktop
npm run package
```
*The installer will be generated in `desktop/release/`.*

---

## Production Security Checklist
- [ ] **Rotate JWT Keys**: Modify `JWT_SECRET` and `JWT_REFRESH_SECRET` in the production environment.
- [ ] **Rotate Encryption Key**: Set a custom 32-byte hex key for `ENCRYPTION_KEY`.
- [ ] **Change Default Passwords**: Ensure seeded passwords (`admin123`, `executive123`) are modified on deployment.
- [ ] **Tighten CORS Configurations**: Limit backend CORS origins to production environments.
