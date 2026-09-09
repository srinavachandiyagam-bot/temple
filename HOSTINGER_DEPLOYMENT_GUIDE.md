# 🚀 Nava Chandi Yagam - Hostinger Deployment Guide
### நவசண்டி யாகம் - Hostinger ஹோஸ்டிங் முழுமையான வழிகாட்டி

This comprehensive guide walks you through deploying the **Nava Chandi Yagam** temple event registration and admin system to **Hostinger**.

The application is built to run smoothly on Hostinger with:
- **Zero Database Fees**: Runs on embedded persistent SQLite (`data/temple.db`) out-of-the-box (no external database server subscription needed). PostgreSQL is also supported if you prefer cloud databases (Supabase/Neon).
- **Universal Entry Points**: Compatible with `index.js`, `server.js`, and `app.js` for automatic recognition by Hostinger hPanel and CloudLinux Node.js Manager.
- **Apache / LiteSpeed Support**: Includes ready-made `.htaccess` with HTTPS enforcement, security headers, and static caching.
- **VPS / PM2 Support**: Includes `ecosystem.config.js` and `hostinger-nginx.conf` for Hostinger VPS deployments.

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
| **Hostinger Web / Cloud Hosting** (Business / Cloud Startup / Cloud Professional) | **Method 1** (hPanel Graphical Interface) | Node.js 18.x or 20.x LTS |
| **Hostinger VPS** (KVM 1, KVM 2, KVM 4, etc.) | **Method 2** (SSH Terminal + PM2 + Nginx) | Node.js 20.x LTS |

---

## Method 1: Hostinger Web / Cloud Hosting (hPanel Node.js Manager)

Hostinger's hPanel provides a built-in graphical Node.js application selector.

### Step 1: Prepare the Files to Upload
On your local computer, select all files in the `temple/` directory **EXCEPT** `node_modules/` and `.env` (these will be generated on Hostinger):
- Folders to include: `data/`, `db/`, `public/`, `src/`, `test/`
- Files to include: `index.js`, `server.js`, `app.js`, `package.json`, `package-lock.json`, `.htaccess`, `.env.example`
- Create a `.zip` file (e.g. `nava-chandi-yagam.zip`).

### Step 2: Upload Files in hPanel
1. Log in to your [Hostinger hPanel](https://hpanel.hostinger.com).
2. Go to **Websites** → Select your domain → Click **Manage**.
3. In the sidebar, search for or click **File Manager** (Files → File Manager).
4. Navigate to your website folder (typically `public_html` or `/domains/yourdomain.com/public_html`).
5. Click **Upload** (top right) → Choose `nava-chandi-yagam.zip`.
6. Right-click the uploaded `.zip` file → Select **Extract** to extract files directly into `public_html`.
7. You can now delete the `.zip` file.

### Step 3: Configure Node.js in hPanel
1. In hPanel, go to **Advanced** → **Node.js** (or type `Node.js` in the hPanel search bar).
2. Click **Create Application** (or Edit if one already exists).
3. Fill in the application settings:
   - **Node.js version**: Select `20.x` (or `18.x`).
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

# Install Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git

# Install PM2 Process Manager globally
sudo npm install -g pm2
```

### Step 3: Deploy the Application
```bash
# Create application directory
sudo mkdir -p /var/www/nava-chandi-yagam
cd /var/www/nava-chandi-yagam

# Clone from your Git repository OR upload your code
# git clone <your-repo-url> .

# Run automated deployment setup script
chmod +x setup-hostinger.sh
./setup-hostinger.sh
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

### 2. What happens if the server restarts? Where is the database stored?
The database is stored in `data/temple.db`. It is a persistent SQLite database file located directly inside your project folder. It persists across reboots, restarts, and server upgrades. You can back it up anytime simply by downloading `data/temple.db` via Hostinger File Manager or FTP.

### 3. Can I use an external PostgreSQL database instead of SQLite?
Yes! Simply add your cloud PostgreSQL connection string to your `.env` or hPanel Environment Variables:
```env
DATABASE_URL=postgresql://postgres:password@db.xxxx.supabase.co:5432/postgres
```
The server will automatically detect PostgreSQL and use it with full SSL support.

---

*For further adjustments, all backend routes are in `src/routes/api.js` and frontend templates are in `public/`.*
