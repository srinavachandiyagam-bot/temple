# 🚀 Nava Chandi Yagam - Hostinger Deployment Guide
### நவசண்டி யாகம் - Hostinger ஹோஸ்டிங் முழுமையான வழிகாட்டி

This comprehensive guide walks you through deploying the **Nava Chandi Yagam** temple event registration and admin system to **Hostinger**.

The application is built to run smoothly on Hostinger with:
- **Zero Database Fees & 50GB Persistent Storage**: Runs on embedded SQLite (`data/temple.db`) + `public/uploads/` & `public/videos/` directly on your Hostinger 50GB persistent volume — no Cloudflare R2 or external service required. Redeployments **never** delete `data/temple.db`, `public/uploads/`, or `public/videos/` when you follow the safe ZIP method below (Step 1).
- **Universal Entry Points**: Compatible with `index.js`, `server.js`, and `app.js` for automatic recognition by Hostinger hPanel and CloudLinux Node.js Manager.
- **Apache / LiteSpeed Support**: Includes ready-made `.htaccess` with HTTPS enforcement, security headers, and static caching.
- **VPS / PM2 Support**: Includes `ecosystem.config.js` and `hostinger-nginx.conf` for Hostinger VPS deployments, plus `setup-hostinger.sh` with automatic persistent-file backup/restore.

---

