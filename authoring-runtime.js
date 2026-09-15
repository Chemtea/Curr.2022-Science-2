/* SCIENCE_AUTHORING_RUNTIME_START — shared renderer and verified submission runtime. */
(() => {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const question = block => ['choice','number','short'].includes(block.type);
  const code = value => String(value || '').replace(/^([123])0([1-9])(\d{2})$/, '$1$2$3');
  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const numeric = value => typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) && Number.isFinite(Number(value.trim()));
  const image = value => typeof value === 'string' && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  const date = value => { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}) : '—'; };
  const styles = `
  .sa-root,.sa-print-docs{--sa-bg:#0b0e14;--sa-card:#141b29;--sa-line:#2c374b;--sa-text:#e6edf8;--sa-muted:#a6b3c8;color:var(--sa-text);font:15px/1.7 Pretendard,system-ui,"Malgun Gothic",sans-serif;box-sizing:border-box}
  .sa-root *,.sa-print-docs *{box-sizing:border-box}.sa-root{max-width:980px;margin:0 auto;padding:24px 20px 60px}.sa-root h1{font-size:25px;line-height:1.4;margin:10px 0}.sa-root h2,.sa-print-docs h2{font-size:18px;margin:0 0 10px}.sa-root h3,.sa-print-docs h3{font-size:16px;margin:0 0 10px}.sa-root p,.sa-print-docs p{margin:8px 0}.sa-body{white-space:pre-wrap;overflow-wrap:anywhere}.sa-subtle{color:var(--sa-muted)}.sa-top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px}.sa-link{color:#7dd3fc}.sa-tag{display:inline-block;padding:3px 9px;border-radius:20px;font-size:12px;background:#163149;color:#a5e6ff}.sa-block{border:1px solid var(--sa-line);border-radius:16px;padding:20px;margin:14px 0;background:var(--sa-card);min-width:0}.sa-block-heading{display:flex;align-items:flex-start;gap:10px}.sa-number{color:#67e8f9;font-weight:700;flex:none}.sa-block-heading h2{font-size:16px;line-height:1.7;font-weight:650}.sa-meta{font-size:12px;color:var(--sa-muted);margin-bottom:10px}.sa-options{display:grid;gap:8px;margin:14px 0 0}.sa-option{display:flex;gap:9px;align-items:flex-start;padding:9px 12px;border:1px solid var(--sa-line);border-radius:9px;cursor:pointer}.sa-option:has(input:checked){border-color:#67e8f9;background:#153243}.sa-root input[type=radio],.sa-root input[type=checkbox]{accent-color:#38bdf8;flex:none;width:17px;height:17px;margin-top:4px}.sa-root input[type=text],.sa-root textarea{font:inherit;color:var(--sa-text);background:#0b1320;border:1px solid #41516b;border-radius:9px;padding:10px 12px;max-width:100%}.sa-root textarea{display:block;width:100%;min-height:115px;resize:vertical}.sa-root input[type=text]{width:190px}.sa-root :focus-visible{outline:3px solid #7dd3fc;outline-offset:3px}.sa-root button{font:inherit;font-size:14px;font-weight:650;padding:10px 16px;border-radius:10px;border:1px solid #334155;background:#202c40;color:#e6edf8;cursor:pointer}.sa-root button.sa-primary{border:0;background:linear-gradient(100deg,#0284c7,#6366f1);color:white}.sa-root button:disabled{opacity:.48;cursor:default}.sa-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:20px}.sa-notice{padding:12px 16px;border:1px solid #33475f;border-radius:10px;white-space:pre-wrap;margin:14px 0}.sa-notice.sa-error{border-color:#e78b8b;color:#fecaca}.sa-result{border-color:#0891b2}.sa-result-score{font-size:24px;font-weight:750}.sa-feedback{padding:10px 12px;margin-top:12px;border-left:3px solid #64748b;white-space:pre-wrap}.sa-correct{border-left-color:#34d399}.sa-wrong{border-left-color:#f59e0b}.sa-table-wrap{overflow:auto}.sa-table{border-collapse:collapse;width:100%;margin:10px 0}.sa-table th,.sa-table td{border:1px solid var(--sa-line);padding:8px 12px;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.sa-table th{background:#1e2b40}.sa-image{display:block;max-width:100%;max-height:460px;object-fit:contain;margin:14px auto}.sa-circuit{display:block;max-width:520px;width:100%;height:auto;margin:14px auto;color:#c7dcf5}.sa-circuit text{fill:currentColor;font-family:system-ui,sans-serif;font-size:17px}.sa-caption{font-size:13px;text-align:center;color:var(--sa-muted)}.sa-answer-line{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px 12px;background:#0b1320;border:1px solid var(--sa-line);border-radius:8px;margin-top:10px}.sa-progress{font-size:13px;color:var(--sa-muted)}.sa-print-docs{--sa-bg:white;--sa-card:white;--sa-line:#a6acb6;--sa-text:#151b26;--sa-muted:#48505b;color:#151b26;background:white;font-size:11pt}.sa-print-docs .sa-block{padding:12px;margin:10px 0;border-radius:4px;break-inside:avoid}.sa-print-docs .sa-circuit{color:#182636;max-width:420px}.sa-print-docs .sa-table th{background:#edf0f4}.sa-print-docs .sa-answer-line{background:white}.sa-print-docs .sa-number{color:#0369a1}.sa-print-docs .sa-paper{break-after:page}.sa-print-docs .sa-paper:last-child{break-after:auto}.sa-print-docs .sa-feedback{font-size:10pt}.sa-print-docs .sa-print-header{border-bottom:2px solid #475569;padding-bottom:10px}.sa-print-docs .sa-tag{background:#edf2f7;color:#183a4d}
  @media(max-width:620px){.sa-root{padding:16px 12px 40px}.sa-root h1{font-size:22px}.sa-block{padding:15px}.sa-root input[type=text]{width:150px}.sa-root .sa-actions button{min-height:42px}}
  @media print{@page{size:A4;margin:13mm}body{margin:0!important;background:white!important}.sa-root>header,.sa-root>form,.sa-root>.sa-notice,.sa-root>.sa-actions,.sa-root>.sa-result,.sa-root>#saSaved{display:none!important}.sa-root{padding:0}.sa-screen-only{display:none!important}.sa-print-docs .sa-block{box-shadow:none}.sa-print-docs{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  `;
  function circuitSVG(block) {
    const voltage = esc(finite(block.voltage)), values = (Array.isArray(block.resistors) ? block.resistors : []).map(v=>esc(finite(v)));
    const resistance = (x,y,label) => `<path d="M${x-35} ${y}h15m40 0h15"/><rect x="${x-20}" y="${y-10}" width="40" height="20" rx="1"/><text x="${x}" y="${y-23}" text-anchor="middle" stroke="none">${label} Ω</text>`;
    let wires, bodies;
    if (block.layout === 'parallel') {
      wires='<path d="M70 140V60H440V225H70V170M150 60V140H380V60"/><circle cx="150" cy="60" r="3" fill="currentColor"/><circle cx="380" cy="60" r="3" fill="currentColor"/>';
      // Mask the wire only beneath each component; all paths remain connected.
      bodies=resistance(265,60,values[0]||'0')+resistance(265,140,values[1]||'0');
    } else {
      wires='<path d="M70 140V75H440V225H70V170"/>';
      bodies=block.layout==='series'?resistance(210,75,values[0]||'0')+resistance(340,75,values[1]||'0'):resistance(270,75,values[0]||'0');
    }
    // Component rectangles use the host background so wires do not cross resistor symbols.
    return `<svg class="sa-circuit" viewBox="0 0 520 270" role="img" aria-label="${esc(block.layout==='parallel'?'병렬':block.layout==='series'?'직렬':'단일 저항')} 회로, 전원 ${voltage} V, 저항 ${values.join(', ')} Ω"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">${wires}<path d="M48 140H92M57 158H83M70 158V170"/><text x="100" y="154" stroke="none">${voltage} V</text><text x="33" y="133" stroke="none">+</text></g><g fill="var(--sa-card,white)" stroke="currentColor" stroke-width="2.5">${bodies}</g></svg>`;
  }
  function figure(block) {
    if (block.type==='image') return `${image(block.src)?`<img class="sa-image" src="${esc(block.src)}" alt="${esc(block.alt)}">`:''}${block.caption?`<p class="sa-caption">${esc(block.caption)}</p>`:''}`;
    if (block.type==='circuit') return circuitSVG(block);
    if (block.type==='table') return `<div class="sa-table-wrap"><table class="sa-table"><thead><tr>${(block.headers||[]).map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${(block.rows||[]).map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return '';
  }
  function answerText(block, value) {
    if (value==null||String(value).trim()==='') return '미응답';
    if (block.type==='choice') return (block.options||[]).find(option=>option.id===value)?.text || String(value);
    return String(value)+(block.type==='number'&&block.unit?' '+block.unit:'');
  }
  function feedback(block,result) {
    if (!result) return '';
    const expected=result.expected, expectedText=expected==null?'':typeof expected==='object'?JSON.stringify(expected):String(expected);
    return `<div class="sa-feedback ${result.correct===true?'sa-correct':result.correct===false?'sa-wrong':''}"><strong>${result.correct===null?'교사 채점':result.correct?'정답':'확인 필요'} · ${esc(result.points)} / ${esc(result.maxPoints)}점</strong>${expectedText?`<div>정답·모범답안: ${esc(expectedText)}</div>`:''}${result.explanation?`<div>${esc(result.explanation)}</div>`:''}</div>`;
  }
  function savedBlocks(receipt, includeGrades) {
    let number=0;
    return (receipt.source?.blocks||[]).map(block=>{
      const q=question(block),result=(receipt.grade?.results||[]).find(item=>item.id===block.id);
      return `<section class="sa-block"><div class="sa-block-heading">${q?`<span class="sa-number">${++number}.</span>`:''}<h2>${esc(block.title||({'text':'학습 안내','image':'자료','table':'표','circuit':'회로'}[block.type]||'문제'))}</h2></div>${block.body?`<div class="sa-body">${esc(block.body)}</div>`:''}${figure(block)}${block.type==='choice'?`<div class="sa-options">${(block.options||[]).map((option,i)=>`<div>${receipt.answers?.[block.id]===option.id?'●':'○'} ${i+1}. ${esc(option.text)}</div>`).join('')}</div>`:''}${q?`<div class="sa-answer-line"><strong>제출 답안</strong> ${esc(answerText(block,receipt.answers?.[block.id]))}</div>`:''}${q&&includeGrades?feedback(block,result):''}</section>`;
    }).join('');
  }
  function renderDocument(items, options={}) {
    const list=Array.isArray(items)?items:[], includeGrades=options.includeGrades!==false;
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>제출 답안 인쇄</title><style>${styles}</style></head><body><main class="sa-print-docs">${list.map(receipt=>`<article class="sa-paper"><header class="sa-print-header"><h1>${esc(receipt.title||receipt.source?.title||'제출 답안')}</h1><p>${esc(receipt.schoolYear)}학년도 · ${esc(code(receipt.studentId))} ${esc(receipt.name)} · ${esc(receipt.attemptNo)}차 제출</p><p>${esc(date(receipt.submittedAt))}${includeGrades?` · ${esc(receipt.grade?.score)} / ${esc(receipt.grade?.maxScore)}점${receipt.grade?.status==='pending_review'?' (교사 채점 대기)':''}`:''}</p></header>${savedBlocks(receipt,includeGrades)}</article>`).join('')}</main></body></html>`;
  }
  const printFrames=new Map();
  function clearPrintFrames(){for(const [frame,timer] of printFrames){clearTimeout(timer);frame.remove();}printFrames.clear();}
  function printReceipts(items, options={}) {
    if (!Array.isArray(items)||!items.length) return false;
    const frame=document.createElement('iframe'); frame.title='제출 답안 인쇄'; frame.setAttribute('aria-hidden','true'); frame.style.cssText='position:fixed;width:1px;height:1px;left:-10000px;top:0;border:0';
    const clean=()=>{clearTimeout(printFrames.get(frame));printFrames.delete(frame);frame.remove();};
    frame.addEventListener('load',()=>{try { const win=frame.contentWindow; win.addEventListener('afterprint',clean,{once:true}); setTimeout(()=>{if(frame.isConnected){win.focus();win.print();}},100); } catch (_) { clean(); }},{once:true});
    frame.srcdoc=renderDocument(items,options); document.body.append(frame); printFrames.set(frame,setTimeout(clean,300000)); return true;
  }
  function credentials() {
    try {
      const user=JSON.parse(sessionStorage.getItem('current_student')||'null');
      if(user?.isAdmin===true||sessionStorage.getItem('temporary_admin_mode')==='1') {const value=String(sessionStorage.getItem('current_admin_key')||'');return value.startsWith('adm_')?{adminKey:value}:null;}
      const value=String(user?.studentSessionToken||'');return value.startsWith('stu_')?{studentSessionToken:value}:null;
    } catch(_){return null;}
  }
  const api=Object.freeze({renderDocument,printReceipts,clearPrintFrames,circuitSVG,styles,answerText});
  window.ScienceAuthoringRuntime=api;
  function start() {
    const host=document.getElementById('saLesson'), payload=document.getElementById('science-authoring-public');
    if(!host||!payload||host.dataset.saMounted==='true')return;
    host.dataset.saMounted='true';host.className='sa-root';
    const style=document.createElement('style');style.textContent=styles;document.head.append(style);
    if(!document.body.style.background)document.body.style.background='#0b0e14';
    let data;try{data=JSON.parse(payload.textContent);}catch(_){host.textContent='수업 정보를 읽을 수 없습니다.';return;}
    if(!data?.source||data.source.format!=='science-authoring'||data.source.version!==1||!Array.isArray(data.source.blocks)){host.textContent='지원하지 않는 수업 형식입니다.';return;}
    const source=data.source,preview=window.SA_AUTHORING_PREVIEW===true||(location.protocol==='file:'&&!window.CTProtectedContent), loadedRevision=String(window.CTProtectedContent?.revision||window.PROTECTED_LESSON_REVISION||''), controllers=new Set();
    const state={generation:0,auth:'',verified:false,busy:false,statusBusy:false,stopped:false,canSubmit:false,role:'',user:null,policy:data.policy||{},sourceSha256:'',nextAttemptNo:null,receipt:null,answers:{},editing:false,uncertain:false};
    let timer;
    const $=id=>host.querySelector('#'+id), qBlocks=()=>source.blocks.filter(question);
    const path=()=>String(window.CTProtectedContent?.path||window.PROTECTED_LESSON_PATH||decodeURIComponent(location.pathname.split('/').pop()||''));
    function notice(message,error=false){const node=$('saNotice');if(node){node.textContent=message;node.classList.toggle('sa-error',error);}}
    function cancel(){state.generation++;controllers.forEach(c=>c.abort());controllers.clear();}
    function gate(message){cancel();clearPrintFrames();state.verified=false;state.canSubmit=false;state.busy=false;state.statusBusy=false;state.receipt=null;state.answers={};state.editing=false;host.innerHTML='<h1>자료 이용 확인</h1><div class="sa-notice sa-error" role="alert"></div><div class="sa-actions"><a class="sa-link" href="./index.html">플랫폼으로 이동</a><button type="button" id="saRetry">다시 확인</button></div>';host.querySelector('[role=alert]').textContent=message;$('saRetry').addEventListener('click',()=>status(true));}
    async function request(action,body={}) {
      if(preview)throw new Error('미리보기에서는 서버에 제출하지 않습니다.');
      const auth=credentials();if(!auth)throw Object.assign(new Error('플랫폼에서 로그인한 뒤 다시 열어 주세요.'),{status:401});
      const ownIdentity=JSON.stringify(auth),ownGeneration=state.generation;
      if(state.auth&&state.auth!==ownIdentity)throw Object.assign(new Error('로그인 정보가 변경되었습니다.'),{status:401});
      const base=String(window.PLATFORM_CONFIG?.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('플랫폼 서버 연결 정보를 확인할 수 없습니다.');
      const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),20000);
      try{
        const response=await fetch(base+'/functions/v1/authoring-api',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify({action,...auth,assetPath:path(),...body})});
        const value=await response.json().catch(()=>null);
        if(state.stopped||ownGeneration!==state.generation||JSON.stringify(credentials())!==ownIdentity)throw Object.assign(new Error('로그인 또는 자료 상태가 변경되었습니다.'),{status:401});
        if(!response.ok||value?.success!==true)throw Object.assign(new Error(value?.message||'서버 응답을 확인하지 못했습니다.'),{status:response.status,outcomeUnknown:!value||value.outcomeUnknown===true});
        return value;
      }finally{clearTimeout(timeout);controllers.delete(controller);}
    }
    function completeness(){return qBlocks().filter(block=>{const value=state.answers[block.id];if(block.type==='number'&&value!=null&&String(value).trim()!==''&&!numeric(String(value)))return true;return block.required&&(value==null||String(value).trim()==='');});}
    function syncControls(){
      if(!$('saForm'))return;
      const writable=preview||state.verified&&state.role==='student'&&state.canSubmit&&(!state.receipt||state.editing)&&!state.busy&&!state.uncertain;
      $('saForm').querySelectorAll('input,textarea').forEach(node=>node.disabled=!writable);
      if($('saSubmit'))$('saSubmit').disabled=!writable||preview;
      if($('saProgress')){$('saProgress').textContent=`${qBlocks().filter(b=>state.answers[b.id]!=null&&String(state.answers[b.id]).trim()!=='').length} / ${qBlocks().length}문항 응답 · 필수 문항을 모두 작성한 뒤 제출하세요.`;}
    }
    function renderQuestions(){
      let number=0;
      return source.blocks.map(block=>{
        const q=question(block),id=esc(block.id);let controls='';
        if(block.type==='choice')controls=`<fieldset class="sa-options" style="border:0;padding:0" aria-labelledby="saTitle_${id}"><legend class="sa-meta">보기 선택</legend>${(block.options||[]).map((option,i)=>`<label class="sa-option"><input type="radio" name="sa_${id}" data-question="${id}" value="${esc(option.id)}" ${state.answers[block.id]===option.id?'checked':''}><span>${i+1}. ${esc(option.text)}</span></label>`).join('')}</fieldset>`;
        if(block.type==='number')controls=`<div class="sa-actions"><label for="saAnswer_${id}">답</label><input id="saAnswer_${id}" type="text" inputmode="decimal" autocomplete="off" maxlength="80" data-question="${id}" value="${esc(state.answers[block.id]||'')}" aria-describedby="saUnit_${id}"><span id="saUnit_${id}">${esc(block.unit||'숫자 입력')}</span></div>`;
        if(block.type==='short')controls=`<label class="sa-meta" for="saAnswer_${id}">나의 답안</label><textarea id="saAnswer_${id}" rows="4" maxlength="10000" data-question="${id}">${esc(state.answers[block.id]||'')}</textarea>`;
        return `<section class="sa-block" id="saBlock_${id}"><div class="sa-block-heading">${q?`<span class="sa-number">${++number}.</span>`:''}<h2 id="saTitle_${id}">${esc(block.title||({'text':'학습 안내','image':'자료','table':'표','circuit':'회로'}[block.type]||'문제'))}</h2></div>${q?`<div class="sa-meta">${block.required?'필수 응답':'선택 응답'} · ${esc(block.points)}점${block.type==='short'?' · 교사 채점':''}</div>`:''}${block.body?`<div class="sa-body">${esc(block.body)}</div>`:''}${figure(block)}${controls}</section>`;
      }).join('');
    }
    function render(){
      const saved=state.receipt&&!state.editing,teacher=state.role==='admin';
      host.innerHTML=`<header><div class="sa-top"><a class="sa-link" href="./index.html">← 플랫폼 메뉴</a><span class="sa-tag">${preview?'제작 미리보기':teacher?'교사 보기':esc(code(state.user?.studentId))+' '+esc(state.user?.name||'')}</span></div><h1>${esc(source.title)}</h1>${source.description?`<p class="sa-body sa-subtle">${esc(source.description)}</p>`:''}</header><div id="saNotice" class="sa-notice" role="status" aria-live="polite"></div>${saved?`<section class="sa-block sa-result"><h2>제출 완료</h2><div class="sa-result-score">${esc(state.receipt.grade?.score)} / ${esc(state.receipt.grade?.maxScore)}점</div><p>${state.receipt.grade?.status==='pending_review'?'서술형 문항은 교사 채점 후 최종 점수가 확정됩니다.':'채점이 완료되었습니다.'}</p><p>${esc(date(state.receipt.submittedAt))} · ${esc(state.receipt.attemptNo)}차 제출 · 지급 포인트 ${esc(state.receipt.awardedPoints||0)}점</p><div class="sa-actions">${state.policy.studentPrint===true?'<button type="button" id="saPrint">제출 답안 인쇄</button>':''}${state.canSubmit&&state.role==='student'?'<button type="button" id="saNewAttempt">재제출 답안 작성</button>':''}</div></section><div id="saSaved">${savedBlocks(state.receipt,true)}</div>`:`<form id="saForm" novalidate>${renderQuestions()}<div class="sa-actions"><button class="sa-primary" id="saSubmit" type="submit">답안 제출</button><span id="saProgress" class="sa-progress"></span></div></form>`}`;
      if($('saForm')){
        $('saForm').addEventListener('input',event=>{const target=event.target,id=target.dataset.question;if(!id)return;if(target.type==='radio'&&!target.checked)return;state.answers[id]=target.value;syncControls();});
        $('saForm').addEventListener('submit',submit);syncControls();
      }
      if($('saPrint'))$('saPrint').addEventListener('click',async()=>{try{const value=await request('get_status');if(value.role!=='student'||value.locked===true||value.policy?.studentPrint!==true||!value.receipt)throw new Error('현재 답안 인쇄를 허용하지 않습니다.');printReceipts([value.receipt]);}catch(error){if([401,403,409].includes(error.status))gate(error.message);else notice(error.message,true);}});
      if($('saNewAttempt'))$('saNewAttempt').addEventListener('click',()=>{if(!state.canSubmit||!Number.isInteger(state.nextAttemptNo))return;state.editing=true;state.answers={};for(const block of qBlocks())if(state.receipt?.answers?.[block.id]!=null)state.answers[block.id]=String(state.receipt.answers[block.id]);render();notice('재제출 답안을 작성하고 있습니다. 이전 제출 기록은 보존됩니다.');});
      notice(preview?'미리보기입니다. 답안 입력을 연습할 수 있으며 제출·채점·포인트 지급은 실행되지 않습니다.':teacher?'교사 보기입니다. 학생 답안은 제출하지 않습니다.':saved?'서버에 저장된 답안과 채점 결과입니다.':state.policy.enabled!==true?'이 자료는 제출 없이 학습하는 자료입니다.':state.uncertain?'저장 결과를 확인 중입니다. 다시 제출하지 말고 상태 확인을 기다려 주세요.':'답안은 제출 버튼을 누를 때 서버에 저장됩니다.');
      if(!saved&&state.policy.enabled!==true&&!preview){$('saSubmit').hidden=true;}
    }
    async function submit(event){
      event.preventDefault();if(preview||state.busy||state.uncertain||!state.verified||state.role!=='student'||!state.canSubmit||!Number.isInteger(state.nextAttemptNo))return;
      const missing=completeness();if(missing.length){notice(`미응답 또는 숫자 형식을 확인할 문항이 ${missing.length}개 있습니다.`,true);const block=document.getElementById('saBlock_'+missing[0].id);block?.scrollIntoView({block:'center',behavior:'smooth'});block?.querySelector('input,textarea')?.focus();return;}
      if(!window.confirm('작성한 답안을 제출할까요? 제출 후에는 선생님이 허용한 경우에 다시 제출할 수 있습니다.'))return;
      state.busy=true;syncControls();notice('답안을 서버에 저장하고 채점하고 있습니다.');
      const attempt=state.nextAttemptNo,gen=state.generation;
      try{const value=await request('submit',{sourceSha256:state.sourceSha256,expectedAttemptNo:attempt,answers:{...state.answers}});if(gen!==state.generation)return;if(!value.receipt?.id||value.receipt.attemptNo!==attempt)throw new Error('제출 영수증을 확인하지 못했습니다.');state.receipt=value.receipt;state.editing=false;state.canSubmit=false;state.uncertain=false;state.answers={};render();notice(value.duplicate?'이미 저장된 제출 결과를 복원했습니다.':'답안을 저장했습니다.');}
      catch(error){if(gen!==state.generation)return;if([401,403,409].includes(error.status)){gate(error.message);return;}state.uncertain=true;notice('제출 결과를 확인하지 못했습니다. 자동으로 저장 상태를 다시 확인합니다. 확인 전에는 다시 제출하지 않습니다.',true);await status(false);}
      finally{state.busy=false;syncControls();}
    }
    async function status(force=false){
      if(preview||state.stopped||state.statusBusy)return;
      const auth=credentials();if(!auth){gate('플랫폼에서 로그인한 뒤 이 자료를 다시 열어 주세요.');return;}
      const identity=JSON.stringify(auth);if(state.auth&&state.auth!==identity){gate('로그인 정보가 변경되었습니다. 자료를 다시 확인합니다.');}state.auth=identity;
      state.statusBusy=true;const gen=state.generation;
      try{
        const value=await request('get_status');if(gen!==state.generation)return;
        if(!['student','admin'].includes(value.role)||value.locked===true)throw Object.assign(new Error('이 자료를 이용할 수 없습니다.'),{status:403});
        if(!/^[a-f0-9]{64}$/.test(loadedRevision)||value.registration?.assetPath!==path())throw Object.assign(new Error('현재 자료의 보호 연결을 확인하지 못했습니다. 플랫폼 목록에서 다시 열어 주세요.'),{status:409});
        if(loadedRevision!==value.registration?.sourceSha256)throw Object.assign(new Error('자료가 수정되었습니다. 새로고침하여 최신 자료를 열어 주세요.'),{status:409});
        if(state.sourceSha256&&state.sourceSha256!==value.registration.sourceSha256)throw Object.assign(new Error('자료가 수정되었습니다. 새로고침하여 최신 자료를 열어 주세요.'),{status:409});
        const previousId=state.receipt?.id,previousRevision=state.receipt?.reviewRevision,previousCanSubmit=state.canSubmit,wasVerified=state.verified,wasUncertain=state.uncertain;
        state.verified=true;state.role=value.role;state.user=value.user||{};state.policy=value.policy||{};state.sourceSha256=value.registration.sourceSha256;state.canSubmit=value.role==='student'&&value.canSubmit===true;state.nextAttemptNo=Number.isInteger(value.nextAttemptNo)?value.nextAttemptNo:null;
        state.receipt=value.receipt||null;
        if(wasUncertain){state.uncertain=false;if(state.receipt&&state.receipt.id!==previousId){state.editing=false;state.answers={};}}
        if(force||!wasVerified||previousId!==state.receipt?.id||previousRevision!==state.receipt?.reviewRevision||previousCanSubmit!==state.canSubmit||wasUncertain)render();else syncControls();
        if(wasUncertain&&!state.receipt)notice('저장된 제출물이 없습니다. 입력한 답안을 확인한 뒤 제출할 수 있습니다.');
      }catch(error){if(gen===state.generation)gate(error.message||'접근 상태를 확인하지 못했습니다. 다시 확인해 주세요.');}
      finally{if(gen===state.generation)state.statusBusy=false;}
    }
    if(preview){state.verified=true;state.policy={...state.policy,enabled:true};render();return;}
    host.innerHTML='<p class="sa-notice" role="status">로그인과 자료 제출 상태를 확인하고 있습니다.</p>';
    status(true);timer=setInterval(()=>status(false),15000);
    const onFocus=()=>status(false),onVisibility=()=>{if(document.visibilityState==='visible')status(false);};
    window.addEventListener('focus',onFocus);window.addEventListener('ctw-lock-changed',onFocus);document.addEventListener('visibilitychange',onVisibility);
    window.addEventListener('storage',onFocus);
    window.addEventListener('pagehide',()=>{state.stopped=true;cancel();clearPrintFrames();clearInterval(timer);window.removeEventListener('focus',onFocus);window.removeEventListener('ctw-lock-changed',onFocus);window.removeEventListener('storage',onFocus);document.removeEventListener('visibilitychange',onVisibility);},{once:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
/* SCIENCE_AUTHORING_RUNTIME_END */
