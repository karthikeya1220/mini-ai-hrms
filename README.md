# Mini AI-HRMS

A production-grade, AI-powered Human Resource Management System with immutable Web3 audit logging. Designed for high-integrity workforce management, this system provides deterministic performance scoring and cross-tenant data isolation.

---

## 1. Project Overview

Mini AI-HRMS is a multi-tenant platform that enables organizations to manage employees and tasks with cryptographic certainty. Every major workforce event is recorded on the Polygon blockchain, while a deterministic AI engine provides explainable productivity metrics.

---

## 2. System Architecture

```text
┌─────────────────┐      ┌──────────────────────────┐      ┌──────────────────┐
│  React Frontend │◄────►│  Express API (Node.js)   │◄────►│  PostgreSQL (DB) │
└────────┬────────┘      └────────────┬─────────────┘      └──────────────────┘
         │                            │                            ▲
         │ (Optional)                 ├────────────────────────────┤
         ▼                            ▼                            ▼
┌─────────────────┐      ┌──────────────────────────┐      ┌──────────────────┐
│  Web3 (MetaMask)│      │  Redis Cache / BullMQ    │      │  AI Scoring      │
└────────┬────────┘      └────────────┬─────────────┘      │  (Deterministic) │
         │                            │                    └──────────────────┘
         ▼                            ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Polygon Blockchain (Audit Trail)                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Vite.
- **Backend**: Node.js, Express, Prisma ORM, Zod validation.
- **Database**: PostgreSQL (Primary), Redis (Caching & Job Queues).
- **Web3**: Solidity (WorkforceLogger Smart Contract), Ethers.js, Polygon Amoy Network.
- **Security**: JWT (Access + Refresh Tokens in httpOnly cookies), Bcryptjs.
- **Infrastructure**: BullMQ (Async Background Jobs), Nodemon.

---

## 4. Core Features

- **Multi-Tenant Dashboard**: Real-time KPI tracking for organizations.
- **Kanban Task Board**: Drag-and-drop task management with forward-only state transitions.
- **Employee Management**: Profile tracking with skill-set mapping and wallet association.
- **AI Recommendation**: Automated task-to-employee matching based on skills and availability.
- **Blockchain Verification**: Peer-verifiable proof of task completion via on-chain events.

---

## 5. AI Workforce Intelligence

Rather than using opaque black-box models, this system utilizes a **Deterministic Weighted Scoring Engine**. This ensures all performance metrics are auditable, explainable, and zero-latency.

### Productivity Score Formula

Each employee is scored from **0–100** based on three weighted factors:

- **40% — Task Completion Rate**: Total completed vs. total assigned tasks.
- **35% — On-Time Rate**: Percentage of tasks finished before their due date.
- **25% — Average Complexity**: Weighted average of the complexity level (1–5) of assigned tasks.

**Grade Mapping:**
`A+ (≥90)` | `A (≥80)` | `B (≥70)` | `C (≥60)` | `D (<60)`

### Smart Recommendation logic

Candidates for tasks are ranked using a composite score:
`Rank = (SkillOverlap × 30) + ((10 − ActiveTaskCount) × 20) + (ProductivityScore × 0.5)`

---

## 6. Web3 Audit Trail Flow

1. **Task Completion**: A task is moved to `completed` on the Kanban board.
2. **On-Chain Log**:
   - **Client-Side**: If MetaMask is connected, the organization signs a transaction calling `WorkforceLogger.logTaskCompletion`.
   - **Backend-Side**: As a fallback, an async job emits the transaction via a dedicated deployer wallet.
3. **Receipt Storage**: The resulting Transaction Hash is stored in the `blockchain_logs` table, creating a permanent link between the HRMS and the ledger.

---

## 7. Multi-Tenancy & Security Model

### Data Isolation

All records are scoped to an `orgId`. The `orgId` is extracted from the JWT session and is **never** accepted as a user-provided input. Cross-tenant reads/writes are prevented via:

- Atomic `where: { id, orgId }` clauses on all mutations.
- Strict database-level foreign key constraints.

### JWT Hardening

- **Access Tokens**: Short-lived (1h) stored in memory.
- **Refresh Tokens**: Long-lived (7d) stored in `httpOnly`, `Secure`, `SameSite: Strict` cookies.
- **Startup Guard**: The server refuses to boot in `production` if `ALLOWED_ORIGINS` includes `localhost`.

---

## 8. Scalability Strategy

- **Caching**: Dashboard aggregates and AI scores are cached in **Redis** with a 60-second TTL, invalidated immediately on relevant state changes.
- **Async Processing**: Resource-heavy operations (AI score recomputation, blockchain logging) are offloaded to **BullMQ** to ensure sub-100ms API response times.
- **Atomic Operations**: `updateMany` patterns are used to prevent TOCTOU (Time-of-Check to Time-of-Use) race conditions in multi-tenant environments.

---

## 9. Environment Setup

### Server (.env)

```env
DATABASE_URL="postgresql://..."
REDIS_URL="redis://..."
JWT_SECRET="..."
ALLOWED_ORIGINS="https://yourdomain.com"
WEB3_RPC_URL="https://rpc-amoy.polygon.technology"
WORKFORCE_LOGGER_ADDRESS="0x..."
DEPLOYER_PRIVATE_KEY="your-wallet-key"
```

### Client (.env)

```env
VITE_API_URL="https://api.yourdomain.com"
VITE_WORKFORCE_LOGGER_ADDRESS="0x..."
```

---

## 10. Running the Project

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Database Migration**:

   ```bash
   cd server && npx prisma migrate dev
   ```

3. **Start Development Servers**:

   ```bash
   # Terminal 1: Backend
   cd server && npm run dev
   # Terminal 2: Frontend
   cd client && npm run dev
   ```

---

## 11. Deployment

### Backend (Railway)

1. Link your GitHub repo to Railway.
2. Connect a PostgreSQL and Redis instance.
3. Set environment variables from `server/.env`.
4. Command: `npm start`.

### Frontend (Vercel)

1. Import the `/client` directory.
2. Set Environment Variables from `client/.env`.
3. Vercel automatically handles the build and deployment.

---

## 12. Future Improvements

- **WebSockets**: Real-time board updates across different organization accounts.
- **Advanced Skill Gap Analysis**: AI-driven training recommendations based on market trends.
- **Multi-Chain Support**: Enable auditing on Base or Arbitrum for lower gas fees.
- **Mobile Companion**: Native app for task tracking and status updates.

---

**License**: MIT  
**Author**: RizeOS Engineering Team Intern Assessment
