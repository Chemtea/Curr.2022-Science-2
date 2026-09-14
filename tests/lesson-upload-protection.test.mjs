import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { transformQuiz } from '../shared/protect-quizzes.mjs';

const source = (await readFile(new URL('../backend_source/lesson-upload-api/index.ts', import.meta.url), 'utf8'))
  .replace(/^import \{ transformQuiz \} from .*;$/m, '');
const context = vm.createContext({ TextEncoder, TextDecoder, URL, Request, Response, Headers, AbortController,
  AbortSignal, setTimeout, clearTimeout, crypto: webcrypto, atob, btoa, structuredClone,
  fetch: async () => { throw new Error('Unexpected real network call'); }, Deno: { serve() {} },
  transformQuiz });
vm.runInContext(source + '\n globalThis.testAPI = {buildPlan, readCatalog, createHandler, GithubRepository, GithubError, ProtectedStore};', context);
const { buildPlan, readCatalog, createHandler, GithubRepository, GithubError, ProtectedStore } = context.testAPI;
const hash = text => createHash('sha256').update(text).digest('hex');
const token = 'adm_' + 'a'.repeat(96);
const originalMarker = 'PRIVATE_FIXTURE_BODY_DO_NOT_PUBLISH';
const html = `<!doctype html><html><head><title>차시</title><script>const THIS_UNIT_KEY='unit8'; const THIS_LESSON_ID='u8_l3';</script></head><body>${originalMarker}</body></html>`;
const input = { operation: 'create', fileName: 'lesson.html', html, unitKey: 'unit8', lessonId: 'u8_l3', lessonOrder: 3, title: '차시 제목' };

function snapshot({ replace = false, teacher = false } = {}) {
  const lessons = replace ? [{ id: 'u8_l3', file: 'lesson.html', title: '기존 차시', chasi: '3차시', adminOnly: teacher, isLocked: true }] : [];
  const index = `/* AUTO_CATALOG_CURRICULUM_START */ const defaultCurriculum = ${JSON.stringify({unit8:{title:'8단원',lessons}})}; /* AUTO_CATALOG_CURRICULUM_END */
/* AUTO_CATALOG_WORKSHEETS_START */ const worksheetCurriculum = {"units":[]}; /* AUTO_CATALOG_WORKSHEETS_END */`;
  const texts = new Map([['index.html',index],['curriculum-settings.json','{"units":{}}']]);
  if (replace) texts.set('lesson.html', `<html><head><script>window.PROTECTED_LESSON_REVISION = "${hash('OLD_PRIVATE_BODY')}";</script></head><body>보호된 차시</body></html>`);
  return {headSha:'a'.repeat(40),treeSha:'b'.repeat(40),sourceIndex:index,settings:{units:{}},texts,
    files:new Map([...texts.keys()].map(path => [path,{mode:'100644',sha:'a'.repeat(40),size:texts.get(path).length}]))};
}

function fixture(options = {}) {
  const events = [];
  const old = options.replace ? { asset_path:'lesson.html', source_sha256:hash('OLD_PRIVATE_BODY'), content_html:'OLD_PRIVATE_BODY' } : null;
  const stages = new Map();
  const store = {
    active: old, failStage: false, failActivation: false,
    async get(id) { const row = stages.get(id); return row ? structuredClone(row) : null; },
    async byCommit(sha) { const row = [...stages.values()].find(row => row.git_commit_sha === sha); return row ? structuredClone(row) : null; },
    async stage(id,asset,stub,expectedRevision) {
      events.push('stage'); if(this.failStage) throw new Error('Database unavailable');
      if((this.active?.source_sha256 || null) !== expectedRevision) throw new Error('Previous revision pending');
      if(!stages.has(id)) stages.set(id,{...structuredClone(asset),review_id:id,public_stub_sha256:hash(stub),expected_source_sha256:this.active?.source_sha256 || null});
      return this.get(id);
    },
    async recordCommit(id,sha) { events.push('record'); stages.get(id).git_commit_sha = sha; },
    async activate(id) {
      events.push('activate'); if(this.failActivation) throw new Error('Database unavailable');
      const stage = stages.get(id);
      if(stage.activated_at) return true;
      if((this.active?.source_sha256 || null) !== stage.expected_source_sha256 && this.active?.source_sha256 !== stage.source_sha256) throw new Error('CAS conflict');
      this.active = structuredClone(stage); stage.activated_at = new Date().toISOString(); return true;
    }
  };
  const github = {
    state:snapshot(options),calls:0,mode:'success',published:new Set(),
    async readSnapshot() { return this.state; },
    async containsCommit(sha) { return this.published.has(sha); },
    async getStatus(sha) { return {commitSha:sha,state:'success'}; },
    async commitFiles(args) {
      this.calls++; events.push('git'); this.lastFiles = structuredClone(args.files);
      const commitSha = 'c'.repeat(40);
      await args.onPreparedCommit(commitSha);
      if(this.mode === 'failure') throw new GithubError(409,'conflict','Conflicting repository write');
      for(const file of args.files) {
        this.state.texts.set(file.path,file.content);
        this.state.files.set(file.path,{mode:'100644',sha:commitSha,size:file.content?.length || 0});
      }
      this.state.headSha = commitSha; this.published.add(commitSha);
      if(this.mode === 'unknown') {
        const error = new GithubError(409,'commit_unknown','Unknown result'); error.commitSha = commitSha; throw error;
      }
      return {commitSha};
    }
  };
  const fetchImpl = async (_url,options) => {
    const body = JSON.parse(options.body);
    return Response.json({success:true,ok:true,adminSessionToken:body.adminKey});
  };
  const env = name => ({SUPABASE_URL:'https://jypvtvvozxmsposxllri.supabase.co',LESSON_GITHUB_TOKEN:'fixture-github-token-long-enough',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key-long-enough'}[name]);
  const makeHandler = () => createHandler({env,fetchImpl,repoFactory:() => github,storeFactory:() => store});
  let handler = makeHandler();
  async function call(data) {
    const result = await handler(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminKey:token,...data})}));
    return {status:result.status,body:await result.json()};
  }
  const payload = {...input,...(options.replace ? {operation:'replace'} : {})};
  return {github,store,events,stages,payload,call,restart(){handler=makeHandler();}};
}

