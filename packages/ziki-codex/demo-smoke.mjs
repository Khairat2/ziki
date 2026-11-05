import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=process.argv[2]||'https://ziki-codex-workspace-demo.vercel.app';
 const response=await page.goto(url);assert.equal(response.status(),200);await page.waitForSelector('#install');
 await page.locator('#install').click();await page.locator('#authorize').click();await page.locator('#ensure').click();
 assert.equal(await page.locator('.agent').count(),2);const ids=await page.locator('.agent small').allTextContents();
 await page.locator('#new-chat').click();await page.locator('#ensure').click();assert.deepEqual(await page.locator('.agent small').allTextContents(),ids);
 await page.locator('#workspace').selectOption('Ziki');assert.equal(await page.locator('.agent').count(),0);await page.locator('#ensure').click();assert.equal(await page.locator('.agent').count(),2);
 await page.locator('#workspace').selectOption('Zedu');assert.deepEqual(await page.locator('.agent small').allTextContents(),ids);
 await page.locator('#briefing').click();await page.locator('#activity').click();assert.match(await page.locator('#events').innerText(),/Checked workspace/);
 await page.reload();assert.deepEqual(await page.locator('.agent small').allTextContents(),ids);
 mkdirSync('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/codex-plugin-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'docs/screenshots/codex-plugin-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);console.log('PASS: public HTTPS, install, simulated consent, two agents, repeat reuse, new chat, workspace isolation, notes, activity, reload persistence, mobile width, zero browser errors.');
} finally {await browser.close();}
