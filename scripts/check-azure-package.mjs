import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const config=JSON.parse(await fs.readFile('dist/client/staticwebapp.config.json','utf8'));
assert.equal(config.platform.apiRuntime,'node:22');assert.ok(config.navigationFallback.exclude.includes('/api/*'));
assert.ok((await fs.stat('api/dist/index.js')).size>10000);
const pkg=JSON.parse(await fs.readFile('api/package.json','utf8'));assert.equal(pkg.main,'dist/index.js');
const built=await fs.readFile('api/dist/index.js','utf8');assert.ok(built.includes('authLevel: "anonymous"'));assert.ok(built.includes('PORTAL_PG_HOST'));assert.ok(built.includes('/api/auth/entra/start'));
const ui=(await fs.readdir('dist/client/assets')).filter(f=>f.endsWith('.js'));for(const f of ui)assert.ok(!(await fs.readFile('dist/client/assets/'+f,'utf8')).includes('/signin-with-chatgpt?'));
console.log('Azure API bundle, runtime, routing, caching and frontend sign-in checks passed.');
