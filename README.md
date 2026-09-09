# Nava Chandi Yagam - Event Registration & Cashfree Payment System

A complete, production-ready Node.js & Express backend and PostgreSQL/SQLite database for the **Nava Chandi Yagam** (நவசண்டி யாகம்) temple event registration page, integrated with **Cashfree Payment Gateway** (Orders API v2023-08-01 + Webhooks).

> 🚀 **Deploying to Hostinger?** Check out the step-by-step [Hostinger Deployment Guide](HOSTINGER_DEPLOYMENT_GUIDE.md) for both hPanel Shared/Cloud hosting and VPS.

---

## 📁 Project Structure

```
├── public/
│   └── index.html               # Connected bilingual frontend (Tamil/English) with Cashfree JS SDK
├── src/
│   ├── config/
│   │   ├── db.js                # PostgreSQL connection pool with cloud SSL support
│   │   └── cashfree.js          # Cashfree PG Orders API client & HMAC-SHA256 signature verification
│   ├── controllers/
│   │   ├── registrationController.js # Handles registration validation & order creation
│   │   └── paymentController.js      # Handles order verification & webhook updates
│   ├── middleware/
│   │   ├── validateRegistration.js   # Input validation for devotee & family member data
│   │   └── errorHandler.js           # Centralized JSON error handling
│   ├── routes/
│   │   └── api.js               # API routes (/api/register, /api/cashfree/*)
│   ├── utils/
│   │   └── idGenerator.js       # Unique NCY-XXXXXX registration ID generator
│   └── server.js                # Express app entrypoint, static file server, raw body capture
├── db/
│   ├── schema.sql               # PostgreSQL DDL for registrations & registration_members
│   └── migrate.js               # Automated database migration runner
├── test/
│   ├── test-unit.js             # Unit tests for ID generator, validation & webhooks
│   └── test-server.js           # Express API integration tests
├── .env.example                 # Template for environment variables
├── .gitignore                   # Ignored files (node_modules, .env, etc.)
├── package.json                 # Project dependencies and npm scripts
└── README.md                    # Setup and deployment documentation
```

---

## 🚀 Quick Start (Local Setup)

### Option A: Persistent Local SQLite (Zero Setup — Recommended)
Run locally with a real, persistent database without installing PostgreSQL:
1. In `.env`, ensure `MOCK_MODE=false` and leave `DATABASE_URL=` blank.
2. The server automatically initializes SQLite at `data/temple.db`.
3. Start the server:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000` for registration or `http://localhost:3000/admin` for the admin panel!

---

### Option B: Cloud PostgreSQL (Supabase, Neon, Render, Railway)
To use PostgreSQL:
1. In `.env`, set `MOCK_MODE=false` and set `DATABASE_URL`:
   ```ini
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
2. Run database migration:
   ```bash
   npm run migrate
   ```
3. Start the server:
   ```bash
   npm start
   ```

---

### Option C: In-Memory Mock Mode (Fast Testing)
1. In `.env`, set `MOCK_MODE=true`.
2. Start the server: `npm start`. All data is stored in memory.

Edit `.env` and fill in your details:
```ini
PORT=3000
NODE_ENV=development

# PostgreSQL Database URL
# Example for local: postgresql://postgres:password@localhost:5432/nava_chandi_yagam
# Example for Supabase: postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/nava_chandi_yagam

# Cashfree Sandbox Credentials
CASHFREE_APP_ID=TEST10000000000000000000000000000001
CASHFREE_SECRET_KEY=TEST0000000000000000000000000000000000000001
CASHFREE_WEBHOOK_SECRET=TEST0000000000000000000000000000000000000001
CASHFREE_ENV=sandbox
CASHFREE_API_VERSION=2023-08-01

# Event Registration Fee (in INR)
REGISTRATION_AMOUNT=1000.00

# Redirection URLs
CLIENT_URL=http://localhost:3000
SERVER_URL=http://localhost:3000
```

### 4. Run Database Migrations
Create the database tables and indexes automatically:
```bash
npm run migrate
```
*(Or if using Supabase SQL Editor, copy and run the contents of `db/schema.sql` directly).*

### 5. Run the Server
```bash
# Start server
npm start

