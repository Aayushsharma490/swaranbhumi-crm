# Swaranbhumi CRM - Production VPS Deployment Guide

This guide details the deployment of the containerized Swaranbhumi CRM REST/WebSocket cluster on an Ubuntu 24.04 LTS virtual private server (Hostinger VPS or Hetzner VPS), behind Nginx with automatic Let's Encrypt SSL.

---

## 1. Domain Mapping & Cloudflare DNS Setup

1. Log into your **Cloudflare Dashboard**.
2. Go to **DNS Records** for your target domain (e.g. `swaranbhumi.com`).
3. Add a new record:
   - **Type**: `A`
   - **Name**: `api` (resolving to `api.swaranbhumi.com`)
   - **IPv4 Address**: `YOUR_VPS_PUBLIC_IP`
   - **Proxy Status**: **DNS Only (Grey Cloud)**
     > [!IMPORTANT]
     > Keep Cloudflare proxy disabled during the initial Let's Encrypt HTTP validation check to prevent Nginx validation handshake errors. You can enable it (Orange Cloud) later once the certificates are generated.

---

## 2. Server Setup (Ubuntu 24.04)

SSH into your VPS and install package updates, Docker, and Git:
```bash
# Update Ubuntu package lists
sudo apt update && sudo apt upgrade -y

# Install Docker, Docker Compose, and Git
sudo apt install git docker.io docker-compose-v2 -y

# Start and enable Docker daemon
sudo systemctl start docker
sudo systemctl enable docker
```

---

## 3. Clone & Prepare CRM Files

Clone your code repository to `/var/www/` directory on the server:
```bash
# Create directory and clone
sudo mkdir -p /var/www/swaranbhumi-crm
sudo chown -R $USER:$USER /var/www/swaranbhumi-crm
cd /var/www/swaranbhumi-crm

# Clone or copy repository files
git clone <your-repo-link> .
```

Copy the environment configurations:
```bash
cp .env.production .env
```
Ensure all variables (`JWT_SECRET`, `ENCRYPTION_KEY`, `DEFAULT_VERIFY_TOKEN`) inside `.env` are configured securely.

---

## 4. Run Let's Encrypt SSL Handshake

Before booting the full secure cluster, you need to generate the SSL certificate:

1. **Start Nginx on Port 80** to allow Let's Encrypt validation:
   Modify Nginx temporary config or start Nginx mapping port 80 to answer the Certbot ACME challenge:
   ```bash
   # Spin up postgres, redis, and nginx container
   docker compose up -d postgres redis nginx
   ```
2. **Execute Certbot request**:
   ```bash
   docker compose run --rm certbot certonly --webroot --webroot-path=/var/www/certbot --email admin@swaranbhumi.com --agree-tos --no-eff-email -d api.swaranbhumi.com
   ```
3. Once completed successfully, the SSL keys will be generated and saved inside the mapped `certbot_etc` volume (`/etc/letsencrypt/live/api.swaranbhumi.com/`).

---

## 5. Boot Up the Cluster

1. Stop the temporary containers:
   ```bash
   docker compose down
   ```
2. Run the full orchestrator:
   ```bash
   docker compose up -d --build
   ```
3. Run Prisma Migrations and Seed the production database:
   ```bash
   # Apply database migrations
   docker exec -it crm-backend npx prisma migrate deploy

   # Seed default Admin and Executive profiles
   docker exec -it crm-backend npm run prisma:seed
   ```

---

## 6. Configure Meta Facebook Webhooks

1. Go to the [Facebook Developer Console](https://developers.facebook.com/) and navigate to your Meta App dashboard.
2. Under **Webhooks** product configuration:
   - Select **Page** from the dropdown menu and click **Configure a Webhook**.
   - **Callback URL**: `https://api.swaranbhumi.com/meta/webhook`
   - **Verify Token**: `swaranbhumi_production_meta_verify_token_9900` (matching your `.env` verify token).
   - Click **Verify and Save**. Meta will query your server and authenticate the link.
3. Under **Page Subscriptions**, click **Subscribe** on the `leadgen` row parameters.

---

## 7. Performance & Backups Cron Job

To run the nightly PostgreSQL backup script every night at 2:00 AM:
1. Make the script executable:
   ```bash
   chmod +x backup-db.sh
   ```
2. Open system crontab configuration:
   ```bash
   crontab -e
   ```
3. Add the following line:
   ```cron
   0 2 * * * /var/www/swaranbhumi-crm/backup-db.sh >> /var/log/crm_backup.log 2>&1
   ```
4. Backups will be dumped, compressed, and cleaned up automatically, maintaining a 30-day retention loop.
