import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transformQuiz, parseDataLiteral} from '../shared/protect-quizzes.mjs';

function fixture({master = false, fiveOptions = false} = {}) {
  const data = Object.fromEntries([1,2,3,4].map(q => [q, {
    correct:2,
    wrongReasons:Object.fromEntries(Array.from({length:fiveOptions && q === 3 ? 5 : 4}, (_, index) => index + 1).filter(n => n !== 2).map(n => [n, `reason-${q}-${n}`])),
    wrongHint:`hint-${q}`, correctFb:`correct-${q}`, correctExpl:`explanation-${q}`
  }]));
  const config = master
    ? `window.MASTER_LESSON_CONFIG = Object.freeze(/* ML:EDIT:CONFIG:START */ {"unitKey":"unit8","lessonKey":"u8_l2","templateMode":false} /* ML:EDIT:CONFIG:END */);`
    : 'const THIS_UNIT_KEY = "unit7"; const THIS_LESSON_ID = "u7_l1";';
  const options = [1,2,3,4].map(q => Array.from({length:fiveOptions && q === 3 ? 5 : 4}, (_, i) => `<button onclick="handleQuiz(${q}, this, ${i === 1}, ${i + 1})">choice</button>`).join('')).join('');
  return `<!DOCTYPE html><html><head><script>${config}\nconst lockedScreen = \`<html><head></head><body>locked</body></html>\`;</script></head><body>${options}<script>
  const userQuizState = {q1:null,q2:null,q3:null,q4:null};
  let isSubmitted = false;
  const quizData = ${JSON.stringify(data)};
  function handleQuiz(qNum, el, isCorrect, optNum) {
    const data = quizData[qNum];
    userQuizState['q' + qNum] = isCorrect;
    el.result = isCorrect ? data.correctExpl : data.wrongReasons[optNum];
  }
  </script></body></html>`;
}

test('legacy and master sources extract answers and keep scripts valid', () => {
  for (const master of [false,true]) {
    const result = transformQuiz(fixture({master, fiveOptions:true}));
    assert.equal(result.lessonKey, master ? 'u8_l2' : 'u7_l1');
    assert.equal(result.quizData[3].wrongReasons[5], 'reason-3-5');
    assert.doesNotMatch(result.html, /handleQuiz\([^)]*\b(?:true|false)\b/);
    assert.doesNotMatch(result.html, /explanation-|hint-|reason-/);
    assert.match(result.html, /async function handleQuiz/);
    assert.equal((result.html.match(/protected-quiz\.js/g) || []).length, 1);
    for (const script of result.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(script[1]);
  }
});

test('no-quiz pages pass unchanged; unknown and already protected forms fail closed', () => {
  assert.deepEqual(transformQuiz('<h1>assessment</h1>'), {html:'<h1>assessment</h1>',quizData:null,lessonKey:null});
  assert.throws(() => transformQuiz('<script>let quizInfo = {};</script>'));
  assert.throws(() => transformQuiz(transformQuiz(fixture()).html), /교사용 원본/);
  assert.throws(() => transformQuiz(fixture().replace('this, true, 2', 'this, false, 2')), /정답이 다릅니다/);
  assert.throws(() => transformQuiz(fixture().replace('const quizData = ', 'const quizData = (() => ')), /실행식/);
});

test('restricted parser accepts safe literal syntax without executing expressions', () => {
  const parsed = parseDataLiteral(' /* safe */ {correct:2, text:\'hello\\nworld\', arr:[true,null,-1.2e2,], } ;');
  assert.equal(parsed.value.text, 'hello\nworld');
  assert.deepEqual(parsed.value.arr, [true,null,-120]);
  for (const bad of ['{x:globalThis.evil()}', '{x:`${evil()}`}', '{__proto__:{}}', '{x:1,x:2}', '{...other}', '{x:Infinity}']) {
    assert.throws(() => parseDataLiteral(bad));
  }
});

function runtime({admin = false, temporaryAdmin = false} = {}) {
  const options = Array.from({length:5}, () => ({style:{pointerEvents:''}, result:null}));
  const attributes = new Map();
  const block = {
    contains:element => options.includes(element), querySelectorAll:() => options,
    getAttribute:key => attributes.get(key) ?? null,
    setAttribute:(key,value) => attributes.set(key,value), removeAttribute:key => attributes.delete(key)
  };
  const storage = new Map([
    ['current_student',JSON.stringify(admin ? {isAdmin:true} : {studentSessionToken:'stu_test'})],
    ['current_admin_key','adm_test'],
    ['temporary_admin_mode',temporaryAdmin ? '1' : '0']
  ]);
  const requests = [], alerts = [];
  const context = vm.createContext({
    AbortController, setTimeout, clearTimeout,
    document:{getElementById:() => block},
    sessionStorage:{getItem:key => storage.get(key) || null},
    location:{pathname:'/repo/lesson.html'},
    alert:message => alerts.push(message),
    fetch:(url, config) => new Promise((resolve,reject) => requests.push({url,config,resolve,reject}))
  });
  context.window = context;
  context.PLATFORM_CONFIG = {baseUrl:'https://project.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public_key'};
  context.CTProtectedContent = {path:'folder/lesson.html',apiUrl:'https://project.supabase.co/functions/v1/lesson-content-api'};
  vm.runInContext(fs.readFileSync(new URL('../protected-quiz.js',import.meta.url),'utf8'), context);
  const source = transformQuiz(fixture({fiveOptions:true})).html;
  const handler = /async function handleQuiz[\s\S]*?\n  }/.exec(source)[0];
  vm.runInContext(`const userQuizState = {q1:null,q2:null,q3:null,q4:null}; let isSubmitted = false; ${handler}; window.state = userQuizState; window.setSubmitted = () => {isSubmitted=true;};`,context);
  return {context, options, block, requests, alerts};
}