# Or start in watch mode for development
npm run dev
```

Open your browser at **`http://localhost:3000`** to view the registration page!

---

## 🗄️ Database Schema Details

The schema consists of two tables designed for PostgreSQL (also compatible with Supabase):

### `registrations` Table
| Column | Type | Description |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Internal database sequence ID |
| `registration_id` | `VARCHAR(32) UNIQUE` | Public-facing ID (e.g. `NCY-8A2F9B`) |
| `name` | `VARCHAR(255)` | Devotee primary name |
| `mobile` | `VARCHAR(20)` | 10-digit mobile number |
| `email` | `VARCHAR(255)` | Optional email address |
| `address` | `TEXT` | Optional postal address |
| `rasi` | `VARCHAR(100)` | Primary devotee Rasi |
| `natchathiram` | `VARCHAR(100)` | Primary devotee Nakshatram |
| `gothram` | `VARCHAR(100)` | Devotee Gothram |
| `payment_status` | `VARCHAR(50)` | `pending_payment`, `paid`, `failed` |
| `cashfree_order_id` | `VARCHAR(100) UNIQUE`| Associated Cashfree Order ID |
| `amount` | `NUMERIC(10, 2)` | Fee (default `1000.00`) |
| `created_at` | `TIMESTAMPTZ` | Timestamp of registration |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated on status change |

### `registration_members` Table
| Column | Type | Description |
|---|---|---|
| `id` | `BIGSERIAL PRIMARY KEY` | Internal ID |
| `registration_id` | `BIGINT REFERENCES registrations(id)` | Foreign key (cascades on delete) |
| `member_number` | `SMALLINT` | Member 1 to 4 |
| `name` | `VARCHAR(255)` | Family member name |
| `rasi` | `VARCHAR(100)` | Member Rasi |
| `natchathiram` | `VARCHAR(100)` | Member Nakshatram |
| `gothram` | `VARCHAR(100)` | Member Gothram |
| `created_at` | `TIMESTAMPTZ` | Created timestamp |

---

## 💳 Cashfree Payment Gateway Setup

