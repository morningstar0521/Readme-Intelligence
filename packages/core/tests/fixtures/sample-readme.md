<h1 align="center">TaskFlow</h1>

[![Build](https://github.com/acme/taskflow/actions/workflows/ci.yml/badge.svg)](https://github.com/acme/taskflow/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=nextdotjs)

TaskFlow is a self-hosted task board for small teams, with real-time updates, keyboard-first navigation and a REST API.

![Screenshot of the TaskFlow board](docs/screenshot.png)

> [!NOTE]
> TaskFlow is in beta. Expect breaking changes before 1.0.

## Features

- :rocket: Real-time board updates over WebSockets
- **Keyboard-first** navigation with command palette
- Role-based access control
  - Owner, editor and viewer roles
- Markdown descriptions with syntax highlighting

## Tech Stack

| Layer    | Technology              |
| -------- | ----------------------- |
| Frontend | Next.js, React, Tailwind CSS |
| Backend  | Node.js, Express        |
| Database | PostgreSQL with Prisma  |
| Auth     | NextAuth.js             |

## Prerequisites

- Node.js 20+
- pnpm 9
- Docker (for the local database)

## Installation

1. Clone the repository

   ```bash
   git clone https://github.com/acme/taskflow.git
   cd taskflow
   ```

2. Install dependencies

   ```bash
   pnpm install
   ```

3. Copy the environment file and fill in the values

   ```bash
   cp .env.example .env
   ```

4. Start the database and run migrations

   ```bash
   docker compose up -d db
   pnpm prisma migrate dev
   ```

## Configuration

```env
# Postgres connection string (required)
DATABASE_URL=postgresql://taskflow:taskflow@localhost:5432/taskflow
# Secret used to sign sessions
NEXTAUTH_SECRET=4f9a8c2e1b7d6a5f3e2c1b0a9f8e7d6c
OPENAI_API_KEY=sk-abc123def456ghi789
PORT=3000 # optional, defaults to 3000
```

| Variable        | Required | Description                         |
| --------------- | -------- | ----------------------------------- |
| `GITHUB_ID`     | No       | GitHub OAuth app client id          |
| `SMTP_PASSWORD` | Yes      | Password for the outgoing mail server |

## Usage

Start the development server:

```bash
pnpm dev
```

Open http://localhost:3000 and sign in.

## API

### `GET /api/tasks`

Returns all tasks for the current board. Requires a bearer token.

Response:

```json
[{ "id": 1, "title": "Write docs", "done": false }]
```

### `POST /api/tasks`

Creates a task.

Request body:

```json
{ "title": "New task" }
```

| Method | Endpoint          | Description        |
| ------ | ----------------- | ------------------ |
| DELETE | `/api/tasks/:id`  | Delete a task      |

## Testing

```bash
pnpm test
pnpm lint
```

## Deployment

- Push to `main` and Vercel deploys automatically.
- Run the database on Railway or any managed PostgreSQL.

```bash
vercel --prod
```

## Contributing

Pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and open an [issue](https://github.com/acme/taskflow/issues) first.

Live demo: [taskflow.vercel.app](https://taskflow.vercel.app) · Docs: [documentation](https://docs.taskflow.dev) · Chat on [Discord](https://discord.gg/taskflow) · Watch the [video walkthrough](https://youtu.be/dQw4w9WgXcQ)

## License

MIT. See [LICENSE](LICENSE).