test('public plan contains only metadata and loader; original stays in protectedAsset', async () => {
  const plan = await buildPlan(snapshot(), input);
  assert.equal(plan.summary.lockedByDefault,true);
  assert.equal(plan.summary.protectedContent,true);
  assert.ok(plan.protectedAsset.original_html.includes(originalMarker));
  assert.equal(plan.protectedAsset.source_sha256,hash(plan.protectedAsset.original_html));
  assert.equal(plan.protectedAsset.audience,'lesson');
  assert.equal(plan.files.length,2);
  assert.ok(plan.files[0].content.includes('protected-content.js'));
  assert.ok(plan.files[0].content.includes('window.PROTECTED_LESSON_PATH = "lesson.html"'));
  assert.ok(plan.files[0].content.includes('const THIS_UNIT_KEY = "unit8"'));
  assert.ok(!JSON.stringify(plan.files).includes(originalMarker));
  assert.ok(!JSON.stringify(plan.summary).includes(originalMarker));
  const after = snapshot(); after.texts.set('lesson.html',plan.files[0].content); after.files.set('lesson.html',{mode:'100644'});
  const catalog = readCatalog(after);
  assert.equal(catalog.lessons.find(row => row.file === 'lesson.html').id,'u8_l3');
});

test('teacher audience and legacy identity survive replacement', async () => {
  const plan = await buildPlan(snapshot({replace:true,teacher:true}),{...input,operation:'replace'});
  assert.equal(plan.protectedAsset.audience,'teacher');
  assert.equal(plan.protectedAsset.lesson_id,'u8_l3');
  assert.ok(plan.files[0].content.includes('"adminOnly": true'));
});

test('public loader cannot overwrite the privately stored original on re-upload', async () => {
  const plan = await buildPlan(snapshot(), input);
  await assert.rejects(buildPlan(snapshot(), {...input,html:plan.files[0].content}),error => error.code === 'protected_stub_upload');
});

test('review ticket and commit responses never contain private body', async () => {
  const f = fixture(); const prepared = await f.call({action:'prepare',payload:f.payload});
  assert.equal(prepared.status,200); assert.ok(prepared.body.ticket);
  assert.ok(!JSON.stringify(prepared.body).includes(originalMarker));
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(result.status,200); assert.equal(result.body.protectedContentReady,true);
  assert.ok(!JSON.stringify(result.body).includes(originalMarker));
  assert.ok(!JSON.stringify(f.github.lastFiles).includes(originalMarker));
  assert.deepEqual(f.events,['stage','git','record','activate']);
  assert.ok(f.store.active.original_html.includes(originalMarker));
});

test('stage failure blocks all Git writes and leaves the existing asset intact', async () => {
  const f = fixture({replace:true}); const prepared = await f.call({action:'prepare',payload:f.payload});
  f.store.failStage = true;
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(result.body.success,false); assert.equal(f.github.calls,0);
  assert.equal(f.store.active.content_html,'OLD_PRIVATE_BODY');
});

test('Git failure preserves old active version and does not publish original', async () => {
  const f = fixture({replace:true}); const prepared = await f.call({action:'prepare',payload:f.payload});
  f.github.mode = 'failure';
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(result.status,409); assert.equal(f.store.active.content_html,'OLD_PRIVATE_BODY');
  assert.ok(!f.events.includes('activate')); assert.ok(!JSON.stringify(f.github.lastFiles).includes(originalMarker));
  f.restart();
  await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(f.github.calls,1);
});