## 📋 Table of Contents
1. [Which Hostinger Plan Do You Have?](#which-hostinger-plan-do-you-have)
2. [Method 1: Hostinger Web / Cloud Hosting (hPanel Node.js Manager)](#method-1-hostinger-web--cloud-hosting-hpanel-nodejs-manager)
3. [Method 2: Hostinger VPS (Ubuntu with PM2 & Nginx)](#method-2-hostinger-vps-ubuntu-with-pm2--nginx)
4. [Cashfree Payment Gateway & Webhook Setup](#cashfree-payment-gateway--webhook-setup)
5. [Admin Panel & Super Admin Login](#admin-panel--super-admin-login)
6. [Post-Deployment Verification & Checklist](#post-deployment-verification--checklist)
7. [Troubleshooting & FAQ](#troubleshooting--faq)

---

## 🧭 Which Hostinger Plan Do You Have?

| Hostinger Plan Type | Deployment Method | Recommended Node.js Version |
|---|---|---|
| **Hostinger Web / Cloud Hosting** (Business / Cloud Startup / Cloud Professional) | **Method 1** (hPanel Graphical Interface) | Node.js 22.x LTS (stable, required for `node:sqlite` fallback) |
| **Hostinger VPS** (KVM 1, KVM 2, KVM 4, etc.) | **Method 2** (SSH Terminal + PM2 + Nginx) | Node.js 22.x LTS |

---

## Method 1: Hostinger Web / Cloud Hosting (hPanel Node.js Manager)

Hostinger's hPanel provides a built-in graphical Node.js application selector.

### Step 1: Prepare the Files to Upload (CRITICAL - Preserve 50GB Persistent Storage)
> **🔒 Hostinger 50GB Persistent Storage:** Your plan provides persistent disk. These three paths **must never be overwritten** on redeploy:
> - `public/uploads/` — all temple photos uploaded via Admin
> - `public/videos/` — all temple videos uploaded via Admin
> - `data/temple.db` — SQLite database (all registrations, `data/settings.json` references)
> The ZIP you upload **must exclude** them. All other application code will still update normally.

**On your local computer, create a deployment ZIP that EXCLUDES persistent files:**

**Option A — Automated (recommended):**

*Linux / macOS / Git Bash:*
```bash
# From inside the temple/ directory:
zip -r nava-chandi-yagam.zip index.js server.js app.js package.json package-lock.json .htaccess ecosystem.config.js hostinger-nginx.conf setup-hostinger.sh .env.example \
  db src public data \
  -x "node_modules/*" ".env" ".git/*" "data/temple.db" "data/*.db" "public/uploads/*" "public/videos/*" "*.log"
# Verify the ZIP does NOT contain persistent files:
unzip -l nava-chandi-yagam.zip | grep -E "public/uploads|public/videos|data/temple.db" && echo "❌ ZIP still contains persistent files!" || echo "✅ ZIP clean - no persistent files"
```

*Windows PowerShell (your local Downloads folder):*
```powershell
# From inside temple-final\ :
# Use 7-Zip or PowerShell - exclude persistent paths manually:
# If using File Explorer: Select all files, then Ctrl+Click to DESELECT:
#   data/temple.db, public/uploads/*, public/videos/*, node_modules, .env, .git

# Or with PowerShell (requires Compress-Archive - create clean staging folder):
Remove-Item -Recurse -Force ".\deploy-staging" -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path ".\deploy-staging" | Out-Null
Copy-Item -Recurse -Force ".\db",".\src",".\public",".\data" ".\deploy-staging\"
Copy-Item -Force ".\index.js",".\server.js",".\app.js",".\package.json",".\package-lock.json",".\.htaccess",".\ecosystem.config.js",".\hostinger-nginx.conf",".\setup-hostinger.sh",".\.env.example" ".\deploy-staging\"
# Remove persistent files from staging BEFORE zipping
Remove-Item -Force ".\deploy-staging\data\temple.db" -ErrorAction SilentlyContinue
Remove-Item -Force ".\deploy-staging\data\*.db" -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\deploy-staging\public\uploads" -File | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\deploy-staging\public\videos" -File | Remove-Item -Force -ErrorAction SilentlyContinue
# Keep the directories but empty (so mkdir -p still works)
New-Item -ItemType File -Path ".\deploy-staging\public\uploads\.gitkeep" -Force | Out-Null
New-Item -ItemType File -Path ".\deploy-staging\public\videos\.gitkeep" -Force | Out-Null
New-Item -ItemType File -Path ".\deploy-staging\data\.gitkeep" -Force | Out-Null
Compress-Archive -Path ".\deploy-staging\*" -DestinationPath ".\nava-chandi-yagam.zip" -Force
Remove-Item -Recurse -Force ".\deploy-staging"
Write-Host "✅ ZIP created without persistent files - safe to upload"
```

*Manual File Explorer (if you don't use command line):*
1. In `temple/` select all files/folders.
2. **Ctrl+Click to DESELECT** these before zipping: `node_modules`, `.env`, `.git`, `data/temple.db`, any `*.db` in `data/`, **all files inside** `public/uploads/` and `public/videos/` (keep the empty folders).
3. Right-click → Send to → Compressed (zipped) folder → `nava-chandi-yagam.zip`.
4. Open the zip and verify: `public/uploads/` should be empty (only `.gitkeep`), `public/videos/` empty, `data/` should NOT contain `temple.db`.

> **Why this works:** Hostinger's File Manager `Extract` overwrites files that *exist in the ZIP*, but **leaves untouched** any existing files on the server that are *not* in the ZIP. By excluding the three persistent paths from the ZIP, your live uploads and `data/temple.db` on the server remain exactly as they were, while all other code updates.

### Step 2: Upload Files in hPanel (Safe Extraction - Persistent Files Preserved)
1. **(First-time only)** If this is a brand-new domain, ensure the app directory is empty.
2. **(Redeploy)** Before uploading, your live `public/uploads/`, `public/videos/`, and `data/temple.db` are already safe on the server's 50GB disk. No manual backup needed if you excluded them from the ZIP (Step 1). For extra safety with SSH access, see *Safe SSH Redeploy* below.
3. Log in to your [Hostinger hPanel](https://hpanel.hostinger.com).
4. Go to **Websites** → Select your domain → Click **Manage**.
5. In the sidebar, search for or click **File Manager** (Files → File Manager).
6. Navigate to your website folder (typically `public_html` or `/domains/yourdomain.com/public_html`).
7. Click **Upload** (top right) → Choose `nava-chandi-yagam.zip` (the clean ZIP from Step 1).
8. Right-click the uploaded `.zip` file → Select **Extract** → Confirm extraction to `public_html/`.
   - ✅ Application files (`src/`, `db/`, `public/index.html`, `package.json`, etc.) **will** update.
   - 🔒 `public/uploads/*`, `public/videos/*`, `data/temple.db` **will NOT** be touched (not in ZIP, so File Manager leaves existing server files intact).
9. You can now delete the `.zip` file from the server.
10. **Verify:** In File Manager, check `public/uploads/` still shows your previously uploaded photos, `public/videos/` still shows videos, and `data/temple.db` still has a recent Modified date (not today's upload time).

<details>
<summary><strong>🔐 Safe SSH Redeploy (if you have Hostinger SSH / Terminal)</strong></summary>

If your Hostinger plan includes SSH (Cloud Professional, VPS), use this bullet-proof method that backs up BEFORE extraction:

```bash
# SSH into Hostinger:
ssh u12345678@yourtempledomain.com  # or root@YOUR_VPS_IP for VPS

cd ~/domains/yourdomain.com/public_html  # or /var/www/nava-chandi-yagam for VPS

# 1. Backup persistent files OUTSIDE the app directory (survives ZIP overwrite)
BACKUP_DIR="$(dirname "$(pwd)")/.nava-chandi-persistent-backup"
mkdir -p "$BACKUP_DIR"
cp -a data/temple.db "$BACKUP_DIR/data_temple.db.bak" 2>/dev/null && echo "💾 DB backed up" || echo "ℹ️ No existing DB"
cp -a public/uploads "$BACKUP_DIR/" 2>/dev/null && echo "💾 Uploads backed up" || echo "ℹ️ No uploads"
cp -a public/videos "$BACKUP_DIR/" 2>/dev/null && echo "💾 Videos backed up" || echo "ℹ️ No videos"

# 2. Extract the clean ZIP (or unzip uploaded file)
unzip -o nava-chandi-yagam.zip

# 3. Restore persistent files (merge - never delete)
cp -a "$BACKUP_DIR/data_temple.db.bak" data/temple.db 2>/dev/null && echo "♻️ DB restored" || true
cp -an "$BACKUP_DIR/uploads"/* public/uploads/ 2>/dev/null && echo "♻️ Uploads restored" || true
cp -an "$BACKUP_DIR/videos"/* public/videos/ 2>/dev/null && echo "♻️ Videos restored" || true

# 4. Run the automated setup (handles Node, migrations, permissions)
chmod +x setup-hostinger.sh
./setup-hostinger.sh
```
The included `setup-hostinger.sh` also performs this backup/restore automatically when run, so even a plain `./setup-hostinger.sh` after a GUI extraction is safe.

</details>

### Step 3: Configure Node.js in hPanel
1. In hPanel, go to **Advanced** → **Node.js** (or type `Node.js` in the hPanel search bar).
2. Click **Create Application** (or Edit if one already exists).
3. Fill in the application settings:
   - **Node.js version**: Select `22.x` LTS (22.5+ required for `node:sqlite` GLIBC-independent fallback; 22.20.x stable recommended).
   - **Application mode**: Select `Production`.
   - **Application root**: Select or enter `/public_html` (or your domain path).
   - **Application startup file**: Enter `index.js` (or `server.js`).
   - **Application URL**: Select your domain (e.g. `https://yourtempledomain.com`).
4. Click **Create** / **Save**.

### Step 4: Configure Environment Variables
In the same Node.js settings page in hPanel, scroll down to the **Environment Variables** section (or click **Edit** on `.env` in the File Manager):

```env
NODE_ENV=production
MOCK_MODE=false
PORT=3000
ADMIN_PASSWORD=SetYourStrongAdminPasswordHere!

# Live website URL:
PUBLIC_BASE_URL=https://yourtempledomain.com

# Cashfree Credentials (from merchant dashboard):
CASHFREE_APP_ID=your_cashfree_app_id
CASHFREE_SECRET_KEY=your_cashfree_secret_key
CASHFREE_WEBHOOK_SECRET=your_cashfree_webhook_secret
CASHFREE_ENV=production
CASHFREE_API_VERSION=2023-08-01

# Event price (₹):
REGISTRATION_AMOUNT=1000.00
```

> [!TIP]
> If testing initially, leave `CASHFREE_ENV=sandbox` with your Cashfree test keys until you are ready to collect real payments.

### Step 5: Install Dependencies & Run Migrations
1. In the hPanel Node.js section, click the **NPM Install** button (or "Run NPM").
   - This will automatically install the packages from `package.json`.
2. Under "Run Script" or in the hPanel Terminal/SSH:
   ```bash
   npm run migrate
   ```
   *(If you don't have terminal access, the server will automatically create and initialize the database schema on its first startup).*
3. Click **Restart Application** (or **Start**).

---

## Method 2: Hostinger VPS (Ubuntu with PM2 & Nginx)

If you are using Hostinger KVM VPS, this method gives maximum performance, automatic reboots, and high concurrency.

### Step 1: Connect via SSH
```bash
ssh root@YOUR_HOSTINGER_VPS_IP
```

### Step 2: Install Node.js & Essential Tools
```bash
# Update Ubuntu packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 22.x LTS (stable, 22.5+ required for node:sqlite)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git

# Install PM2 Process Manager globally
sudo npm install -g pm2
```

### Step 3: Deploy the Application (Persistent Storage Preserved Automatically)
```bash
# Create application directory (persistent 50GB volume)
sudo mkdir -p /var/www/nava-chandi-yagam
cd /var/www/nava-chandi-yagam

# Option A: Git deployment (safest for VPS - persistent files are untracked, so git never deletes them)
# git clone <your-repo-url> .           # first time
# git pull origin website-update         # redeploy - data/temple.db, public/uploads/, public/videos/ are untouched (not in git)

# Option B: ZIP upload (if you upload a ZIP to the VPS)
# Create the ZIP locally EXCLUDING persistent files (same as Method 1 Step 1)
# zip -r nava-chandi-yagam.zip ... -x "data/temple.db" "public/uploads/*" "public/videos/*"
# Upload to VPS, then:
# unzip -o nava-chandi-yagam.zip   # safe - ZIP has no persistent files, so existing uploads/DB remain

# Run automated deployment setup script (automatically backs up & verifies persistent files)
chmod +x setup-hostinger.sh
./setup-hostinger.sh
# Output will show: "✅ public/uploads preserved: N files" and "✅ data/temple.db preserved"
```

### Step 4: Configure Production `.env`
```bash
nano .env
```
Paste and update your production credentials:
```env
NODE_ENV=production
MOCK_MODE=false
PORT=3000
ADMIN_PASSWORD=SetYourStrongAdminPasswordHere!
PUBLIC_BASE_URL=https://yourtempledomain.com

CASHFREE_APP_ID=your_production_app_id
CASHFREE_SECRET_KEY=your_production_secret_key
CASHFREE_WEBHOOK_SECRET=your_production_webhook_secret
CASHFREE_ENV=production
REGISTRATION_AMOUNT=1000.00
```
Save and exit (`Ctrl + O`, `Enter`, `Ctrl + X`).

### Step 5: Start with PM2
```bash
# Start with PM2 using the included ecosystem configuration
pm2 start ecosystem.config.js

# Configure PM2 to restart automatically when VPS reboots
pm2 save
pm2 startup
```

### Step 6: Configure Nginx & Free SSL Certificate
1. Copy the included Nginx config:
   ```bash
   sudo cp hostinger-nginx.conf /etc/nginx/sites-available/nava-chandi-yagam
   ```
2. Edit domain names inside `/etc/nginx/sites-available/nava-chandi-yagam`:
   ```bash
   sudo nano /etc/nginx/sites-available/nava-chandi-yagam
   ```
   *(Replace `yourtempledomain.com` with your actual domain).*
3. Enable site and test configuration:
   ```bash
   sudo ln -s /etc/nginx/sites-available/nava-chandi-yagam /etc/nginx/sites-enabled/
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t
   sudo systemctl reload nginx
   ```
4. Generate free Let's Encrypt SSL:
   ```bash
   sudo certbot --nginx -d yourtempledomain.com -d www.yourtempledomain.com
   ```

---

## 💳 Cashfree Payment Gateway & Webhook Setup

To receive real payments from devotees via UPI, Google Pay, PhonePe, Cards, and Net Banking:

1. Log in to [Cashfree Merchant Dashboard](https://merchants.cashfree.com).
2. Switch toggle to **Production** (or Sandbox if testing).
3. Navigate to **Developers** → **API Keys**:
   - Copy **App ID** → Set as `CASHFREE_APP_ID`.
   - Generate & Copy **Secret Key** → Set as `CASHFREE_SECRET_KEY`.
4. Navigate to **Developers** → **Webhooks**:
   - Click **Add Webhook**.
   - **Webhook URL**:
     ```
     https://yourtempledomain.com/api/cashfree/webhook
     ```
   - **Events**: Enable `ORDER_PAID`, `PAYMENT_SUCCESS_WEBHOOK`, `PAYMENT_FAILED_WEBHOOK`.
   - Copy the Webhook Secret Key → Set as `CASHFREE_WEBHOOK_SECRET`.

---

## 👑 Admin Panel & Super Admin Login

Once deployed:
1. Open your browser and navigate to:
   ```
   https://yourtempledomain.com/admin
   ```
2. **Login Credentials**:
   - **Username**: `superadmin`
   - **Password**: The password you set in `ADMIN_PASSWORD` (or default `change-this-password`).
3. **Role-Based Admin Management**:
   - As the **Main Super Admin**, you will see the **👑 Admins (நிர்வாகிகள்)** tab.
   - You can create separate logins for temple desk officers or priests (Role: Standard Admin).
   - Standard admins can manage devotees, photos, and event info, but **cannot delete or create admins**.
   - Super Admin accounts are permanently protected against deletion.

---

## ✅ Post-Deployment Verification & Checklist

Run these quick checks in your browser to confirm 100% functionality:

- [ ] **Health Check Endpoint**: Visit `https://yourtempledomain.com/health`
  - Expected output: `{"status":"ok","service":"Nava Chandi Yagam Registration API","environment":"production",...}`
- [ ] **Public Homepage**: Visit `https://yourtempledomain.com/`
  - Check that temple details, tamil typography, and event details load cleanly.
- [ ] **Registration Form**: Submit a test registration.
- [ ] **Admin Panel**: Visit `https://yourtempledomain.com/admin` and log in.
- [ ] **Photo Upload**: In Admin Panel → Photos tab, upload a photo and ensure it displays.
- [ ] **CSV Export**: Click "Download CSV" in Admin Panel to test spreadsheet export.

---

## 🛠️ Troubleshooting & FAQ

### 1. `EACCES: permission denied` for uploads or database
Make sure the `data` and `public/uploads` folders have write permissions:
```bash
chmod -R 755 data public/uploads public/videos
```

### 2. What happens if the server restarts or I redeploy? Where is the database stored?
The database is stored in `data/temple.db` and uploads in `public/uploads/` & `public/videos/` — all three live directly on your Hostinger 50GB persistent volume (not in memory or Docker layer).
- **Server restarts / reboots / `pm2 restart`:** Files **persist** — no data loss. `src/server.js:12-16` uses `mkdir -p` (never deletes) and `setup-hostinger.sh` verifies preservation on every run.
- **Redeploy via ZIP (hPanel File Manager):** Files **persist IF** you excluded them from the ZIP (Method 1 Step 1). File Manager's `Extract` overwrites only files *in the ZIP*; existing `data/temple.db` and uploads that are *not* in the ZIP are left untouched. The guide's ZIP commands above guarantee this. If you accidentally included them, `setup-hostinger.sh`'s backup in `../.nava-chandi-persistent-backup/` will attempt to restore.
- **Redeploy via Git (`git pull`) on VPS:** Files **always persist** — `data/temple.db`, `public/uploads/*`, `public/videos/*` are untracked (not in git), so `git pull` never touches them.
- **Backup:** Download `data/temple.db` via File Manager or `scp` anytime. Uploads can be downloaded via File Manager or `tar czf uploads-backup.tar.gz public/uploads public/videos`.

> **Critical:** Never manually delete `data/temple.db` or `public/uploads/` before extracting a new ZIP. Always use the clean ZIP method above.

### 3. Can I use an external PostgreSQL database instead of SQLite?
Yes! Simply add your cloud PostgreSQL connection string to your `.env` or hPanel Environment Variables:
```env
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
```
The server will automatically detect PostgreSQL and use it with full SSL support.

### 4. Do I need Cloudflare R2 for my 50GB Hostinger plan?
**No.** Hostinger's 50GB is persistent disk — `public/uploads/`, `public/videos/`, and `data/temple.db` live there permanently when you use the safe deployment method above. R2 is only required for ephemeral hosts like Render, Vercel, or Netlify where the filesystem is wiped on every deploy. For Hostinger (hPanel or VPS), local disk is the correct, zero-cost solution. `src/config/uploader.js:5-6` writes directly to `public/uploads` / `public/videos`, and `setup-hostinger.sh` ensures they are preserved. No R2 credentials needed — leave `R2_*` vars empty.

---

*For further adjustments, all backend routes are in `src/routes/api.js` and frontend templates are in `public/`.*
