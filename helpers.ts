import crypto from 'node:crypto';

export const MAIN_API = process.env.MAIN_API ?? 'http://localhost:18081';
export const MAIN_WEB = process.env.MAIN_WEB ?? 'http://localhost:13000';
export const EXAM_API = process.env.EXAM_API ?? 'http://localhost:18090';
export const EXAM_WEB = process.env.EXAM_WEB ?? 'http://localhost:13010';
export const JWT_KEY = process.env.JWT_KEY ?? 'dev-only-signing-key-change-this-in-production-1234';
export const TENANT = '452a490f-157a-4859-a73f-bd41ffda6e6f';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

export function token(sub: string, role: string, tenant = TENANT, seconds = 3600): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ sub, tenant_id: tenant, email: `${sub}@e2e.local`, role: [role],
    exp: Math.floor(Date.now() / 1000) + seconds, iss: 'coaching-platform', aud: 'coaching-web' });
  return `${h}.${p}.${crypto.createHmac('sha256', JWT_KEY).update(`${h}.${p}`).digest('base64url')}`;
}

export async function api(base: string, path: string, accessToken: string, body?: unknown, method?: string) {
  const r = await fetch(`${base}${path}`, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

export async function mainAdminToken() {
  const r = await fetch(`${MAIN_API}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@star.local', password: 'Password123!', tenantSlug: 'star-coaching' }),
  });
  if (!r.ok) throw new Error(`main login failed: ${r.status}`);
  return (await r.json()).accessToken as string;
}
