# Coolify Deployment Guide

## Overview
This guide helps you deploy the Coffee Office web application to Coolify.

## Prerequisites
- Coolify instance running (self-hosted or managed)
- External PostgreSQL database URL
- Midtrans account with Server & Client keys

## Deployment Steps

### 1. Prepare Your Environment Variables

Create the following environment variables in Coolify:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ Yes | Your external PostgreSQL connection string (e.g., Neon, Supabase, AWS RDS) |
| `MIDTRANS_SERVER_KEY` | ✅ Yes | Midtrans Server Key from dashboard |
| `MIDTRANS_CLIENT_KEY` | ✅ Yes | Midtrans Client Key from dashboard |
| `MIDTRANS_IS_PRODUCTION` | ✅ Yes | Set to `true` for production, `false` for sandbox |
| `GEMINI_API_KEY` | ⚪ Optional | Google Gemini API key (if using AI features) |
| `NODE_ENV` | ✅ Auto | Set to `production` by Coolify |

### 2. Coolify Configuration

#### Option A: Deploy via Git Repository (Recommended)

1. In Coolify Dashboard, click **Create New Resource**
2. Select **Application**
3. Choose **Git Repository**
4. Enter your repository URL
5. Set **Build Pack** to `Dockerfile`
6. Coolify will auto-detect the `Dockerfile`
7. Configure the environment variables above
8. Deploy!

#### Option B: Deploy via Docker Compose

1. In Coolify Dashboard, click **Create New Resource**
2. Select **Docker Compose**
3. Paste the contents of `docker-compose.yml`
4. Configure environment variables in Coolify UI
5. Deploy!

### 3. Health Check

The application includes a health check endpoint:
- **URL**: `http://your-domain/api/config`
- **Method**: GET
- **Expected**: Returns JSON with clientKey and isProduction status

### 4. Database Setup

Since your database is external, ensure:
1. Your database is accessible from Coolify's network
2. Connection string is correct
3. Database schema is initialized (run migrations if needed):
   ```bash
   # Local migration (before deploy)
   npm run db:push
   ```

### 5. Post-Deployment Verification

After deployment, verify these endpoints work:
- `GET /api/config` - Returns Midtrans config
- `GET /api/history` - Returns order history (requires DB)
- `GET /api/balance` - Returns balance (requires DB)

### 6. Troubleshooting

| Issue | Solution |
|-------|----------|
| Database connection fails | Check `DATABASE_URL` format and network access |
| Build fails | Ensure `npm ci` can complete (check lockfile) |
| Port issues | Coolify maps port 3000 automatically |
| Health check fails | Verify all env vars are set correctly |

## Architecture

```
┌─────────────┐      ┌──────────────┐      ┌─────────────────┐
│   Coolify   │──────▶   Web App    │──────▶  External DB   │
│  (Docker)   │      │  (Port 3000) │      │  (PostgreSQL)   │
└─────────────┘      └──────────────┘      └─────────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │   Midtrans   │
                     │    API       │
                     └──────────────┘
```

## Support

For Coolify-specific issues: https://coolify.io/docs/
For application issues: Check server logs in Coolify dashboard
