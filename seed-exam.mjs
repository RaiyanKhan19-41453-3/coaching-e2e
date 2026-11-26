// Seeds the proctored exam service with exams, candidates, attempts, proctor events,
// evidence and reports so the examiner and proctor UIs have realistic data.
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const MAIN = process.env.MAIN_API ?? 'http://localhost:18081';
const EXAM = process.env.EXAM_API ?? 'http://localhost:18090';
const OUT = process.env.SEED_OUT ?? '/work/seed-exam.json';
const KEY = 'dev-only-signing-key-change-this-in-production-1234';
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

const call = async (base, path, body, token, method) => {
  const r = await fetch(base + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method ?? 'GET'} ${path}: ${r.status} ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : null;
};
const idOf = v => typeof v === 'string' ? v : v?.id ?? v?.Id ?? null;
const tokenFor = (sub, tenant) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, tenant_id: tenant, email: `${sub}@demo.local`, role: ['Student'],
    exp: Math.floor(Date.now() / 1000) + 7200, iss: 'coaching-platform', aud: 'coaching-web' });
  return `${h}.${p}.${crypto.createHmac('sha256', KEY).update(`${h}.${p}`).digest('base64url')}`;
};

const admin = (await call(MAIN, '/api/auth/login',
  { email: 'admin@star.local', password: 'Password123!', tenantSlug: 'star-coaching' }, null, 'POST')).accessToken;
const tenant = (await call(MAIN, '/api/auth/me', undefined, admin)).tenantId;

const ensureExam = async (title, settings) => {
  const exams = await call(EXAM, '/api/exams', undefined, admin);
  let exam = exams.find(e => e.title === title);
  if (!exam) {
    const id = idOf(await call(EXAM, '/api/exams', settings, admin));
    exam = { id, title };
    console.log(`+ Exam ${title}`);
  } else console.log(`= Exam ${title} exists`);
  return exam.id;
};

const questionDefs = [
  { type: 0, text: 'What is 2 + 2?', optionsJson: '[{"id":"a","text":"3"},{"id":"b","text":"4"},{"id":"c","text":"5"}]', correctAnswerJson: '{"value":"b"}', marks: 5, order: 1 },
  { type: 0, text: 'Which language compiles to bytecode for the JVM?', optionsJson: '[{"id":"a","text":"C"},{"id":"b","text":"Java"},{"id":"c","text":"Python"}]', correctAnswerJson: '{"value":"b"}', marks: 5, order: 2 },
  { type: 2, text: 'A binary search requires the input to be sorted.', optionsJson: null, correctAnswerJson: '{"value":true}', marks: 5, order: 3 },
  { type: 4, text: 'Explain the Pythagorean theorem in your own words.', optionsJson: null, correctAnswerJson: null, marks: 5, order: 4 },
  { type: 4, text: 'Describe a real-world use of Big-O notation.', optionsJson: null, correctAnswerJson: null, marks: 5, order: 5 },
];

const buildExam = async (title, duration, total) => {
  const id = await ensureExam(title, {
    title, durationMinutes: duration, totalMarks: total,
    requireCamera: false, requireMicrophone: false, lockTab: true,
    disableCopyPaste: true, aiEvaluationEnabled: true, requireIdentityVerification: false,
    instructions: 'Answer all questions. Leaving the tab or copying content is recorded as a proctor event.',
  });
  const detail = await call(EXAM, `/api/exams/${id}`, undefined, admin);
  for (const q of questionDefs.slice(0, title.startsWith('Mathematics') ? 5 : 3)) {
    if (detail.questions.some(x => x.text === q.text)) continue;
    await call(EXAM, `/api/exams/${id}/questions`, q, admin);
    console.log(`+ Question: ${q.text}`);
  }
  if (detail.status === 0) { await call(EXAM, `/api/exams/${id}/publish`, null, admin); console.log(`+ Published ${title}`); }
  return id;
};

const mainExamId = await buildExam('Mathematics Final', 60, 25);
await buildExam('Physics Quiz — Chapter 1', 30, 15);