### Getting Cashfree API Keys
1. Log into your [Cashfree Merchant Dashboard](https://merchants.cashfree.com).
2. Switch to **Sandbox** (for testing) or **Production** (for live).
3. Navigate to **Payment Gateway** -> **Developers** -> **API Keys**.
4. Generate and copy your **App ID** (`CASHFREE_APP_ID`) and **Secret Key** (`CASHFREE_SECRET_KEY`).
5. Under **Developers** -> **Webhooks**, set your webhook URL to:
   `https://<your-deployed-domain>/api/cashfree/webhook`
   and copy the Webhook Secret into `CASHFREE_WEBHOOK_SECRET`.

### How the Payment Flow Works
1. Devotee fills in the registration form and clicks **Submit Registration**.
2. Frontend sends `POST /api/register` with the form details.
3. Backend:
   - Validates input (`name` and `mobile` required).
   - Generates unique `NCY-XXXXXX` registration ID.
   - Inserts registration and family members into PostgreSQL with status `pending_payment`.
   - Calls Cashfree Orders API (`POST /pg/orders`) to generate a `payment_session_id`.
   - Returns `{ success: true, registrationId, orderId, paymentSessionId, paymentMode }`.
4. Frontend initializes the **Cashfree JS SDK** with `paymentSessionId` and opens Cashfree checkout.
5. Once paid, Cashfree redirects back to `CLIENT_URL/?order_id=order_NCY_...`.
6. Frontend executes `GET /api/cashfree/verify?order_id=...`:
   - Backend queries Cashfree to confirm the order status (`PAID`).
   - Backend updates database `payment_status` to `'paid'`.
   - Returns `{ "status": "paid", "registrationId": "NCY-XXXXXX" }`.
   - Frontend displays the confirmation message with the devotee's registration ID in Tamil and English!
7. **Webhook Reliability**: If the devotee closes the tab or loses internet connection before returning to the website, Cashfree automatically calls `POST /api/cashfree/webhook`, which verifies the HMAC-SHA256 signature and marks the registration as `paid` in the database.

---

## 📡 API Endpoints Reference

### 1. Register Devotee
- **Endpoint**: `POST /api/register`
- **Headers**: `Content-Type: application/json`
- **Body**:
  ```json
  {
    "name": "Karthik Raja",
    "mobile": "9876543210",
    "email": "karthik@example.com",
    "address": "Senthampalayam, Kavindapadi, Erode",
    "rasi": "Mesha (Aries)",
    "natchathiram": "Ashwini",
    "gothram": "Shiva",
    "member1": {
      "name": "Anitha",
      "rasi": "Simha (Leo)",
      "natchathiram": "Magha",
      "gothram": "Shiva"
    },
    "member2": {
      "name": "Surya",
      "rasi": "Kataka (Cancer)",
      "natchathiram": "Pushya",
      "gothram": "Shiva"
    }
  }
  ```
- **Response (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Registration created successfully. Please proceed with payment.",
    "registrationId": "NCY-8F2D1A",
    "orderId": "order_NCY8F2D1A_1725810000000_A1B2",
    "paymentSessionId": "session_a1VXIPJo8kh...",
    "paymentMode": "sandbox",
    "amount": 1000
  }
  ```

### 2. Verify Payment
- **Endpoint**: `GET /api/cashfree/verify?order_id=XXXX`
- **Response (200 OK)**:
  ```json
  {
    "status": "paid",
    "registrationId": "NCY-8F2D1A"
  }
  ```
  *(Status can be `"paid"`, `"pending"`, or `"failed"`)*.

### 3. Cashfree Webhook
- **Endpoint**: `POST /api/cashfree/webhook`
- **Headers**: `x-webhook-signature`, `x-webhook-timestamp`
- **Description**: Verifies HMAC-SHA256 signature against the raw body and marks order as paid in the database.

### 4. Admin Lookup
- **Endpoint**: `GET /api/registrations/:registrationId` (e.g. `/api/registrations/NCY-8F2D1A`)
- **Endpoint**: `GET /api/admin/summary` (Returns registration count and total collections)

---

## ☁️ Deployment Guide

### Deploying to Render
1. Push this repository to GitHub or GitLab.
2. In [Render Dashboard](https://dashboard.render.com):
   - Click **New +** -> **Web Service**.
   - Connect your repository.
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm run migrate && npm start`
3. Under **Environment Variables**, add:
   - `DATABASE_URL`: Your PostgreSQL connection string (create a free Render Postgres instance, or use Supabase/Neon).
   - `CASHFREE_APP_ID`: Your Cashfree App ID.
   - `CASHFREE_SECRET_KEY`: Your Cashfree Secret Key.
   - `CASHFREE_WEBHOOK_SECRET`: Your Cashfree Webhook Secret.
   - `CASHFREE_ENV`: `production` (or `sandbox` for testing).
   - `CLIENT_URL`: `https://your-service-name.onrender.com`
   - `SERVER_URL`: `https://your-service-name.onrender.com`
   - `REGISTRATION_AMOUNT`: `1000.00`
4. Click **Deploy Web Service**!

### Deploying to Railway
1. Go to [Railway Dashboard](https://railway.app).
2. Click **New Project** -> **Provision PostgreSQL** (to add a database).
3. In the same project, click **New** -> **GitHub Repo** and select this repository.
4. Railway will automatically link the database with a `DATABASE_URL` variable.
5. In **Variables**, add:
   - `CASHFREE_APP_ID`
   - `CASHFREE_SECRET_KEY`
   - `CASHFREE_WEBHOOK_SECRET`
   - `CASHFREE_ENV`
   - `CLIENT_URL`: `https://your-railway-domain.up.railway.app`
   - `SERVER_URL`: `https://your-railway-domain.up.railway.app`
6. In **Settings** -> **Deploy**, set the custom start command to:
   ```bash
   npm run migrate && npm start
   ```
7. Railway will deploy and provide your live URL.

---

## 🧪 Testing

Run the automated unit and API integration tests:
```bash
npm test
```
Outputs:
- ID generator validation (`NCY-XXXXXX`)
- Input validation (valid/invalid name, mobile format, member data)
- Webhook signature cryptographic verification (HMAC-SHA256)
- Express server healthcheck and route verification
