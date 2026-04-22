# TextQuest MVP

Super lightweight proof-of-concept that turns textbook excerpts into RPG blueprints and narrative hooks using Groq LLMs. It mirrors the PRD flow (processing pipeline -> RPG generator -> front-end dashboard) with a minimal Node/Express backend and a vanilla Web UI.

## Features

- Upload/paste textbook text, optionally specify a focus/grade level.
- Backend calls Groq (OpenAI compatible API) to extract levels, quests, vocabulary, and assessments.
- Separate endpoint crafts lore/NPC hooks/encounters grounded in the structured data.
- Front-end renders the blueprint as cards plus a narrative layer preview.
- Built-in mock responses keep the UI usable even without a Groq key (clearly marked as mock).

## Tech Stack

- **Backend:** Node.js, Express, Groq chat completions API
- **Frontend:** Vanilla JS + CSS served as static assets
- **Env:** `.env` for `GROQ_API_KEY`, optional `GROQ_MODEL` and `PORT`

## Getting Started

1. Install dependencies
   ```bash
   npm install
   ```
2. Configure environment
   - Copy `.env.example` -> `.env`
   - Fill in `GROQ_API_KEY` from [console.groq.com](https://console.groq.com/)
   - Optionally adjust `GROQ_MODEL` or `PORT`
3. Run the server
   ```bash
   npm start
   ```
4. Visit `http://localhost:3000` to use the UI.

> Without a Groq key, the API returns clearly labeled mock data so the flow remains testable.

## API Overview

| Endpoint          | Body                                                             | Result                                              |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `POST /api/process`  | `{ text, title?, focus? }`                                        | Structured `levels`, `quests`, `vocabulary`, `assessments` |
| `POST /api/narrative` | `{ structured, learningGoal? }`                                  | Narrative layer with `introduction`, `regions`, `encounters`, `rewards` |
| `GET /api/health`    | -                                                              | Basic status ping                                   |

Responses include `via` (`groq` vs `mock`) so the UI can display provenance.

## Customizing

- Tune prompts or add new slices of metadata inside `server.js`.
- Swap the front-end for React/Unity later - only JSON contracts need to stay stable.
- Add persistence or queueing behind the `/api/process` route to scale ingestion.
