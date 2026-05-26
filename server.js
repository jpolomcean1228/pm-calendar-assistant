// PM Calendar Assistant — backend server
// ---------------------------------------
// Step 2b: serves the frontend + accepts .ics file uploads.
// Parses the calendar into the same shape MOCK_CALENDAR uses.

const express = require('express');
const multer = require('multer');
const ical = require('node-ical');
const path = require('path');

const app = express();
const PORT = 3000;

// File upload config: keep files in memory (small, no disk needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB max
});

// Serve static files (index.html, etc.) from the project root
app.use(express.static(path.join(__dirname, '.')));
app.use(express.json());

// ============================================================
// POST /api/calendar/upload
// Accepts an .ics file, parses events for the requested week,
// returns them in the shape the frontend expects.
// ============================================================
app.post('/api/calendar/upload', upload.single('calendar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  // Optional weekOffset query param: 0 = this week, 1 = next, -1 = last
  const weekOffset = parseInt(req.query.weekOffset || '0', 10);

  let parsed;
  try {
    parsed = ical.sync.parseICS(req.file.buffer.toString('utf-8'));
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse .ics file: ' + err.message });
  }

  const { weekStart, weekEnd } = getWeekRange(weekOffset);
  const events = extractEvents(parsed, weekStart, weekEnd);

  res.json({
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
    eventCount: events.length,
    events
  });
});

// ============================================================
// Helpers
// ============================================================

// Returns Monday 00:00 and Saturday 00:00 of the target week
function getWeekRange(weekOffset) {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysFromMonday = (day + 6) % 7; // 0 if Mon, 6 if Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { weekStart: monday, weekEnd: saturday };
}

// Walk parsed ICS, extract VEVENTs in the target week, including
// expansion of recurring events.
function extractEvents(parsed, weekStart, weekEnd) {
  const events = [];

  for (const key of Object.keys(parsed)) {
    const item = parsed[key];
    if (item.type !== 'VEVENT') continue;

    // Handle recurring events: expand RRULE within the week
    if (item.rrule) {
      const occurrences = item.rrule.between(weekStart, weekEnd, true);
      for (const occ of occurrences) {
        // Check for exceptions (cancelled instances)
        if (isExcluded(item, occ)) continue;
        const duration = (item.end - item.start);
        const occEnd = new Date(occ.getTime() + duration);
        events.push(toEvent(item, occ, occEnd));
      }
    } else {
      // Non-recurring: include if it overlaps the week
      const start = item.start;
      const end = item.end || new Date(start.getTime() + 30 * 60 * 1000);
      if (start >= weekStart && start < weekEnd) {
        events.push(toEvent(item, start, end));
      }
    }
  }

  // Sort chronologically
  events.sort((a, b) => a._sortKey - b._sortKey);

  // Strip the sort key before returning
  return events.map(({ _sortKey, ...rest }) => rest);
}

function isExcluded(item, occurrence) {
  if (!item.exdate) return false;
  const occTime = occurrence.getTime();
  return Object.values(item.exdate).some(d => d.getTime() === occTime);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toEvent(item, start, end) {
  const durationMin = Math.round((end - start) / 60000);
  const attendees = countAttendees(item);
  const day = DAY_NAMES[start.getDay()];
  const time = `${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')}`;

  return {
    id: (item.uid || `event-${start.getTime()}`).slice(0, 64),
    title: String(item.summary || 'Untitled event').slice(0, 120),
    day,
    time,
    duration: durationMin,
    attendees,
    owner: 'self',          // .ics doesn't distinguish; default to self
    type: inferType(item),  // best-effort categorization
    _sortKey: start.getTime()
  };
}

function countAttendees(item) {
  if (!item.attendee) return 1;
  if (Array.isArray(item.attendee)) return item.attendee.length;
  return 1; // single attendee object
}

// Light-touch categorization based on title keywords.
// Mirrors the `type` values used in the mock data.
function inferType(item) {
  const title = (item.summary || '').toLowerCase();
  if (/1[:\s\-]?1|1on1|one.on.one/.test(title)) return '1on1';
  if (/sprint|planning|backlog/.test(title)) return 'planning';
  if (/status|standup|stand.up|update/.test(title)) return 'status';
  if (/review|roadmap/.test(title)) return 'review';
  if (/sync|coord/.test(title)) return 'sync';
  if (/retro/.test(title)) return 'retro';
  if (/all.hands|town.hall/.test(title)) return 'broadcast';
  if (/focus|block|deep.work/.test(title)) return 'focus';
  if (/external|customer|vendor|client/.test(title)) return 'external';
  return 'meeting';
}

// ============================================================
// Start
// ============================================================
app.listen(PORT, () => {
  console.log(`✓ Server running at http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop.`);
});
