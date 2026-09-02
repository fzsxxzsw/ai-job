# Job Helper Agent

This is the Python Agent sidecar for Job Helper. Phase 1 is deliberately read-only:

- listens on `127.0.0.1:9101`;
- compiles one deterministic LangGraph `StateGraph` during FastAPI startup;
- exposes liveness, readiness, and keyword-based job decisions;
- does not call an LLM, Java, MySQL, Chrome, BOSS, or any action API;
- does not use a checkpointer yet. Checkpoint, interrupt/resume, and the action Outbox are later phases.

Keyword policy treats Chinese text and phrases as substring matches. Every single ASCII technology token uses ASCII word boundaries, including `python`, `C++`, `.NET`, `Node.js`, and hyphenated names; `python` therefore does not match `cpython`, while `Python开发` still matches next to Chinese text. Requests are bounded to a 300-character title, a 20,000-character description, and at most 50 keywords per list (100 characters each).

## Local development

Python 3.12 and [uv](https://docs.astral.sh/uv/) are required.

```powershell
uv sync --frozen
uv run pytest
uv run uvicorn job_helper_agent.main:app --host 127.0.0.1 --port 9101
```

Read-only endpoints:

- `GET /health/live`
- `GET /health/ready`
- `POST /api/v1/job-decisions`

Example decision request:

```json
{
  "title": "Python Backend Engineer",
  "description": "Build FastAPI services",
  "excluded_keywords": ["outsourcing"],
  "required_keywords": ["python"]
}
```

The result is one of `REJECT`, `REVIEW`, or `MATCH`. It contains evidence and a policy version, and never contains a browser action.
