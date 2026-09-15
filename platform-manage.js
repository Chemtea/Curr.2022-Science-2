/* PLATFORM_SELF_SERVICE_START — production inline tools; server authorizes every request. */
(function () {
    'use strict';
    const tabs={authoring:'수업·문제 제작',lessons:'차시 정보',history:'변경 이력',submissions:'제출 관리',diagnostics:'오류 점검'};
    const caps={lessons:'lessonSettings',history:'settingsHistory',diagnostics:'diagnostics'};
    const shaPattern=/^[a-f0-9]{40}$/;
    const state={open:false,tab:'lessons',auth:'',config:null,busy:false,phase:'',revision:0,generation:0,prepared:null,receipt:null,history:null,historyPage:1,poll:null,pollStarted:0,watch:null,request:null,focus:null,unknown:false};
    let panel;
    const el=id=>document.getElementById('pm'+id);
    const token=()=>typeof getAdminSessionToken==='function'?String(getAdminSessionToken()||''):'';
    const str=v=>v==null?'':String(v);
    const clone=v=>JSON.parse(JSON.stringify(v));
    const units=()=>Array.isArray(state.config?.units)?state.config.units:[];
    const lessons=()=>Array.isArray(state.config?.lessons)?state.config.lessons:[];
    const getLesson=()=>lessons().find(l=>identity(l)===el('Lesson').value);
    const identity=l=>JSON.stringify([l.unitKey,l.id,l.file]);
    const option=(select,label,value)=>{const n=document.createElement('option');n.textContent=label;n.value=value;select.append(n);};
    function say(message,kind=''){el('Message').textContent=message;el('Message').dataset.kind=kind;}
    function node(tag,text,className){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(className)n.className=className;return n;}
    function invalidate(){state.revision++;state.prepared=null;el('Review').hidden=true;renderBusy();}
    function available(){return state.config?.configured===true && state.config?.capabilities?.[caps[state.tab]]===true;}
    function renderBusy(){
        if(!panel)return;
        panel.setAttribute('aria-busy',String(state.busy));
        panel.querySelectorAll('[data-pm-tab]').forEach(n=>n.disabled=state.busy);
        el('Fields').disabled=state.busy || !available() || (state.unknown && state.tab==='lessons');
        el('Reconnect').disabled=state.busy;el('Close').disabled=state.busy && state.phase==='commit';
        el('Prepare').disabled=state.busy || !available() || state.unknown || !getLesson();
        el('HistoryLoad').disabled=state.busy || !available() || !getScope();
        el('HistoryMore').disabled=state.busy || !state.history?.nextPage;
        el('Commit').disabled=state.busy || !state.prepared || state.unknown;
        el('CheckStatus').disabled=state.busy || !state.receipt;
        el('Inspect').disabled=state.busy || !available();
        el('Recover').disabled=state.busy;
    }
    function busy(on,phase=''){state.busy=on;state.phase=on?phase:'';renderBusy();}
    function stopPoll(){if(state.poll)clearTimeout(state.poll);state.poll=null;}
    function authValid(){if(!state.open || !state.auth || token()!==state.auth){if(state.open)close(true);return false;}return true;}
    async function api(action,body={}){
        if(!authValid())throw new Error('최고관리자 로그인을 다시 확인해 주세요.');
        const auth=state.auth,base=str(window.PLATFORM_CONFIG?.baseUrl);
        if(!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(base))throw new Error('플랫폼 서버 주소를 확인할 수 없습니다.');
        const controller=new AbortController();state.request=controller;
        const timeout=setTimeout(()=>controller.abort(),action==='commit'?75000:40000);
        try{
            const response=await fetch(base.replace(/\/$/,'')+'/functions/v1/lesson-upload-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,adminKey:auth,...body}),signal:controller.signal,credentials:'omit'});
            let data;try{data=await response.json();}catch(_){throw new Error('서버 응답을 읽지 못했습니다.');}
            if(token()!==auth){authValid();throw new Error('관리자 인증이 변경되었습니다.');}
            if(!response.ok || data?.success!==true){const error=new Error(data?.message || data?.error || '요청을 처리하지 못했습니다.');error.code=data?.code;if(data?.code==='commit_unknown' && shaPattern.test(str(data.commitSha)))error.receipt={commitSha:data.commitSha,uncertain:true};throw error;}
            return data;
        }catch(error){
            if(error.name==='AbortError')throw new Error(action==='commit'?'저장 응답을 확인하지 못했습니다. 같은 내용을 바로 다시 저장하지 말고 최신 설정과 저장 상태를 확인하세요.':'응답 시간이 초과되었습니다. 다시 연결해 주세요.');
            if(error instanceof TypeError)throw new Error('서버에 연결하지 못했습니다. 연결 상태를 다시 확인해 주세요.');
            throw error;
        }finally{clearTimeout(timeout);if(state.request===controller)state.request=null;}
    }
    function mount(){
        panel=document.getElementById('platformManagePanel');if(!panel || el('Heading'))return !!panel;
        panel.classList.add('platform-manage');panel.hidden=true;panel.setAttribute('aria-labelledby','pmHeading');
        panel.innerHTML=`<div class="pm-top"><div><h3 id="pmHeading" tabindex="-1">플랫폼 관리</h3><p class="pm-note">현재 페이지에서 필요한 설정을 바꿉니다.</p></div><button type="button" id="pmClose">접기</button></div>
        <div class="pm-tabs" role="tablist" aria-label="관리 기능"></div>
        <div class="pm-connection"><span id="pmConnection">연결 확인 전</span><button type="button" id="pmReconnect">연결 다시 확인</button></div>
        <p id="pmMessage" role="status" aria-live="polite"></p>
        <fieldset id="pmFields"><legend class="pm-sr-only">관리할 항목</legend>
          <div id="pmSelection" class="pm-grid"><label id="pmKindWrap">이력 종류<select id="pmKind"><option value="lesson">차시 설정</option><option value="unit">단원 꾸미기</option></select></label><label>단원<select id="pmUnit"></select></label><label id="pmLessonWrap">차시<select id="pmLesson"></select></label></div>
          <section id="pmLessons" role="tabpanel" aria-labelledby="pmTablessons">
            <p id="pmIdentity" class="pm-note"></p>
            <form id="pmLessonForm"><div class="pm-grid"><label>차시 제목<input id="pmTitle" maxlength="200" required></label><label>차시 순서<input id="pmOrder" type="number" min="0" max="10000" step="any" required></label><label class="pm-wide">짧은 설명<textarea id="pmDescription" maxlength="3000" rows="3"></textarea></label><label class="pm-wide">핵심어 · 쉼표로 구분<input id="pmTags" maxlength="3100"></label><label>학습지 PDF 연결<select id="pmPdfMode"><option value="preserve">현재 연결 유지</option><option value="select">이미 등록된 PDF 선택</option><option value="remove">PDF 연결 해제</option></select></label><label id="pmPdfWrap" hidden>등록된 PDF<select id="pmPdf"></select></label></div><p id="pmPdfCurrent" class="pm-note"></p><p class="pm-note">수업 본문·정답·로그인 식별자는 그대로 유지됩니다. 새 PDF 업로드는 기존 수업 자료 등록에서 할 수 있습니다.</p><div class="pm-actions"><button type="submit" id="pmPrepare" class="pm-primary">변경 내용 확인</button><button type="button" id="pmReset">입력 되돌리기</button></div></form>
          </section>
          <section id="pmHistory" role="tabpanel" aria-labelledby="pmTabhistory" hidden><p class="pm-note">선택한 단원 또는 차시의 표시 설정만 되돌립니다. 수업 본문·정답·제출·포인트는 이 기능의 복원 대상이 아닙니다.</p><button type="button" id="pmHistoryLoad">변경 이력 불러오기</button><div id="pmHistoryList" class="pm-stack"></div><button type="button" id="pmHistoryMore" hidden>이전 기록 더 보기</button></section>
          <section id="pmDiagnostics" role="tabpanel" aria-labelledby="pmTabdiagnostics" hidden><p class="pm-note">자료 목록, PDF 연결, 보호용 연결 정보와 배포 상태를 읽어 점검합니다. 학생 답안과 포인트를 변경하지 않습니다.</p><button type="button" id="pmInspect" class="pm-primary">지금 점검</button><div id="pmChecks" class="pm-stack"></div></section>
        </fieldset>
        <section id="pmAuthoring" role="tabpanel" aria-labelledby="pmTabauthoring" hidden><div id="pmAuthoringHost"></div></section>
        <section id="pmSubmissions" role="tabpanel" aria-labelledby="pmTabsubmissions" hidden><label class="pm-submission-type">제출 자료 종류<select id="pmSubmissionType"><option value="legacy">기존 형성평가·수행평가</option><option value="authored">제작기로 만든 자료</option></select></label><div id="pmSubmissionsHost"></div><div id="pmAuthoredSubmissionsHost" hidden></div></section>
        <section id="pmReview" class="pm-review" hidden><h4>저장 전 확인</h4><div id="pmDiff"></div><ul id="pmWarnings"></ul><p id="pmExpiry" class="pm-note"></p><button type="button" id="pmCommit" class="pm-primary">확인한 내용으로 저장</button></section>
        <section id="pmResult" class="pm-result" hidden><h4>저장·배포 상태</h4><p id="pmStatus" role="status" aria-live="polite"></p><div class="pm-actions"><button type="button" id="pmCheckStatus">상태 다시 확인</button><button type="button" id="pmRefresh" hidden>플랫폼 새로고침</button></div></section>
        <section id="pmUnknown" class="pm-result" hidden><p>저장 응답이 확인되지 않았습니다. 같은 내용을 다시 저장하기 전에 최신 설정을 불러와 결과를 비교해 주세요.</p><label>확인한 저장 번호가 있다면 입력<input id="pmRecoverySha" autocomplete="off" maxlength="64" placeholder="저장 번호"></label><div class="pm-actions"><button type="button" id="pmRecover">저장 번호로 상태 확인</button><button type="button" id="pmReloadSettings">최신 설정을 다시 읽고 편집</button></div></section>`;
        const tablist=panel.querySelector('.pm-tabs');
        Object.entries(tabs).forEach(([key,label])=>{const b=node('button',label);b.type='button';b.id='pmTab'+key;b.dataset.pmTab=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','pm'+key[0].toUpperCase()+key.slice(1));b.addEventListener('click',()=>open(key));b.addEventListener('keydown',e=>{const keys=Object.keys(tabs),i=keys.indexOf(key);let next;if(e.key==='ArrowRight')next=keys[(i+1)%keys.length];if(e.key==='ArrowLeft')next=keys[(i+keys.length-1)%keys.length];if(e.key==='Home')next=keys[0];if(e.key==='End')next=keys[keys.length-1];if(next){e.preventDefault();open(next);el('Tab'+next).focus();}});tablist.append(b);});
        el('SubmissionType').addEventListener('change',()=>{if(state.open && state.tab==='submissions')mountSubmissions();});
        el('Close').addEventListener('click',()=>close());el('Reconnect').addEventListener('click',()=>loadConfig());
        el('Unit').addEventListener('change',()=>{invalidate();fillLessons();clearHistory();});
        el('Lesson').addEventListener('change',()=>{invalidate();fillLesson();clearHistory();});
        el('Kind').addEventListener('change',()=>{invalidate();clearHistory();renderMode();});
        el('LessonForm').addEventListener('submit',e=>{e.preventDefault();prepareLesson();});
        el('LessonForm').addEventListener('input',()=>invalidate());
        el('LessonForm').addEventListener('change',()=>{invalidate();renderPdf();});
        el('Reset').addEventListener('click',()=>{invalidate();fillLesson();say('서버에서 읽은 설정으로 입력란을 되돌렸습니다.');});
        el('Commit').addEventListener('click',commit);el('HistoryLoad').addEventListener('click',()=>loadHistory(1));el('HistoryMore').addEventListener('click',()=>loadHistory(state.history?.nextPage));
        el('Inspect').addEventListener('click',inspect);el('CheckStatus').addEventListener('click',()=>checkStatus(true));
        el('Refresh').addEventListener('click',()=>{if(state.receipt?.complete===true)window.location.reload();});
        el('Recover').addEventListener('click',()=>{const sha=el('RecoverySha').value.trim();if(!shaPattern.test(sha)){say('올바른 저장 번호를 입력하세요.','error');return;}state.receipt={commitSha:sha,operation:state.receipt?.commitSha===sha?state.receipt.operation:'unknown',uncertain:true};remember();renderReceipt();checkStatus(true);});
        el('ReloadSettings').addEventListener('click',async()=>{if(state.busy)return;const data=await loadConfig(true);if(data){state.unknown=false;el('Unknown').hidden=true;invalidate();say('최신 설정을 불러왔습니다. 아래 값이 요청한 변경과 같은지 확인하세요. 앞선 저장의 완료 여부는 아직 확인되지 않았습니다.','warning');}});
        return true;
    }
    function renderMode(){
        panel.querySelectorAll('[data-pm-tab]').forEach(b=>{const selected=b.dataset.pmTab===state.tab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
        Object.keys(tabs).forEach(k=>el(k[0].toUpperCase()+k.slice(1)).hidden=state.tab!==k);
        el('Fields').hidden=['submissions','authoring'].includes(state.tab);panel.querySelector('.pm-connection').hidden=['submissions','authoring'].includes(state.tab);el('Selection').hidden=!['lessons','history'].includes(state.tab);
        el('KindWrap').hidden=state.tab!=='history';el('LessonWrap').hidden=state.tab==='history' && el('Kind').value==='unit';
        el('Heading').textContent=tabs[state.tab];renderBusy();
    }
    function fillUnits(previous=''){
        el('Unit').replaceChildren();option(el('Unit'),'단원을 선택하세요','');units().forEach(u=>option(el('Unit'),str(u.title||u.key),u.key));
        if(units().some(u=>u.key===previous))el('Unit').value=previous;fillLessons();
        el('Pdf').replaceChildren();option(el('Pdf'),'PDF를 선택하세요','');(Array.isArray(state.config?.worksheetPdfs)?state.config.worksheetPdfs:[]).forEach(path=>option(el('Pdf'),str(path),str(path)));
    }
    function fillLessons(previous=''){
        el('Lesson').replaceChildren();option(el('Lesson'),'차시를 선택하세요','');lessons().filter(l=>l.unitKey===el('Unit').value).forEach(l=>option(el('Lesson'),(l.archived?'[보관] ':'')+str(l.title||l.id),identity(l)));
        if(lessons().some(l=>l.unitKey===el('Unit').value && identity(l)===previous))el('Lesson').value=previous;fillLesson();
    }
    function fillLesson(){
        const l=getLesson();el('Title').value=str(l?.title);el('Description').value=str(l?.description);el('Order').value=str(l?.lessonOrder??l?.chasi??1);el('Tags').value=Array.isArray(l?.tags)?l.tags.join(', '):'';
        el('Identity').textContent=l?str(l.unitKey)+' / '+str(l.id)+' · '+str(l.file):'단원과 차시를 선택하세요.';
        el('PdfMode').value='preserve';el('Pdf').value=str(l?.worksheetPdf);el('PdfCurrent').textContent=l?.worksheetPdf?'현재 PDF: '+l.worksheetPdf:'현재 연결된 PDF가 없습니다.';renderPdf();renderBusy();
    }
    function renderPdf(){const lesson=getLesson(),restricted=lesson?.adminOnly || lesson?.category==='eval';const selectOption=el('PdfMode').querySelector('option[value="select"]');selectOption.disabled=!!restricted;if(restricted && el('PdfMode').value==='select')el('PdfMode').value='preserve';const selected=el('PdfMode').value==='select';el('PdfWrap').hidden=!selected;el('Pdf').disabled=!selected;el('Pdf').required=selected;}
    function clearHistory(){state.history=null;state.historyPage=1;el('HistoryList').replaceChildren();el('HistoryMore').hidden=true;}
    async function loadConfig(keepSelection=true){
        if(state.busy || !authValid())return null;
        invalidate();clearHistory();const gen=state.generation,unit=keepSelection?el('Unit').value:'',lesson=keepSelection?el('Lesson').value:'';busy(true,'config');say('관리 기능의 연결 상태를 확인하고 있습니다.');
        try{const data=await api('config');if(gen!==state.generation)return null;state.config=data;fillUnits(unit);fillLessons(lesson);el('Connection').textContent=data.configured===true?'관리 서버 연결됨':'관리 서버 설정 필요';
            if(!available() && state.tab!=='submissions')say('이 기능을 사용하려면 함께 제공한 관리 서버 업데이트가 필요합니다. 기존 자료 등록·단원 꾸미기 등은 계속 사용할 수 있습니다.','warning');else say('관리할 항목을 선택하세요.');return data;
        }catch(error){if(gen===state.generation){state.config=null;el('Connection').textContent='연결 미확인';say(error.message,'error');}return null;}finally{if(gen===state.generation)busy(false);}
    }
    function payloadLesson(){
        const l=getLesson();if(!l)throw new Error('차시를 선택하세요.');
        const order=Number(el('Order').value),title=el('Title').value.trim();if(!title || !Number.isFinite(order) || order<=0 || order>10000)throw new Error('차시 제목과 순서를 확인하세요.');
        const lesson={title,description:el('Description').value.trim(),lessonOrder:order,tags:el('Tags').value.split(',').map(t=>t.trim()).filter(Boolean)};
        if(el('PdfMode').value==='remove')lesson.worksheetPdf=null;
        if(el('PdfMode').value==='select'){if(l.adminOnly || l.category==='eval')throw new Error('평가·관리자 전용 자료에는 학생용 학습지 PDF를 연결할 수 없습니다.');if(!el('Pdf').value)throw new Error('PDF를 선택하세요.');lesson.worksheetPdf=el('Pdf').value;}
        return {operation:'update_lesson',fileName:l.file,unitKey:l.unitKey,lessonId:l.id,lesson};
    }
    async function prepareLesson(){if(state.busy || !available() || state.unknown)return;if(el('LessonForm').reportValidity && !el('LessonForm').reportValidity())return;try{await prepare(payloadLesson());}catch(error){say(error.message,'error');}}
    async function prepare(payload){
        if(state.busy || state.unknown || !authValid())return;invalidate();const gen=state.generation,revision=state.revision,snapshot=clone(payload);busy(true,'prepare');say('저장 전 변경 내용을 확인하고 있습니다.');
        try{const data=await api('prepare',{payload:snapshot});if(gen!==state.generation || revision!==state.revision)return;
            const expires=Date.parse(data.summary?.expiresAt);if(!data.ticket || !data.summary || !Number.isFinite(expires) || expires<=Date.now())throw new Error('저장 확인 결과가 불완전하거나 만료되었습니다. 다시 확인하세요.');
            state.prepared={ticket:data.ticket,payload:snapshot,summary:clone(data.summary),revision,auth:state.auth,fingerprint:JSON.stringify(snapshot)};renderReview(data.summary);say('아래 변경 내용을 확인한 뒤 저장하세요.');
        }catch(error){if(gen===state.generation)say(error.code==='no_changes'?'현재 설정과 동일하여 저장할 변경이 없습니다.':error.message,error.code==='no_changes'?'':'error');}finally{if(gen===state.generation)busy(false);}
    }
    const labels={title:'제목',description:'설명',lessonOrder:'차시 순서',tags:'핵심어',worksheetPdf:'PDF 연결',icon:'문양',color:'기본 색',accentColor:'강조 색'};
    const showValue=v=>v==null?'설정 없음 · 현재 수업의 기본값 사용':Array.isArray(v)?v.join(', '):typeof v==='object'?JSON.stringify(v):String(v);
    function diff(parent,before,after){
        const a=before&&typeof before==='object'?before:{},b=after&&typeof after==='object'?after:{};const table=node('table',null,'pm-diff');const head=node('tr');['항목','변경 전','변경 후'].forEach(s=>head.append(node('th',s)));const thead=node('thead');thead.append(head);table.append(thead);const tbody=node('tbody');
        let count=0;Object.entries(labels).forEach(([key,label])=>{if(JSON.stringify(a[key])===JSON.stringify(b[key]))return;const row=node('tr');row.append(node('th',label),node('td',showValue(a[key])),node('td',showValue(b[key])));tbody.append(row);count++;});table.append(tbody);if(count)parent.append(table);else parent.append(node('p','설정 키를 복원합니다. 표시값은 원래 수업의 기본값에 따라 결정됩니다.','pm-note'));
    }
    function renderReview(summary){
        el('Diff').replaceChildren();const before=summary.lessonBefore??summary.unitBefore??summary.settingsBefore,after=summary.lessonAfter??summary.unitAfter??summary.settingsAfter;diff(el('Diff'),before,after);
        el('Warnings').replaceChildren();(Array.isArray(summary.warnings)?summary.warnings:[]).forEach(w=>el('Warnings').append(node('li',str(w))));el('Expiry').textContent='확인 유효 시간: '+new Date(summary.expiresAt).toLocaleString('ko-KR')+' · 입력을 바꾸면 다시 확인해야 합니다.';el('Review').hidden=false;
    }
    function receiptKey(){return 'science-platform-settings-last:'+str(window.PLATFORM_CONFIG?.baseUrl)+':'+window.location.pathname;}
    function remember(){try{if(state.receipt)localStorage.setItem(receiptKey(),JSON.stringify({commitSha:state.receipt.commitSha,operation:state.receipt.operation,uncertain:state.receipt.uncertain===true}));}catch(_){}}
    function readReceipt(){try{const r=JSON.parse(localStorage.getItem(receiptKey())||'null');state.receipt=r&&shaPattern.test(str(r.commitSha))?{commitSha:r.commitSha,operation:r.operation,uncertain:r.uncertain===true}:null;}catch(_){state.receipt=null;}}
    const metadataReceipt=()=>['update_lesson','restore_settings','update_unit','archive_lesson','restore_lesson'].includes(state.receipt?.operation);
    function renderReceipt(){el('Result').hidden=!state.receipt;el('Refresh').hidden=true;if(state.receipt){state.receipt.complete=false;el('Status').textContent=state.receipt.uncertain?'저장 결과를 다시 확인하고 있습니다. 같은 변경을 반복 저장하지 마세요.':'설정 파일 저장 응답을 받았습니다. 사이트 반영은 배포 상태를 확인해야 합니다.';}renderBusy();}
    async function commit(){
        if(state.busy || !state.prepared || state.unknown || !authValid())return;const p=state.prepared;
        let current=p.payload;if(p.payload.operation==='update_lesson'){try{current=payloadLesson();}catch(error){invalidate();say(error.message,'error');return;}}
        if(p.auth!==state.auth || p.revision!==state.revision || p.fingerprint!==JSON.stringify(current) || Date.parse(p.summary.expiresAt)<=Date.now()){invalidate();say('입력이 바뀌었거나 확인 시간이 지났습니다. 변경 내용을 다시 확인하세요.','error');return;}
        const gen=state.generation;busy(true,'commit');say('확인한 설정을 저장하고 있습니다.');stopPoll();
        try{const data=await api('commit',{payload:p.payload,ticket:p.ticket});if(gen!==state.generation)return;if(!shaPattern.test(str(data.commitSha)))throw new Error('저장 번호를 확인하지 못했습니다. 최신 설정을 먼저 확인하세요.');
            state.receipt={commitSha:data.commitSha,operation:p.payload.operation,uncertain:false};remember();invalidate();renderReceipt();say('설정 파일을 저장했습니다. 사이트 반영 상태를 확인하고 있습니다.');
            const selectedUnit=el('Unit').value,selectedLesson=el('Lesson').value;state.config=null;
            try{const latest=await api('config');if(gen===state.generation){state.config=latest;fillUnits(selectedUnit);fillLessons(selectedLesson);clearHistory();}}
            catch(_){if(gen===state.generation)say('설정은 저장됐지만 최신 목록을 읽지 못했습니다. 연결 다시 확인을 눌러 주세요.','warning');}
            state.pollStarted=Date.now();schedulePoll(800);
        }catch(error){if(gen!==state.generation)return;invalidate();say(error.message,'error');if(error.receipt){state.receipt={...error.receipt,operation:p.payload.operation};remember();renderReceipt();state.pollStarted=Date.now();schedulePoll(800);}else if(!['no_changes','repository_changed','ticket_invalid','review_changed','admin_required','origin_denied','invalid_payload','invalid_lesson_fields','worksheet_access','invalid_order','invalid_tags','missing_pdf','invalid_restore_payload','invalid_scope','lesson_not_found','unit_not_found'].includes(error.code)){state.unknown=true;el('Unknown').hidden=false;}}
        finally{if(gen===state.generation)busy(false);}
    }
    function schedulePoll(delay=6500){stopPoll();if(!state.open || !state.receipt)return;if(Date.now()-state.pollStarted>=300000){el('Status').textContent+='\n자동 확인을 마쳤습니다. 상태 다시 확인을 눌러 계속 확인할 수 있습니다.';return;}state.poll=setTimeout(()=>checkStatus(false),delay);}
    async function checkStatus(manual=false){
        if(!state.receipt || !authValid())return;if(state.busy){schedulePoll(1000);return;}if(manual)state.pollStarted=Date.now();stopPoll();const gen=state.generation,sha=state.receipt.commitSha;busy(true,'status');state.receipt.complete=false;el('Refresh').hidden=true;el('Status').dataset.kind='';say('저장·배포 상태를 다시 확인하고 있습니다.');
        try{const data=await api('status',{commitSha:sha});if(gen!==state.generation || sha!==state.receipt?.commitSha)return;
            const names={success:'사이트 배포 완료',failed:'사이트 배포 실패',failure:'사이트 배포 실패',cancelled:'사이트 배포 취소',queued:'배포 대기 중',in_progress:'배포 중',not_found:'배포 시작 대기 중',unknown:'배포 상태 미확인'};
            const complete=data.state==='success'&&(metadataReceipt() || data.protectedContentReady===true);state.receipt.complete=complete;
            el('Status').textContent=(names[data.state]||names.unknown)+(data.message?'\n'+str(data.message):'')+(!metadataReceipt()&&data.protectedContentReady!==true?'\n이전 저장의 보호 연결 상태가 확인되지 않았습니다.':'');el('Status').dataset.kind=complete?'success':['failed','failure','cancelled'].includes(data.state)?'error':'';el('Refresh').hidden=!complete;
            if(complete){state.receipt.uncertain=false;state.unknown=false;el('Unknown').hidden=true;say('저장과 사이트 반영을 확인했습니다.','success');remember();}else if(!['failed','failure','cancelled'].includes(data.state))schedulePoll();
        }catch(error){if(gen===state.generation){el('Status').textContent='저장·배포 상태를 확인하지 못했습니다. 같은 저장을 반복하지 말고 상태 다시 확인을 눌러 주세요. '+error.message;el('Status').dataset.kind='warning';say('현재 저장·배포 상태가 확인되지 않았습니다.','warning');schedulePoll();}}
        finally{if(gen===state.generation)busy(false);}
    }
    function getScope(){const unit=el('Unit')?.value;if(!unit)return null;if(el('Kind')?.value==='unit')return{kind:'unit',unitKey:unit};const l=getLesson();return l?{kind:'lesson',unitKey:l.unitKey,lessonId:l.id,fileName:l.file}:null;}
    async function loadHistory(page=1){
        if(state.busy || !available() || !authValid())return;const scope=getScope();if(!scope)return;invalidate();const gen=state.generation;busy(true,'history');say('선택한 설정의 변경 이력을 읽고 있습니다.');
        try{const data=await api('history',{scope,page});if(gen!==state.generation || JSON.stringify(scope)!==JSON.stringify(getScope()))return;if(!Array.isArray(data.history))throw new Error('변경 이력 응답을 확인할 수 없습니다.');
            if(page===1)el('HistoryList').replaceChildren();state.history=data;state.historyPage=page;
            if(!data.history.length && page===1)el('HistoryList').append(node('p',data.nextPage?'최근 조회 범위에 이 항목의 변경이 없습니다. 이전 기록 더 보기로 이어서 확인할 수 있습니다.':'이 항목에 저장된 설정 변경 이력이 없습니다.','pm-note'));
            data.history.forEach(entry=>{if(!shaPattern.test(str(entry.commitSha)))return;const card=node('article',null,'pm-history-card'),heading=node('h4');const time=Date.parse(entry.createdAt);heading.textContent=(Number.isFinite(time)?new Date(time).toLocaleString('ko-KR'):'시간 미확인')+' · '+entry.commitSha.slice(0,7);card.append(heading);diff(card,entry.before,entry.after);const b=node('button','이 시점의 설정으로 되돌리기');b.type='button';b.addEventListener('click',()=>{if(state.busy || !available() || JSON.stringify(scope)!==JSON.stringify(getScope()))return;prepare({operation:'restore_settings',scope:clone(scope),targetCommitSha:entry.commitSha});});card.append(b);el('HistoryList').append(card);});
            el('HistoryMore').hidden=!data.nextPage;say('복원할 시점을 고르면 현재 설정과 비교한 뒤 저장할 수 있습니다.');
        }catch(error){if(gen===state.generation)say(error.message,'error');}finally{if(gen===state.generation)busy(false);}
    }
    async function inspect(){
        if(state.busy || !available() || !authValid())return;invalidate();const gen=state.generation;busy(true,'diagnostics');el('Checks').replaceChildren();say('플랫폼 연결과 자료 구성을 점검하고 있습니다.');
        try{const data=await api('diagnostics');if(gen!==state.generation)return;if(!Array.isArray(data.checks))throw new Error('점검 응답을 확인할 수 없습니다.');const status={success:'정상',warning:'확인 필요',error:'오류',unknown:'미확인'};
            data.checks.forEach(check=>{const card=node('article',null,'pm-check'),stateName=Object.hasOwn(status,check.state)?check.state:'unknown';card.dataset.kind=stateName;card.append(node('h4',status[stateName]+' · '+str(check.label||check.key)));if(check.detail)card.append(node('p',str(check.detail)));el('Checks').append(card);});
            const c=data.counts;if(c&&typeof c==='object'){const names={units:'단원',lessons:'차시',archived:'보관 자료',linkedPdfs:'PDF 연결',missingPdfs:'누락 PDF',protectedReady:'보호 연결 완료'};const summary=Object.entries(names).filter(([k])=>Number.isFinite(c[k])).map(([k,label])=>label+' '+c[k]+'개').join(' · ');if(summary)el('Checks').prepend(node('p',summary,'pm-note'));}say('점검을 마쳤습니다. 오류 항목의 안내를 확인하세요.');
        }catch(error){if(gen===state.generation)say(error.message,'error');}finally{if(gen===state.generation)busy(false);}
    }
    function disposeSubmissions(){window.PlatformSubmissions?.dispose?.();window.AuthoringSubmissions?.dispose?.();}
    function mountSubmissions(){
        disposeSubmissions();const authored=el('SubmissionType').value==='authored';el('SubmissionsHost').hidden=authored;el('AuthoredSubmissionsHost').hidden=!authored;
        const module=authored?window.AuthoringSubmissions:window.PlatformSubmissions,host=el(authored?'AuthoredSubmissionsHost':'SubmissionsHost');
        if(module?.mount)module.mount(host);else host.textContent='제출 관리 파일을 함께 설치해 주세요.';
    }
    async function open(tab='lessons'){
        if(!mount())return false;if(!Object.hasOwn(tabs,tab))tab='lessons';if(state.open && token()!==state.auth)close(true);if(state.busy)return false;if(!token()){say('최고관리자로 로그인한 뒤 사용할 수 있습니다.','error');return false;}
        if(state.open && state.tab==='authoring'){
            if(tab==='authoring'){el('Heading').focus({preventScroll:true});return true;}
            if(window.LessonAuthoring?.canLeave?.()===false)return false;
            window.LessonAuthoring?.dispose?.();
        }
        if(!state.open){state.focus=document.activeElement;state.open=true;state.auth=token();state.generation++;panel.hidden=false;readReceipt();renderReceipt();state.watch=setInterval(()=>syncAccess(),1000);}
        stopPoll();state.request?.abort();state.request=null;state.generation++;
        invalidate();if(state.tab==='submissions')disposeSubmissions();state.tab=tab;clearHistory();renderMode();el('Heading').focus({preventScroll:true});panel.scrollIntoView?.({behavior:'smooth',block:'nearest'});
        if(tab==='authoring'){say('');el('Result').hidden=true;el('Unknown').hidden=true;if(window.LessonAuthoring?.mount)window.LessonAuthoring.mount(el('AuthoringHost'));else el('AuthoringHost').textContent='제작기 파일을 함께 설치해 주세요.';return true;}
        if(tab==='submissions'){mountSubmissions();say('');return true;}
        if(!state.config)await loadConfig();else if(!available())say('이 기능을 사용하려면 함께 제공한 관리 서버 업데이트가 필요합니다. 기존 도구는 계속 사용할 수 있습니다.','warning');else say('관리할 항목을 선택하세요.');
        if(state.receipt){renderReceipt();state.pollStarted=Date.now();schedulePoll(1000);}return true;
    }
    function close(force=false){
        if(!panel || !state.open)return true;if(state.busy && state.phase==='commit' && !force)return false;
        if(!force && state.tab==='authoring' && window.LessonAuthoring?.canLeave?.()===false)return false;
        stopPoll();if(state.watch)clearInterval(state.watch);state.watch=null;state.request?.abort();state.request=null;state.generation++;state.open=false;state.auth='';state.config=null;state.busy=false;state.prepared=null;state.unknown=false;state.receipt=null;disposeSubmissions();window.LessonAuthoring?.dispose?.();
        panel.hidden=true;el('Result').hidden=true;el('Unknown').hidden=true;el('Checks').replaceChildren();el('Diff').replaceChildren();clearHistory();fillUnits();el('Unit').value='';fillLessons();invalidate();state.focus?.focus?.();return true;
    }
    function syncAccess(){if(state.open && (!token() || token()!==state.auth))close(true);window.PlatformSubmissions?.syncAccess?.();window.AuthoringSubmissions?.syncAccess?.();window.LessonAuthoring?.syncAccess?.();}
    window.PlatformManage={open,close,syncAccess};
})();
/* PLATFORM_SELF_SERVICE_END */

