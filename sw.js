// ── תזכורות חכמות — Service Worker ──
// גרסה: 1.0
// מקבל רשימת משימות מהדף, מתזמן התראות, ומפעיל אותן גם כשהדפדפן סגור.

const SW_VERSION = '1.0';
const STORE_KEY  = 'sw_scheduled_tasks';

// ── Install & Activate ──
self.addEventListener('install',  e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

// ── Receive task list from main page ──
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'SCHEDULE') return;
  const tasks = e.data.tasks || [];
  scheduleTasks(tasks);
});

// ── Internal: keep a timer map ──
// ServiceWorker can be killed and revived, so we persist to IndexedDB-like storage.
// For simplicity we use a module-level Map (works for Chrome Android which keeps SW alive).
const timers = new Map(); // taskId -> timeoutId

function scheduleTasks(tasks) {
  const now = Date.now();

  // Cancel timers for tasks no longer in the list
  const incoming = new Set(tasks.map(t => t.id));
  for (const [id, tid] of timers) {
    if (!incoming.has(id)) { clearTimeout(tid); timers.delete(id); }
  }

  tasks.forEach(task => {
    const fireAt = new Date(task.deadline).getTime();
    const diff   = fireAt - now;

    // Skip past or too-far tasks (> 7 days — reschedule when closer)
    if (diff <= 0 || diff > 7 * 24 * 3600 * 1000) return;

    // Clear any existing timer for this task
    if (timers.has(task.id)) { clearTimeout(timers.get(task.id)); }

    // 1-minute warning
    const warnDiff = diff - 60 * 1000;
    if (warnDiff > 0) {
      setTimeout(() => fireWarning(task), warnDiff);
    }

    // Main notification at deadline
    const tid = setTimeout(() => fireNotification(task), Math.max(0, diff));
    timers.set(task.id, tid);
  });
}

function fireWarning(task) {
  self.registration.showNotification('⚡ דקה אחת עד: ' + task.title, {
    body: 'התזכורת שלך מגיעה בעוד דקה',
    icon: buildIcon('⚡', '#e09030'),
    tag:  task.id + '_warn',
    silent: true,
    data: { taskId: task.id }
  });
}

function fireNotification(task) {
  timers.delete(task.id);
  self.registration.showNotification('⏰ ' + task.title, {
    body:    'הגיע הזמן! לחץ לפתיחה',
    icon:    buildIcon('⏰', '#f0c040'),
    badge:   buildIcon('⏰', '#f0c040'),
    tag:     task.id,
    requireInteraction: true,
    vibrate: [200, 100, 200, 100, 400],
    actions: [
      { action: 'done',   title: '✓ סיימתי' },
      { action: 'snooze', title: '😴 10 דק׳' }
    ],
    data: { taskId: task.id, deadline: task.deadline, title: task.title }
  });
}

// ── Notification click handler ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { taskId, title } = e.notification.data || {};

  if (e.action === 'done') {
    // Mark done via postMessage to open clients
    broadcastToClients({ type: 'MARK_DONE', taskId });
    return;
  }

  if (e.action === 'snooze') {
    broadcastToClients({ type: 'SNOOZE', taskId });
    return;
  }

  // Default: open / focus the app
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing window if open
      const existing = clients.find(c => c.url.includes('reminders'));
      if (existing) return existing.focus();
      // Otherwise open a new window
      return self.clients.openWindow('./reminders.html');
    })
  );
});

// ── Broadcast to all open app windows ──
async function broadcastToClients(msg) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(c => c.postMessage(msg));
}

// ── Helper: generate a tiny SVG icon as data URL ──
function buildIcon(emoji, bg) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <rect width="64" height="64" rx="14" fill="${bg}22"/>
    <text x="32" y="46" text-anchor="middle" font-size="40">${emoji}</text>
  </svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
