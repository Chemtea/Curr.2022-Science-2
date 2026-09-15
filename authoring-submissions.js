/* AUTHORING_SUBMISSIONS_START — dynamic registered-material submissions, private answers. */
(() => {
  'use strict';
  let host=null,root=null,auth='',generation=0,busy=false,config=null,catalog=[],rows=[],offset=0,hasMore=false,selected=null,printOnly=false,loadedScope=null,authTimer=null;
  const controllers=new Set();
  const $=id=>root?.querySelector('#'+id);
  const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!=null)node.textContent=String(text);if(cls)node.className=cls;return node;};
  const displayCode=value=>String(value||'').replace(/^([123])0([1-9])(\d{2})$/,'$1$2$3');
  const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'—';};
  function token(){
    if(typeof window.getAdminSessionToken==='function')return String(window.getAdminSessionToken()||'');
    try{const user=JSON.parse(sessionStorage.getItem('current_student')||'null');return user?.isAdmin===true||sessionStorage.getItem('temporary_admin_mode')==='1'?String(sessionStorage.getItem('current_admin_key')||''):'';}catch(_){return '';}
  }
  function message(text,error=false){if(!$('asMessage'))return;$('asMessage').textContent=text;$('asMessage').classList.toggle('as-error',error);}
  function abort(){generation++;controllers.forEach(c=>c.abort());controllers.clear();}
  function clearResults(){rows=[];selected=null;loadedScope=null;hasMore=false;if($('asResults'))$('asResults').replaceChildren();if($('asDetail'))$('asDetail').replaceChildren();if($('asPrint'))$('asPrint').disabled=true;if($('asNext'))$('asNext').disabled=true;if($('asPrev'))$('asPrev').disabled=true;}
  function scope(){return {assignmentId:$('asAssignment')?.value||'',schoolYear:Number($('asYear')?.value)||undefined,classKey:$('asClass')?.value||undefined};}
  function sameScope(saved){return saved&&JSON.stringify(saved)===JSON.stringify(scope());}
  function chosenAssignment(){return catalog.find(item=>item.assignmentId===$('asAssignment')?.value);}
  function controls(value){busy=value;if(!root)return;root.querySelectorAll('button,input,textarea,select').forEach(n=>n.disabled=value);if($('asLoad'))$('asLoad').disabled=value||!config;if($('asPrev'))$('asPrev').disabled=value||!loadedScope||offset===0;if($('asNext'))$('asNext').disabled=value||!hasMore;if($('asPrint'))$('asPrint').disabled=value||!config?.capabilities?.print||chosenAssignment()?.policy?.printCenter!==true||!root.querySelector('.as-row-check:checked');if($('asApplyReview'))$('asApplyReview').disabled=value||!$('asReviewConfirm')?.checked||!$('asReviewReason')?.value.trim();if($('asApplyResubmission'))$('asApplyResubmission').disabled=value||!$('asResubmitConfirm')?.checked||!$('asResubmitReason')?.value.trim();}
  function ensureAuth(){if(!root||!auth.startsWith('adm_')||token()!==auth){syncAccess();throw new Error('최고관리자 인증이 변경되었습니다. 다시 열어 주세요.');}}
  async function request(action,payload={}){
    ensureAuth();const base=String(window.PLATFORM_CONFIG?.baseUrl||'').replace(/\/$/,'');if(!base)throw new Error('플랫폼 서버 연결 정보를 확인할 수 없습니다.');
    const ownGeneration=generation,ownAuth=auth,controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(base+'/functions/v1/authoring-api',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal,body:JSON.stringify({action,adminKey:ownAuth,...payload})});const data=await response.json().catch(()=>null);
      if(ownGeneration!==generation||ownAuth!==token()||!root)throw Object.assign(new Error('조회가 취소되었습니다.'),{cancelled:true});
      if(!response.ok||data?.success!==true){if(response.status===401||data?.permissionDenied===true){syncAccess(true);throw new Error('최고관리자 인증을 확인하지 못했습니다. 다시 로그인해 주세요.');}throw Object.assign(new Error(data?.message||'서버 응답을 확인하지 못했습니다.'),{status:response.status,outcomeUnknown:!data||data.outcomeUnknown===true});}return data;
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function invalidate(){abort();clearResults();offset=0;controls(false);message('조회 조건이 변경되었습니다. 다시 조회해 주세요.');}
  function policyText(policy){
    const points=policy?.points||{};
    if(points.mode==='fixed')return `최초 제출 시 ${points.amount}포인트 지급`;
    if(points.mode==='review')return `교사 확인 후 ${points.amount}포인트 지급`;
    if(points.mode==='score')return '최종 점수에 따른 포인트 지급';
    return '포인트 지급 없음';
  }
  async function init(){
    const gen=generation;controls(true);message('등록된 자료와 제출 기능을 확인하고 있습니다.');
    try{
      const data=await request('config');if(gen!==generation)return;
      if(data.version!==1||data.capabilities?.submissions!==true)throw new Error('공통 제출 서버를 현재 버전으로 업데이트해 주세요.');config=data;
      const result=await request('catalog');if(gen!==generation)return;
      catalog=(Array.isArray(result.items)?result.items:[]).filter(item=>!printOnly||item.policy?.printCenter===true);
      $('asAssignment').replaceChildren(new Option('자료 선택',''));catalog.forEach(item=>$('asAssignment').add(new Option(item.title,item.assignmentId)));
      $('asYear').value=String(data.currentSchoolYear||new Date().getFullYear());
      $('asClass').replaceChildren(new Option('전체 반·외부 계정',''));
      (data.classes||[]).forEach(item=>{const value=typeof item==='string'?item:item.key;const label=typeof item==='string'?item:item.label||item.key;if(value)$('asClass').add(new Option(label,value));});
      message(catalog.length?`${catalog.length}개 자료가 등록되어 있습니다. 제출자가 없는 자료도 목록에 표시됩니다.`:'이 화면에 연결된 자료가 없습니다. 자료 등록에서 제출 허용'+(printOnly?'과 인쇄센터 표시를':'을')+' 설정하세요.');
    }catch(error){if(gen===generation&&root){config=null;message(error.message,true);}}
    finally{if(gen===generation)controls(false);}
  }
  function renderRows(){
    const out=$('asResults');out.replaceChildren();
    if(!rows.length){out.append(el('p','선택한 조건의 제출물이 없습니다.','as-note'));return;}
    out.append(el('p',`${offset+1}–${offset+rows.length}번째 제출본 · 이전 제출 기록을 포함합니다.`,'as-note'));
    const wrap=el('div',null,'as-table-wrap'),table=el('table'),thead=el('thead'),hr=el('tr');
    const selectHead=el('th'),all=el('input');all.type='checkbox';all.setAttribute('aria-label','현재 페이지 제출물 전체 선택');all.addEventListener('change',()=>{root.querySelectorAll('.as-row-check').forEach(c=>c.checked=all.checked);controls(false);});selectHead.append(all);hr.append(selectHead);
    ['학번·이름','점수·채점','제출','포인트','답안'].forEach(label=>{const th=el('th',label);th.scope='col';hr.append(th);});thead.append(hr);table.append(thead);
    const body=el('tbody');rows.forEach(row=>{const tr=el('tr'),ct=el('td'),check=el('input');check.type='checkbox';check.className='as-row-check';check.value=row.id;check.setAttribute('aria-label',`${displayCode(row.studentId)} ${row.name} ${row.attemptNo}차 제출 선택`);check.addEventListener('change',()=>controls(false));ct.append(check);tr.append(ct,el('td',`${displayCode(row.studentId)} ${row.name}`),el('td',`${row.score} / ${row.maxScore}점${row.status==='pending_review'?' · 교사 채점 대기':''}`),el('td',`${row.attemptNo}차 · ${date(row.submittedAt)}${row.allowResubmission?' · 재제출 허용 중':''}`),el('td',`${row.awardedPoints||0}점`));const td=el('td'),button=el('button','답안·관리');button.type='button';button.addEventListener('click',()=>openReceipt(row));td.append(button);tr.append(td);body.append(tr);});table.append(body);wrap.append(table);out.append(wrap);
  }
  async function refresh(reset=true){
    if(busy||!root)return;try{ensureAuth();}catch(_){return;}if(!config)return init();
    const query=scope();if(!query.assignmentId){message('자료를 선택해 주세요.',true);return;}if(query.schoolYear&&(!Number.isInteger(query.schoolYear)||query.schoolYear<2000||query.schoolYear>2200)){message('학년도를 확인해 주세요.',true);return;}
    if(reset)offset=0;abort();clearResults();const gen=generation;controls(true);message('제출 목록을 조회하고 있습니다.');
    try{const data=await request('admin_list',{...query,limit:100,offset});if(gen!==generation||!sameScope(query))return;if(!Array.isArray(data.items))throw new Error('제출 목록 형식을 확인하지 못했습니다.');if(data.items.some(item=>item.assignmentId!==query.assignmentId||(query.schoolYear&&item.schoolYear!==query.schoolYear)))throw new Error('조회 조건과 제출 목록이 일치하지 않습니다.');rows=data.items;hasMore=data.hasMore===true;loadedScope={...query};renderRows();message(`조회 완료 · ${policyText(chosenAssignment()?.policy)}`);}
    catch(error){if(gen===generation&&root){clearResults();message(error.message,true);}}
    finally{if(gen===generation)controls(false);}
  }
  async function printSelected(){
    if(busy||!sameScope(loadedScope))return;const ids=Array.from(root.querySelectorAll('.as-row-check:checked')).map(n=>n.value);if(!ids.length)return;
    if(chosenAssignment()?.policy?.printCenter!==true||config?.capabilities?.print!==true){message('이 자료는 인쇄센터 표시가 설정되어 있지 않습니다.',true);return;}
    const gen=generation;controls(true);message('선택한 제출 답안을 불러오고 있습니다.');
    try{const result=await request('admin_get',{ids});if(gen!==generation)return;const receipts=result.items;if(!Array.isArray(receipts)||receipts.length!==ids.length||receipts.some(item=>!ids.includes(item.id)||item.assignmentId!==loadedScope.assignmentId))throw new Error('인쇄할 제출물을 확인하지 못했습니다.');if(!window.ScienceAuthoringRuntime)throw new Error('공통 인쇄 기능을 불러오지 못했습니다. 새로고침해 주세요.');window.ScienceAuthoringRuntime.printReceipts(receipts);message(`${receipts.length}개 제출 답안을 인쇄 화면으로 보냈습니다.`);}
    catch(error){if(gen===generation&&root)message(error.message,true);}finally{if(gen===generation)controls(false);}
  }
  async function openReceipt(row){
    if(busy||!sameScope(loadedScope))return;const gen=generation;controls(true);$('asDetail').replaceChildren();selected=null;message('제출 답안을 불러오고 있습니다.');
    try{const result=await request('admin_get',{ids:[row.id]});if(gen!==generation)return;const receipt=result.items?.[0];if(!receipt||receipt.id!==row.id||receipt.assignmentId!==loadedScope.assignmentId)throw new Error('선택한 제출본을 확인하지 못했습니다.');selected=receipt;renderDetail(receipt);message('선택한 제출본의 답안과 현재 관리 상태입니다.');}
    catch(error){if(gen===generation&&root)message(error.message,true);}finally{if(gen===generation)controls(false);}
  }
  function confirmationFields(container, prefix, title){
    const label=el('label','처리 사유');label.htmlFor=prefix+'Reason';const reason=el('textarea');reason.id=prefix+'Reason';reason.rows=2;reason.maxLength=500;reason.required=true;
    const checkLabel=el('label',null,'as-check'),check=el('input');check.type='checkbox';check.id=prefix+'Confirm';checkLabel.append(check,el('span',title));container.append(label,reason,checkLabel);
    reason.addEventListener('input',()=>{check.checked=false;controls(false);});check.addEventListener('change',()=>controls(false));return {reason,check};
  }
  function renderDetail(receipt){
    const outer=$('asDetail');outer.replaceChildren();const box=el('section',null,'as-receipt');box.tabIndex=-1;box.append(el('h4',`${displayCode(receipt.studentId)} ${receipt.name} · ${receipt.attemptNo}차 제출`),el('p',`${receipt.title} · ${date(receipt.submittedAt)}`),el('p',`${receipt.grade?.score} / ${receipt.grade?.maxScore}점 · ${policyText(receipt.policy)} · 지급 ${receipt.awardedPoints||0}점`,'as-note'));
    const short=(receipt.source?.blocks||[]).filter(b=>b.type==='short'),scores={};
    (receipt.source?.blocks||[]).filter(b=>['choice','number','short'].includes(b.type)).forEach((block,i)=>{
      const answer=el('div',null,'as-answer'),result=receipt.grade?.results?.find(r=>r.id===block.id);answer.append(el('strong',`${i+1}. ${block.title||'문제'}`));if(block.body)answer.append(el('p',block.body,'as-answer-text'));
      const answerText=window.ScienceAuthoringRuntime?.answerText(block,receipt.answers?.[block.id])??String(receipt.answers?.[block.id]??'미응답');answer.append(el('p','제출 답안: '+answerText,'as-answer-text'));
      if(result?.expected!=null)answer.append(el('p','정답·모범답안: '+(typeof result.expected==='object'?JSON.stringify(result.expected):result.expected),'as-answer-text as-model'));
      if(result?.explanation)answer.append(el('p',result.explanation,'as-answer-text as-note'));
      if(block.type==='short'){
        const group=el('div',null,'as-score-input'),label=el('label','부여 점수'),input=el('input');input.type='number';input.min='0';input.max=String(block.points);input.step='1';input.value=String(result?.points||0);input.id='asShort_'+block.id;label.htmlFor=input.id;input.dataset.shortId=block.id;group.append(label,input,el('span',`/ ${block.points}점`));input.addEventListener('input',()=>{if($('asReviewConfirm'))$('asReviewConfirm').checked=false;controls(false);});answer.append(group);scores[block.id]=input;
      }else answer.append(el('p',`${result?.points??0} / ${block.points}점 · 자동 채점`,'as-note'));
      box.append(answer);
    });
    const reviewNeeded=short.length>0||receipt.policy?.points?.mode==='review';
    if(reviewNeeded){
      const review=el('section',null,'as-confirm');review.append(el('h4',short.length?'교사 채점·제출 확인':'제출 확인 후 포인트 지급'),el('p','저장한 점수와 이 제출본의 지급 정책으로 처리합니다. 같은 자료의 포인트는 중복 지급되지 않습니다.','as-note'));
      const {reason,check}=confirmationFields(review,'asReview','답안·점수·지급 정책과 처리 사유를 확인했습니다.');const apply=el('button',short.length?'채점·확인 저장':'제출 확인 저장','as-primary');apply.id='asApplyReview';apply.type='button';apply.disabled=true;
      apply.addEventListener('click',async()=>{
        if(busy||!check.checked||!reason.value.trim()||selected?.id!==receipt.id||!sameScope(loadedScope))return;
        const result={};for(const block of short){const value=scores[block.id].value;if(value.trim()===''||!Number.isInteger(Number(value))||Number(value)<0||Number(value)>block.points){message('서술형 점수는 0부터 문항 배점까지의 정수로 입력해 주세요.',true);scores[block.id].focus();return;}result[block.id]=Number(value);}
        await mutate('review',{submissionId:receipt.id,expectedRevision:receipt.reviewRevision,scores:result,confirmed:true,reason:reason.value.trim()});
      });review.append(apply);box.append(review);
    }
    const resubmit=el('section',null,'as-confirm'),allow=receipt.allowResubmission!==true;resubmit.append(el('h4',allow?'재제출 1회 허용':'재제출 허용 취소'),el('p','최신 제출본에서만 변경할 수 있습니다. 기존 답안·점수·포인트 기록은 보존됩니다.','as-note'));
    const {reason,check}=confirmationFields(resubmit,'asResubmit',`이 학생의 최신 제출본과 재제출 ${allow?'허용':'취소'} 내용을 확인했습니다.`);const apply=el('button',allow?'재제출 허용':'허용 취소');apply.id='asApplyResubmission';apply.type='button';apply.disabled=true;apply.addEventListener('click',()=>{if(busy||!check.checked||!reason.value.trim()||selected?.id!==receipt.id||!sameScope(loadedScope))return;mutate('set_resubmission',{submissionId:receipt.id,expectedRevision:receipt.reviewRevision,allow,confirmed:true,reason:reason.value.trim()});});resubmit.append(apply);box.append(resubmit);
    const close=el('button','답안 닫기');close.type='button';close.addEventListener('click',()=>{selected=null;outer.replaceChildren();});const closeWrap=el('div',null,'as-actions');closeWrap.append(close);box.append(closeWrap);outer.append(box);box.focus();
  }
  async function mutate(action,payload){
    const gen=generation;controls(true);message('변경 내용을 서버에 저장하고 있습니다.');
    try{const result=await request(action,payload);if(gen!==generation)return;const receipt=result.receipt;if(!receipt||receipt.id!==payload.submissionId)throw new Error('변경 영수증을 확인하지 못했습니다.');selected=receipt;renderDetail(receipt);rows=rows.map(row=>row.id===receipt.id?{...row,score:receipt.grade?.score,maxScore:receipt.grade?.maxScore,status:receipt.grade?.status,awardedPoints:receipt.awardedPoints,reviewRevision:receipt.reviewRevision,allowResubmission:receipt.allowResubmission}:row);renderRows();message('변경 내용을 저장했습니다.');}
    catch(error){if(gen===generation&&root){selected=null;$('asDetail').replaceChildren();message(error.status===409?'제출본 또는 관리 상태가 변경되었습니다. 목록을 다시 조회한 뒤 확인해 주세요.':'저장 결과를 확인하지 못했습니다. 반복 처리하지 말고 목록과 답안을 다시 조회하여 현재 상태를 확인해 주세요.\n'+error.message,true);}}
    finally{if(gen===generation)controls(false);}
  }
  function dispose(){abort();clearInterval(authTimer);authTimer=null;window.ScienceAuthoringRuntime?.clearPrintFrames();if(root)root.remove();host=null;root=null;auth='';config=null;catalog=[];rows=[];selected=null;loadedScope=null;busy=false;offset=0;hasMore=false;window.removeEventListener('focus',onFocus);window.removeEventListener('storage',onFocus);}
  function syncAccess(force=false){if(!root)return;if(force||!auth||token()!==auth){const target=host;dispose();if(target){target.replaceChildren(el('p','최고관리자 인증이 필요합니다. 로그인 후 다시 열어 주세요.','as-note'));}}}
  function onFocus(){syncAccess();}
  function mount(target,options={}){
    dispose();if(!target||!target.append)return;host=target;auth=token();printOnly=options.printOnly===true;
    root=el('section',null,'as-panel');root.innerHTML='<h3>제작 자료 제출·인쇄</h3><p class="as-note">제작기에서 등록한 자료의 제출 답안과 채점 결과를 확인합니다. 기존 수행평가는 기존 선택 항목을 이용하세요.</p><div class="as-filters"><label for="asAssignment">자료<select id="asAssignment"><option value="">자료 선택</option></select></label><label for="asYear">학년도<input id="asYear" type="number" min="2000" max="2200" step="1"></label><label for="asClass">반<select id="asClass"><option value="">전체 반·외부 계정</option></select></label></div><div class="as-actions"><button type="button" id="asLoad" class="as-primary">제출 목록 조회</button><button type="button" id="asPrint" disabled>선택 답안 인쇄</button></div><div id="asMessage" class="as-message" role="status" aria-live="polite"></div><div id="asResults"></div><div class="as-actions"><button type="button" id="asPrev" disabled>이전 100개</button><button type="button" id="asNext" disabled>다음 100개</button></div><div id="asDetail"></div>';host.replaceChildren(root);
    if(!auth.startsWith('adm_')){syncAccess(true);return;}
    ['asAssignment','asYear','asClass'].forEach(id=>$(id).addEventListener('change',invalidate));$('asLoad').addEventListener('click',()=>refresh(true));$('asPrint').addEventListener('click',printSelected);$('asNext').addEventListener('click',()=>{if(busy||!hasMore)return;offset+=100;refresh(false);});$('asPrev').addEventListener('click',()=>{if(busy||offset===0)return;offset=Math.max(0,offset-100);refresh(false);});window.addEventListener('focus',onFocus);window.addEventListener('storage',onFocus);authTimer=setInterval(onFocus,15000);init();
  }
  window.AuthoringSubmissions=Object.freeze({mount,dispose,syncAccess,refresh});
})();
/* AUTHORING_SUBMISSIONS_END */
