import { chromium } from '@playwright/test';
const MAIN='http://localhost:18081';
const call=async(path,body,token,method)=>{const r=await fetch(MAIN+path,{method:method??(body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();if(!r.ok)throw new Error(`${r.status} ${t}`);return t?JSON.parse(t):null;};
const OUT=process.env.MAIN_SHOT_DIR ?? '/main';

const slug='showcase-'+Date.now().toString().slice(-6);
await call('/api/auth/register-tenant',{name:'Showcase Academy',slug,adminEmail:`admin@${slug}.local`,adminPassword:'Password123!',adminFirstName:'Ada',adminLastName:'Lovelace'});
const token=(await call('/api/auth/login',{email:`admin@${slug}.local`,password:'Password123!',tenantSlug:slug})).accessToken;

const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:1280,height:820}});
await page.goto('http://localhost:13000/');
await page.getByLabel('Email').fill(`admin@${slug}.local`);
await page.locator('input[type=password]').fill('Password123!');
await page.getByLabel('Tenant slug').fill(slug);
await page.getByRole('button',{name:'Sign in'}).click();
await page.getByRole('heading',{name:'Overview'}).waitFor();
await page.screenshot({path:`${OUT}/main-dashboard.png`});

// Live SignalR notifications
await page.goto('http://localhost:13000/notifications');
await page.getByRole('heading',{name:'Notifications'}).waitFor();
await page.getByText('connected',{exact:true}).waitFor({timeout:20000});
await call('/api/communication/announcements',{title:'Welcome to Showcase Academy',body:'Your classes start Monday.',targetAudienceJson:'{"roles":["Admin"]}',priority:2,isPinned:true},token);
await page.getByText('Welcome to Showcase Academy').waitFor({timeout:30000});
await page.screenshot({path:`${OUT}/main-notifications.png`});

// Presigned file upload / materials
await page.goto('http://localhost:13000/files');
await page.locator('input[type=file]').setInputFiles({name:'Course-outline.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 demo outline')});
await page.getByRole('button',{name:'Upload'}).click();
await page.getByText('Course-outline.pdf').waitFor({timeout:20000});
await page.screenshot({path:`${OUT}/main-files.png`});

await browser.close();
console.log('clean main screenshots captured');