test('unknown Git outcome keeps old content until durable status reconciliation', async () => {
  const f = fixture({replace:true}); const prepared = await f.call({action:'prepare',payload:f.payload});
  f.github.mode = 'unknown';
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(result.status,409); assert.equal(f.store.active.content_html,'OLD_PRIVATE_BODY');
  f.restart();
  const status = await f.call({action:'status',commitSha:result.body.commitSha});
  assert.equal(status.body.protectedContentReady,true); assert.ok(f.store.active.original_html.includes(originalMarker));
  const again = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(again.status,200); assert.equal(f.github.calls,1);
});

test('activation outage can recover without a second Git commit', async () => {
  const f = fixture({replace:true}); const prepared = await f.call({action:'prepare',payload:f.payload});
  f.store.failActivation = true;
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(result.status,409); assert.equal(f.store.active.content_html,'OLD_PRIVATE_BODY');
  f.store.failActivation = false; f.restart();
  const again = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  assert.equal(again.status,200); assert.equal(f.github.calls,1);
});

test('recovery cannot activate a candidate after its public stub was superseded', async () => {
  const f = fixture({replace:true}); const prepared = await f.call({action:'prepare',payload:f.payload});
  f.github.mode = 'unknown';
  const result = await f.call({action:'commit',payload:f.payload,ticket:prepared.body.ticket});
  f.github.state.texts.set('lesson.html','a newer valid protected stub');
  const status = await f.call({action:'status',commitSha:result.body.commitSha});
  assert.equal(status.body.protectedContentReady,false); assert.equal(f.store.active.content_html,'OLD_PRIVATE_BODY');
});

test('changed payload and student token cannot commit', async () => {
  const f = fixture(); const prepared = await f.call({action:'prepare',payload:f.payload});
  const changed = await f.call({action:'commit',payload:{...f.payload,title:'altered'},ticket:prepared.body.ticket});
  assert.equal(changed.status,409); assert.equal(f.github.calls,0);
  const student = await f.call({adminKey:'stu_fixture',action:'prepare',payload:f.payload});
  assert.equal(student.status,401); assert.equal(f.github.calls,0);
});

test('Git adapter records the candidate durably before publishing the branch', async () => {
  const github = new GithubRepository({token:'fixture-token',owner:'Chemtea',repo:'Curr.2022-Science-2'});
  const events = []; const a = 'a'.repeat(40), b = 'b'.repeat(40), c = 'c'.repeat(40);
  github.getHead = async () => ({commitSha:a,treeSha:b});
  github.request = async (path,opts) => {
    events.push(path);
    if(path === '/git/blobs' || path === '/git/trees') return {sha:b};
    if(path === '/git/commits') return {sha:c};
    if(opts.method === 'PATCH') return {ref:'refs/heads/main',object:{sha:c}};
    throw new Error('Unexpected call');
  };
  await github.commitFiles({expectedHead:a,treeSha:b,files:[{path:'lesson.html',content:'PUBLIC_STUB'}],message:'fixture',
    onPreparedCommit:async sha => {assert.equal(sha,c);events.push('DURABLE_DB');}});
  assert.ok(events.indexOf('DURABLE_DB') < events.indexOf('/git/refs/heads/main'));
});

test('store verifies original hash and transformed body before Git publication', async () => {
  let saved; let corrupt = false;
  const store = new ProtectedStore({projectUrl:'https://fixture.invalid',serviceKey:'fixture-service-key-long-enough',
    fetchImpl:async(url,opts) => {
      if(url.includes('protected_lesson_assets?')) return Response.json([]);
      if(opts.method === 'POST') {saved = JSON.parse(opts.body);return new Response(null,{status:201});}
      const row = structuredClone(saved); if(corrupt) row.content_html = 'CORRUPTED'; return Response.json([row]);
    }});
  const asset = {asset_path:'lesson.html',unit_key:'unit8',lesson_id:'u8_l3',title:'차시',audience:'lesson',original_html:html,
    content_html:'SANITIZED',quiz_data:null,lesson_key:null,source_sha256:hash(html)};
  const result = await store.stage('a'.repeat(43),asset,'PUBLIC_STUB',null);
  assert.equal(result.original_html,undefined); assert.equal(result.content_html,undefined); assert.equal(result.quiz_data,undefined);
  corrupt = true;
  await assert.rejects(store.stage('a'.repeat(43),asset,'PUBLIC_STUB',null),error => error.code === 'protected_store_verification');
});

test('a later upload cannot stage against a pending predecessor DB revision', async () => {
  let posts = 0;
  const store = new ProtectedStore({projectUrl:'https://fixture.invalid',serviceKey:'fixture-service-key-long-enough',
    fetchImpl:async(_url,opts) => {if(opts.method === 'POST') posts++;return Response.json([{source_sha256:hash('old revision')}]);}});
  await assert.rejects(store.stage('a'.repeat(43),{asset_path:'lesson.html'},'PUBLIC_STUB',hash('pending Git revision')),
    error => error.code === 'previous_upload_pending');
  assert.equal(posts,0);
});
