import { test, expect } from '@playwright/test';
import { EXAM_API, EXAM_WEB, MAIN_API, mainAdminToken, api, token } from '../helpers';

test('exam service: candidate takes an MCQ exam and gets an AI-assisted report', async ({ page }) => {
  const examiner = await mainAdminToken();
  const candidateId = crypto.randomUUID();
  const candidate = token(candidateId, 'Student');
  const exam = await api(EXAM_API, '/api/exams', examiner, {
    title: `E2E exam ${Date.now()}`, durationMinutes: 30, totalMarks: 1,
    requireCamera: false, requireMicrophone: false, lockTab: false,
    disableCopyPaste: false, aiEvaluationEnabled: false, requireIdentityVerification: false,
  });
  await api(EXAM_API, `/api/exams/${exam.id}/questions`, examiner, {
    type: 0, text: '2 + 2 = ?', optionsJson: '[{"id":"a","text":"3"},{"id":"b","text":"4"}]',
    correctAnswerJson: '{"value":"b"}', marks: 1, order: 1,
  });
  await api(EXAM_API, `/api/exams/${exam.id}/publish`, examiner, null, 'POST');
  const assignment = await api(EXAM_API, '/api/candidates/assign', examiner, {
    examId: exam.id, candidateId, candidateName: 'E2E Candidate', candidateEmail: `${candidateId}@e2e.local`,
  });
  await api(EXAM_API, `/api/candidate/consent?assignmentId=${assignment.assignmentId}&accepted=true`, candidate, null, 'POST');

  await page.addInitScript((t) => localStorage.setItem('exam-token', t), candidate);
  await page.goto(`${EXAM_WEB}/take`);
  await page.getByLabel('Exam ID').fill(exam.id);
  await page.getByLabel('Attempt token').fill(assignment.attemptToken);
  await page.getByLabel('Assignment ID').fill(assignment.assignmentId);
  await page.getByRole('button', { name: 'Load exam' }).click();
  await page.getByRole('button', { name: 'Start attempt' }).click();
  await expect(page.getByText('2 + 2 = ?')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('radio', { name: '4' }).check();
  await page.getByRole('button', { name: 'Submit exam' }).click();
  await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible({ timeout: 20_000 });
  await api(EXAM_API, `/api/reports/exams/${exam.id}/publish`, examiner, null, 'POST');
  const result = await api(EXAM_API, `/api/reports?examId=${exam.id}`, examiner);
  expect(result.length).toBe(1);
});