const candidates = [
  ['Ayesha Khan', 'Mathematics Final'],
  ['Rahim Uddin', 'Mathematics Final'],
  ['Sadia Akter', 'Mathematics Final'],
];
let first = null;
for (const [name] of candidates) {
  const candidateId = crypto.randomUUID();
  const candToken = tokenFor(candidateId, tenant);
  const asg = await call(EXAM, '/api/candidates/assign', {
    examId: mainExamId, candidateId, candidateName: name, candidateEmail: `${candidateId}@demo.local`,
  }, admin);
  await call(EXAM, `/api/candidate/consent?assignmentId=${asg.assignmentId}&accepted=true`, null, candToken, 'POST');
  const started = await call(EXAM, `/api/attempts?examId=${mainExamId}`,
    { token: asg.attemptToken, ipAddress: '203.0.113.42', clientMode: 0, attestationJson: null }, candToken);
  const attemptId = started.attemptId;
  const questions = await call(EXAM, `/api/attempts/${attemptId}/questions`, undefined, candToken);
  for (const q of questions) {
    const value = q.type === 0 ? 'b' : q.type === 2 ? 'true' : `A clear explanation for question ${q.order}.`;
    await call(EXAM, `/api/attempts/${attemptId}/answers`,
      { questionId: q.questionId ?? q.id, responseJson: JSON.stringify({ value }) }, candToken);
  }
  const events = [
    { type: 2, severity: 3, detailJson: '{"source":"browser"}', snapshotKey: null },
    { type: 4, severity: 4, detailJson: '{"text":"copied question"}', snapshotKey: null },
    { type: 6, severity: 2, detailJson: '{}', snapshotKey: null },
  ];
  for (const e of events) await call(EXAM, `/api/attempts/${attemptId}/events`, e, candToken);
  await call(EXAM, `/api/proctor/attempts/${attemptId}/context`, {
    ipAddress: '203.0.113.42', userAgent: 'Mozilla/5.0 (Demo Browser)',
    deviceFingerprint: `fp-${candidateId.slice(0, 6)}`, countryCode: 'BD', city: 'Dhaka',
  }, admin);
  await call(EXAM, `/api/evidence/attempts/${attemptId}`, {
    kind: 0, contentType: 'image/png', sizeBytes: 48, checksum: null,
    detailJson: '{"source":"demo-capture"}', dataBase64: Buffer.from('demo-snapshot-frame').toString('base64'),
  }, candToken);
  await call(EXAM, `/api/attempts/${attemptId}/submit`, null, candToken);
  const report = await call(EXAM, `/api/attempts/${attemptId}/report`, null, admin);
  console.log(`+ Attempt + report for ${name}: ${report.reportId?.slice(0, 8)}`);
  if (!first) first = { examId: mainExamId, attemptId, candidateToken: candToken,
    assignmentId: asg.assignmentId, attemptToken: asg.attemptToken, reportId: report.reportId, candidateName: name };
}
await call(EXAM, `/api/proctor/exams/${mainExamId}/detect`, null, admin);
const flags = await call(EXAM, `/api/proctor/exams/${mainExamId}/flags`, undefined, admin);
for (const flag of flags.slice(1)) {
  await call(EXAM, `/api/proctor/flags/${flag.id}/review?reviewed=true`, null, admin);
}
console.log(`+ Anomaly detection run (${flags.length} flags, ${Math.max(flags.length - 3, 0)} reviewed)`);
await call(EXAM, `/api/reports/exams/${mainExamId}/publish?includeFlagged=false`, null, admin);
console.log('+ Results published');

// A fresh, unused assignment for screenshots (attempt tokens are single-use).
const shotId = crypto.randomUUID();
const shotToken = tokenFor(shotId, tenant);
const shotAsg = await call(EXAM, '/api/candidates/assign', {
  examId: mainExamId, candidateId: shotId, candidateName: 'Demo Candidate',
  candidateEmail: `${shotId}@demo.local`,
}, admin);
await call(EXAM, `/api/candidate/consent?assignmentId=${shotAsg.assignmentId}&accepted=true`, null, shotToken, 'POST');
await writeFile(OUT, JSON.stringify({
  examId: mainExamId, attemptId: first.attemptId, reportId: first.reportId,
  candidateToken: shotToken, assignmentId: shotAsg.assignmentId, attemptToken: shotAsg.attemptToken,
}, null, 2));
console.log(`\nExam seed complete. Seed data written to ${OUT}`);
