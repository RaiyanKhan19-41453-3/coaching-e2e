// Seeds realistic demo data into the main platform through its public API.
// Safe to re-run: existing codes/emails are detected and skipped.
const MAIN = process.env.MAIN_API ?? 'http://localhost:18081';

const call = async (path, body, token, method) => {
  const r = await fetch(MAIN + path, {
    method: method ?? (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method ?? 'GET'} ${path}: ${r.status} ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : null;
};
const idOf = v => typeof v === 'string' ? v : v?.id ?? v?.Id ?? null;
const login = async (email, password, slug) =>
  (await call('/api/auth/login', { email, password, tenantSlug: slug }, null, 'POST')).accessToken;

const stats = { created: 0, skipped: 0 };
const attempt = async (label, fn) => {
  try { await fn(); stats.created++; console.log(`+ ${label}`); }
  catch (e) {
    if (/already|conflict|duplicate|409/i.test(e.message)) { stats.skipped++; console.log(`= ${label} (already exists)`); }
    else { stats.skipped++; console.log(`! ${label}: ${e.message}`); }
  }
};

const token = await login('admin@star.local', 'Password123!', 'star-coaching');

// Academic year — batches require one.
let years = await call('/api/academic-years', undefined, token);
if (!years.length) await attempt('Academic year 2026-27', () => call('/api/academic-years',
  { name: '2026-27', startDate: '2026-07-01', endDate: '2027-06-30' }, token));
years = await call('/api/academic-years', undefined, token);
const yearId = years[0]?.id;

// Courses
const courseDefs = [
  ['SE-101', 'Software Engineering', 1, 12],
  ['MATH-201', 'Applied Mathematics', 2, 9],
  ['ENG-101', 'English Communication', 0, 6],
];
for (const [code, name, level, months] of courseDefs) {
  await attempt(`Course ${code}`, () => call('/api/courses',
    { code, name, description: `${name} — full coaching program`, level, durationMonths: months, isActive: true }, token));
}
const courses = await call('/api/courses', undefined, token);
const courseByCode = Object.fromEntries(courses.map(c => [c.code, c]));

// Users
const teacherDefs = [
  ['teacher.a@star.local', 'Karim', 'Ahmed', 'Teacher'],
  ['teacher.b@star.local', 'Nadia', 'Rahman', 'Teacher'],
  ['teacher.c@star.local', 'Tanvir', 'Hasan', 'Teacher'],
];
const studentDefs = Array.from({ length: 8 }, (_, i) => [
  `student${i + 1}@star.local`, ['Ayesha', 'Rahim', 'Sadia', 'Imran', 'Farah', 'Zahid', 'Mina', 'Arif'][i],
  ['Khan', 'Uddin', 'Akter', 'Hossain', 'Begum', 'Ali', 'Chowdhury', 'Islam'][i],
]);
const existingUsers = (await call('/api/users?pageSize=200', undefined, token)).items ?? [];
const userByEmail = Object.fromEntries(existingUsers.map(u => [u.email, u]));
for (const [email, first, last] of teacherDefs) {
  if (!userByEmail[email]) await attempt(`Teacher ${email}`, async () => {
    const r = await call('/api/users/invite',
      { email, firstName: first, lastName: last, phoneNumber: '01710000001', password: 'Password123!', roles: ['Teacher'] }, token);
    userByEmail[email] = { id: idOf(r), email };
  });
}
for (const [email, first, last] of studentDefs) {
  if (!userByEmail[email]) await attempt(`Student ${email}`, async () => {
    const r = await call('/api/users/invite',
      { email, firstName: first, lastName: last, phoneNumber: '01710000002', password: 'Password123!', roles: ['Student'] }, token);
    userByEmail[email] = { id: idOf(r), email };
  });
}
const teachers = teacherDefs.map(([e]) => userByEmail[e]).filter(u => u?.id);
const students = studentDefs.map(([e]) => userByEmail[e]).filter(u => u?.id);

// Batches + enrolments + teachers
const batchDefs = [
  ['SE-2026-A', 'Software Engineering — Batch A', 'SE-101'],
  ['MATH-2026-A', 'Applied Mathematics — Batch A', 'MATH-201'],
];
for (const [code, name, courseCode] of batchDefs) {
  if (!yearId || !courseByCode[courseCode]) continue;
  await attempt(`Batch ${code}`, () => call('/api/batches', {
    courseId: courseByCode[courseCode].id, academicYearId: yearId, termId: null,
    name, code, startDate: '2026-09-01', endDate: '2027-05-31', capacity: 30,
  }, token));
}
const batches = (await call('/api/batches?pageSize=50', undefined, token)).items ?? [];
const batchStudents = new Map();
for (const [i, batch] of batches.entries()) {
  batchStudents.set(batch.id, students.slice(i * 4, i * 4 + 4));
  for (const student of students.slice(i * 4, i * 4 + 4)) {
    await attempt(`Enrol ${student.email} in ${batch.code}`, () =>
      call(`/api/batches/${batch.id}/enrollments`, { studentId: student.id }, token));
  }
  if (teachers[i]) await attempt(`Assign teacher to ${batch.code}`, () =>
    call(`/api/batches/${batch.id}/teachers`, { teacherId: teachers[i].id, isLead: true }, token));
  await attempt(`Schedule rule for ${batch.code}`, () => call('/api/schedule-rules', {
    batchId: batch.id, dayOfWeek: 1 + i, startTime: '18:00:00', endTime: '20:00:00',
    validFrom: '2026-09-01', validTo: '2027-05-31', teacherId: teachers[i]?.id ?? null,
    roomId: null, topicId: null, recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
  }, token));
}

// Materialise sessions and mark attendance so the dashboard and timetable are populated.
const rules = await call('/api/schedule-rules', undefined, token);
for (const rule of rules) {
  await attempt(`Sessions for rule ${rule.id.slice(0, 8)}`, () =>
    call(`/api/schedule-rules/${rule.id}/sessions`, { from: '2026-09-01', to: '2026-10-31' }, token));
}
for (const batch of batches) {
  const timetable = await call(`/api/timetable?batchId=${batch.id}`, undefined, token);
  const rows = Array.isArray(timetable) ? timetable : (timetable.items ?? []);
  for (const session of rows.slice(0, 4)) {
    await attempt(`Attendance for ${batch.code} session ${session.id.slice(0, 8)}`, () =>
      call(`/api/sessions/${session.id}/attendance`, {
        records: (batchStudents.get(batch.id) ?? []).map((u, i) => ({
          studentId: u.id, status: i === 3 ? 2 : 1,
          minutesLate: i === 3 ? 12 : 0, note: null,
        })),
      }, token));
  }
}

// Rooms
for (const [name, code, type, capacity] of [
  ['Room 101', 'R101', 0, 40], ['Computer Lab', 'LAB-1', 1, 30], ['Main Hall', 'HALL', 2, 120],
]) await attempt(`Room ${code}`, () => call('/api/rooms',
  { name, code, type, capacity, building: 'Main block', floor: '1' }, token));

// Finance
const feeDefs = [
  ['Tuition — Software Engineering', 'TUITION-SE', 18000, 'SE-101'],
  ['Tuition — Mathematics', 'TUITION-MATH', 15000, 'MATH-201'],
];
for (const [name, code, amount, courseCode] of feeDefs) {
  if (!courseByCode[courseCode]) continue;
  await attempt(`Fee structure ${code}`, () => call('/api/fee-structures', {
    courseId: courseByCode[courseCode].id, batchId: null, name, code, amount, currency: 'BDT',
    frequency: 1, taxPercent: 0, effectiveFrom: '2026-07-01', effectiveTo: null,
  }, token));
}
const fees = await call('/api/fee-structures', undefined, token);
for (const [i, student] of students.slice(0, 5).entries()) {
  let invoiceId;
  await attempt(`Invoice for ${student.email}`, async () => {
    invoiceId = idOf(await call('/api/invoices', {
      studentId: student.id, enrollmentId: null,
      lines: [{ description: i % 2 ? 'Monthly tuition' : 'Admission + tuition', quantity: 1, unitPrice: 12000 + i * 500, currency: 'BDT' }],
      discount: i === 2 ? 1000 : 0, taxPercent: 0, discountCode: null,
    }, token));
  });
  if (invoiceId && i < 3) await attempt(`Payment for ${student.email}`, () =>
    call(`/api/invoices/${invoiceId}/payments`, { amount: 6000, currency: 'BDT', method: 0, gatewayTransactionId: null }, token));
}
for (const [code, name, type, value] of [['EARLY10', 'Early bird 10%', 0, 10], ['SIBLING500', 'Sibling discount', 1, 500]]) {
  await attempt(`Discount ${code}`, () => call('/api/discounts', {
    code, name, type, value, maxDiscountAmount: null, courseId: null,
    validFrom: '2026-07-01', validTo: '2027-06-30', usageLimit: 100,
  }, token));
}
for (const student of students.slice(0, 2)) await attempt(`Scholarship for ${student.email}`, () =>
  call('/api/scholarships', { studentId: student.id, name: 'Merit scholarship', type: 0, value: 25,
    startDate: '2026-09-01', endDate: '2027-05-31' }, token));

// CRM
const leadDefs = [
  ['Sadman', 'Islam', 'Website'], ['Jannat', 'Begum', 'Referral'],
  ['Rakib', 'Hossain', 'WalkIn'], ['Tahmina', 'Akter', 'SocialMedia'],
];
const leads = [];
for (const [first, last, source] of leadDefs) await attempt(`Lead ${first}`, async () => {
  const r = await call('/api/crm/leads', { firstName: first, lastName: last,
    email: `${first.toLowerCase()}@lead.local`, phoneNumber: '01715000000',
    source: ['Website', 'Referral', 'WalkIn', 'SocialMedia'].indexOf(source),
    assignedToId: teachers[0]?.id ?? null, courseId: courseByCode['SE-101']?.id ?? null,
    notes: 'Interested in the next intake' }, token);
  leads.push({ id: idOf(r), first });
});
for (const [i, lead] of leads.slice(0, 2).entries()) await attempt(`Application for ${lead.first}`, async () => {
  const r = await call('/api/crm/applications', { leadId: lead.id, courseId: courseByCode['SE-101']?.id,
    academicYearId: yearId, firstName: lead.first, lastName: 'Islam', email: `${lead.first.toLowerCase()}@lead.local`,
    phoneNumber: '01715000000', guardianName: 'Guardian', guardianPhone: '01716000000' }, token);
  const applicationId = idOf(r);
  if (i === 0) await attempt('Follow-up for application', () => call('/api/crm/follow-ups', {
    leadId: lead.id, applicationId, note: 'Call to confirm documents',
    scheduledAt: new Date(Date.now() + 86400000).toISOString() }, token));
});
await attempt('Lead follow-up', () => call('/api/crm/follow-ups', {
  leadId: leads[2]?.id ?? null, applicationId: null, note: 'Send course brochure',
  scheduledAt: new Date(Date.now() + 172800000).toISOString() }, token));

// Communication
const announcements = [
  ['Welcome to the new session', 'Classes begin on 1 September. Check your batch timetable.', 3],
  ['Midterm schedule published', 'Midterm assessments run from 12 to 19 October.', 2],
  ['Library hours extended', 'The reading room is now open until 9 PM on weekdays.', 1],
];
for (const [title, body, priority] of announcements) await attempt(`Announcement: ${title}`, () =>
  call('/api/communication/announcements', { title, body,
    targetAudienceJson: '{"roles":["Student","Teacher"]}', priority, isPinned: priority === 3 }, token));
for (const teacher of teachers.slice(0, 2)) await attempt(`Message to ${teacher.email}`, () =>
  call('/api/communication/messages', { conversationId: null, recipientId: teacher.id,
    body: 'Please review the new batch schedule before Friday.' }, token));

// Materials
for (const [title, type, url] of [
  ['Course outline — Software Engineering', 0, 'https://example.org/outline.pdf'],
  ['Week 1 lecture recording', 1, 'https://example.org/week1.mp4'],
  ['Practice problem set', 0, 'https://example.org/problems.pdf'],
  ['Reference: Clean Code', 2, 'https://example.org/clean-code'],
]) await attempt(`Material: ${title}`, () => call('/api/assets/materials', {
  batchId: batches[0]?.id ?? null, topicId: null, title, type, assetId: null,
  externalUrl: url, durationMinutes: type === 1 ? 55 : null, order: 0,
}, token));

console.log(`\nMain seed complete: ${stats.created} created, ${stats.skipped} skipped/existing.`);
