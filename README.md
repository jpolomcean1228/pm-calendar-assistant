# PM Calendar Assistant

A prototype tool that connects to a project manager's calendar, identifies opportunities to save time, and either automates tasks via Claude or writes prep notes back to the calendar.

**Status:** Prototype with mock calendar data + live Claude API integration. Real calendar (Google / Outlook) integration not yet wired up.

---

## Quick start

1. Clone this repo:
   ```bash
   git clone https://github.com/<your-username>/<repo-name>.git
   cd <repo-name>
   ```
2. Open `index.html` in any modern browser — no build step, no install.
3. (Optional) Click **⚙ Add API key** in the top right, paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com/settings/keys), and hit Save. The app switches from canned mock suggestions to live Claude-generated ones.

Without a key, the prototype runs on canned mock suggestions so you can still demo the flow.

---

## What it does

- **Reads** a week of calendar events (currently mocked — see `MOCK_CALENDAR` in `index.html`).
- **Analyzes** the schedule with Claude and surfaces three kinds of suggestions:
  - **Automate** — tasks Claude can do for you (draft status updates, prioritize backlogs, compile pre-reads).
  - **Prep** — meeting prep notes Claude attaches to the event (1:1 talking points, account briefs).
  - **Protect** — schedule hygiene (duplicate meetings to decline, oversized invites, async candidates).
- **Writes back** to the calendar (currently a `console.log` stub — see `apply()` in `index.html`).
- **Tracks** time-back saved per applied suggestion.

---

## Architecture

Single-file HTML prototype. All state lives in plain JavaScript so each extension point can be swapped without restructuring.

### Extension points

Search `index.html` for these markers:

| Marker | What to swap in |
|---|---|
| `EXT:CALENDAR_SOURCE` | Real Google Calendar (`events.list`) or Microsoft Graph (`/me/calendar/events`) fetch. Keep the meeting shape. |
| `EXT:AI_ENGINE` | Already wired to Claude via the messages endpoint. Tweak `SYSTEM_PROMPT` to change suggestion behavior. |
| `EXT:WRITEBACK` | Currently `console.log`. Wire to `events.patch` (Google) or `PATCH /events/{id}` (Graph) to mutate real events. |
| `EXT:TEAM` | Owner field exists; extend to pull multiple team members' calendars. |

---

## Roadmap

- [x] **Step 0** — Single-file prototype with mock calendar + mock suggestions
- [x] **Step 1** — Live Claude API integration (browser-side, user-supplied key)
- [ ] **Step 2** — Google Calendar OAuth + read real events (requires backend)
- [ ] **Step 3** — Calendar write-back: update event descriptions with Claude's notes
- [ ] **Step 4** — Team calendar view (multiple owners)
- [ ] **Step 5** — Move API key from browser to backend; deploy

---

## Security notes

- The Anthropic API key is stored in browser `localStorage` and used to call `api.anthropic.com` directly from the frontend. This is **only acceptable for local prototyping with your own key**. It uses the `anthropic-dangerous-direct-browser-access` header, which exists precisely because doing this in production exposes your key to any user who opens DevTools.
- Before deploying anywhere others can reach, move the API call behind a backend proxy (planned in step 5).
- The `.gitignore` blocks `.env` files and key files. **Never paste a real API key into any committed file.** If a key is ever exposed, rotate it immediately at [console.anthropic.com](https://console.anthropic.com/settings/keys).

---

## Tech

- Frontend: vanilla HTML/CSS/JS, no build
- LLM: Claude Sonnet 4.6 via the messages endpoint
- No backend yet
# pm-calendar-assistant
