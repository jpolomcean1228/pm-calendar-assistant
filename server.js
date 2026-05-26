// PM Calendar Assistant — backend server
// ---------------------------------------
// Step 2c (revised): serves the frontend and parses .ics uploads.
// Claude analysis happens via copy/paste with claude.ai — no API
// key needed on the server. .env is no longer required.

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
app.use(express.json({ limit: '1mb' }));

// ============================================================
// POST /api/calendar/upload
// Accepts an .ics file, parses events for the requested week,
// returns them in the shape the frontend expects.
// ============================================================
app.post('/api/calendar/upload', upload.single('calendar'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

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
// Helpers — .ics parsing
// ============================================================

function getWeekRange(weekOffset) {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = (day + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysFromMonday + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);
  return { weekStart: monday, weekEnd: saturday };
}

function extractEvents(parsed, weekStart, weekEnd) {
  const events = [];
  for (const key of Object.keys(parsed)) {
    const item = parsed[key];
    if (item.type !== 'VEVENT') continue;

    // Filter cancelled events
    if (item.status === 'CANCELLED') continue;

    // Filter all-day events (start at midnight + duration is multiple of 24h)
    if (isAllDay(item)) continue;

    if (item.rrule) {
      const occurrences = item.rrule.between(weekStart, weekEnd, true);
      for (const occ of occurrences) {
        if (isExcluded(item, occ)) continue;
        const duration = (item.end - item.start);
        const occEnd = new Date(occ.getTime() + duration);
        const event = toEvent(item, occ, occEnd);
        if (event.duration >= MIN_DURATION_MIN) events.push(event);
      }
    } else {
      const start = item.start;
      const end = item.end || new Date(start.getTime() + 30 * 60 * 1000);
      if (start >= weekStart && start < weekEnd) {
        const event = toEvent(item, start, end);
        if (event.duration >= MIN_DURATION_MIN) events.push(event);
      }
    }
  }
  events.sort((a, b) => a._sortKey - b._sortKey);
  return events.map(({ _sortKey, ...rest }) => rest);
}

// Detect all-day events: start at exact midnight + duration is a whole-day multiple
function isAllDay(item) {
  if (!item.start || !item.end) return false;
  const startMs = item.start.getTime();
  const endMs = item.end.getTime();
  const durMs = endMs - startMs;
  const dayMs = 24 * 60 * 60 * 1000;
  const startsAtMidnight = item.start.getHours() === 0 && item.start.getMinutes() === 0;
  const wholeDayDuration = durMs > 0 && (durMs % dayMs === 0);
  // Also catch ICS 'datetype' === 'date' marker if present
  if (item.datetype === 'date') return true;
  return startsAtMidnight && wholeDayDuration;
}

// Minimum meeting duration to surface — filters out 5-min standup placeholders, etc.
const MIN_DURATION_MIN = 10;

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
    owner: 'self',
    type: inferType(item),
    _sortKey: start.getTime()
  };
}

function countAttendees(item) {
  if (!item.attendee) return 1;
  const list = Array.isArray(item.attendee) ? item.attendee : [item.attendee];
  if (list.length === 0) return 1;
  // Dedupe by the underlying email/URI (organizer often appears in attendee list too)
  const seen = new Set();
  for (const a of list) {
    const key = (a && (a.val || a.params?.CN || String(a))) || '';
    seen.add(key.toLowerCase());
  }
  // Always count the user themselves, even if not in the list
  return Math.max(seen.size, 1);
}

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
