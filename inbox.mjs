// End-to-end replay test for the exam-results webhook inbox.
// Posts the same integration event twice and asserts the student receives one notification.
import crypto from 'node:crypto';

const MAIN = process.env.MAIN_API ?? 'http://localhost:18081';
const KEY = process.env.EXAM_INTEGRATION_KEY ?? 'dev-integration-key';

const call = async (path, body, token, method, headers = {}) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(MAIN + path, {
      method: method ?? (body !== undefined ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (r.status === 429 && attempt < 3) {
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      continue;
    }
    if (!r.ok) throw new Error(`${method ?? 'GET'} ${path}: ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
};
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures++;
};
const login = (email, password) => call('/api/auth/login',
  { email, password, tenantSlug: 'star-coaching' }, null, 'POST');

let failures = 0;
const admin = (await login('admin@star.local', 'Password123!')).accessToken;
const tenant = (await call('/api/auth/me', undefined, admin)).tenantId;

const email = `inbox-${crypto.randomUUID().slice(0, 8)}@star.local`;
const studentId = (await call('/api/users/invite', {
  email, firstName: 'Inbox', lastName: 'Replay', password: 'Password123!', roles: ['Student'],
}, admin)).id;
const student = (await login(email, 'Password123!')).accessToken;

const eventId = crypto.randomUUID();
const examId = crypto.randomUUID();
const payload = {
  tenantId: tenant, examId, candidateIds: [studentId], publishedCount: 1, eventId,
};
const first = await call('/api/integrations/exam-results', payload, null, 'POST', { 'X-Integration-Key': KEY });
const replay = await call('/api/integrations/exam-results', payload, null, 'POST', { 'X-Integration-Key': KEY });
check('both deliveries accepted', first.notified === 1 && replay.notified === 1);

const noteList = (r) => Array.isArray(r) ? r : (r?.items ?? []);
const notes = noteList(await call('/api/communication/notifications?pageSize=200', undefined, student));
const matching = notes.filter(n => n.type === 'exam.results_published' && n.body.includes(examId));
check('exactly one notification after replay', matching.length === 1, `count=${matching.length}`);

// A second event with a different id must produce a second notification.
const secondEvent = crypto.randomUUID();
await call('/api/integrations/exam-results', { ...payload, eventId: secondEvent }, null, 'POST', { 'X-Integration-Key': KEY });
const after = noteList(await call('/api/communication/notifications?pageSize=200', undefined, student));
check('distinct event is applied', after.filter(n => n.type === 'exam.results_published' && n.body.includes(examId)).length === 2);

console.log(failures === 0 ? 'inbox replay checks passed' : `${failures} inbox replay checks failed`);
process.exit(failures ? 1 : 0);