function resolve(request, data, ok = true) {
  request.resolve({ok, json:async () => data});
}

test('pending requests never change answers, suppress duplicates, and use server result', async () => {
  const r = runtime();
  const promise = r.context.handleQuiz(1,r.options[0],true,1);
  assert.equal(r.context.state.q1,null);
  assert.equal(r.options[0].result,null);
  assert.equal(r.options[0].style.pointerEvents,'none');
  assert.equal(await r.context.handleQuiz(1,r.options[1],true,2),undefined);
  assert.equal(r.requests.length,1);
  const body = JSON.parse(r.requests[0].config.body);
  assert.deepEqual(body,{action:'check_answer',path:'folder/lesson.html',qNum:1,optNum:1,studentSessionToken:'stu_test'});
  resolve(r.requests[0],{success:true,isCorrect:false,feedback:{wrongReasons:{1:'chosen feedback'},wrongHint:'hint'}});
  await promise;
  assert.equal(r.context.state.q1,false);
  assert.equal(r.options[0].result,'chosen feedback');
  await r.context.handleQuiz(1,r.options[1],true,2);
  assert.equal(r.requests.length,1);
});

test('locked and network failures preserve unanswered state and allow retry', async () => {
  const r = runtime();
  const first = r.context.handleQuiz(3,r.options[4],false,5);
  resolve(r.requests[0],{success:false,error:'4단계가 잠겨 있습니다.'},false);
  await first;
  assert.equal(r.context.state.q3,null);
  assert.equal(r.options[4].result,null);
  assert.equal(r.options[4].style.pointerEvents,'');
  const second = r.context.handleQuiz(3,r.options[4],false,5);
  r.requests[1].reject(new Error('network offline'));
  await second;
  assert.equal(r.context.state.q3,null);
  const third = r.context.handleQuiz(3,r.options[4],false,5);
  resolve(r.requests[2],{success:true,isCorrect:true,feedback:{correctExpl:'accepted'}});
  await third;
  assert.equal(r.context.state.q3,true);
  assert.equal(r.alerts.length,2);
});

test('teacher credentials and post-submission answer review remain available', async () => {
  const r = runtime({admin:true});
  r.context.setSubmitted();
  const promise = r.context.CTProtectedQuiz.checkAnswer({qNum:1,optNum:2,element:r.options[1]});
  assert.equal(JSON.parse(r.requests[0].config.body).adminKey,'adm_test');
  assert.equal(JSON.parse(r.requests[0].config.body).studentSessionToken,undefined);
  resolve(r.requests[0],{success:true,isCorrect:true,feedback:{correctExpl:'teacher feedback'}});
  assert.equal((await promise).isCorrect,true);
});

test('temporary teacher credentials and revision mismatch do not change answer state', async () => {
  const r = runtime({temporaryAdmin:true});
  r.context.CTProtectedContent.revision = 'revision-test';
  const promise = r.context.handleQuiz(1,r.options[1],false,2);
  const body = JSON.parse(r.requests[0].config.body);
  assert.equal(body.adminKey,'adm_test');
  assert.equal(body.revision,'revision-test');
  resolve(r.requests[0],{success:false,revisionMismatch:true,message:'새로고침해 주세요.'},false);
  await promise;
  assert.equal(r.context.state.q1,null);
  assert.equal(r.options[1].result,null);
  assert.equal(r.alerts[0],'새로고침해 주세요.');
});
