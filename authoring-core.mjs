// SCIENCE_AUTHORING_CORE_V1: shared strict source contract. No real lesson/answer data.
export const FORMAT='science-authoring';
export const VERSION=1;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const TYPES=['text','image','choice','number','short','table','circuit'];
const questions=new Set(['choice','number','short']);
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function fail(message){const e=new Error(message);e.code='invalid_authoring_source';throw e;}
function shape(o,fields,label){if(!object(o)||Object.keys(o).some(k=>!fields.includes(k)))fail(label+'의 항목 형식을 확인하세요.');}
function text(x,label,max=10000,empty=true){if(typeof x!=='string'||x.length>max||(!empty&&!x.trim())||/\u0000/.test(x))fail(label+'을 확인하세요.');return x;}
function finite(x,label,min=-1e12,max=1e12){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)fail(label+'의 수치 범위를 확인하세요.');return x;}
function integer(x,label,min,max){finite(x,label,min,max);if(!Number.isInteger(x))fail(label+'은 정수로 입력하세요.');return x;}
function bool(x,label){if(typeof x!=='boolean')fail(label+'은 체크 항목이어야 합니다.');return x;}
export function defaultPolicy(){return {enabled:false,printCenter:false,studentPrint:false,points:{mode:'none',amount:0,tiers:[]}};}
export function validatePolicy(value){
 const p=value??defaultPolicy();shape(p,['enabled','printCenter','studentPrint','points'],'제출 설정');
 bool(p.enabled,'제출 허용');bool(p.printCenter,'인쇄센터 표시');bool(p.studentPrint,'학생 인쇄');
 shape(p.points,['mode','amount','tiers'],'포인트 설정');const q=p.points;
 if(!['none','fixed','score','review'].includes(q.mode))fail('포인트 지급 방식을 확인하세요.');
 integer(q.amount,'지급 포인트',0,1000);if(!Array.isArray(q.tiers)||q.tiers.length>10)fail('점수 구간은 최대 10개입니다.');
 const seen=new Set();for(const tier of q.tiers){shape(tier,['minPercent','points'],'점수 구간');finite(tier.minPercent,'구간 정답률',0,100);integer(tier.points,'구간 포인트',0,1000);if(seen.has(tier.minPercent))fail('같은 점수 구간을 중복 지정할 수 없습니다.');seen.add(tier.minPercent);}
 if(q.mode==='score'&&!q.tiers.length)fail('점수별 지급 구간을 하나 이상 입력하세요.');
 return {enabled:p.enabled,printCenter:p.printCenter,studentPrint:p.studentPrint,points:{mode:q.mode,amount:q.amount,tiers:q.tiers.map(t=>({...t})).sort((a,b)=>b.minPercent-a.minPercent)}};
}
export function validateSource(value){
 shape(value,['format','version','id','title','description','mode','blocks'],'제작 원본');
 if(value.format!==FORMAT||value.version!==VERSION||!UUID.test(value.id||''))fail('지원하는 제작 원본 형식과 식별자가 아닙니다.');
 text(value.title,'자료 제목',200,false);text(value.description,'자료 설명',3000);if(!['lesson','exam','activity'].includes(value.mode))fail('자료 형태를 확인하세요.');
 if(!Array.isArray(value.blocks)||value.blocks.length>100)fail('블록은 최대 100개입니다.');
 const seen=new Set();let imageBytes=0;
 for(const b of value.blocks){
  if(!object(b)||!TYPES.includes(b.type)||!ID.test(b.id||'')||seen.has(b.id))fail('블록 유형이나 중복 식별자를 확인하세요.');seen.add(b.id);
  const extra={text:[],image:['src','alt','caption'],choice:['options','correct','points','required','explanation'],number:['answer','tolerance','unit','points','required','explanation'],short:['modelAnswer','points','required','explanation'],table:['headers','rows'],circuit:['layout','voltage','resistors']}[b.type];
  shape(b,['id','type','title','body',...extra],'블록');text(b.title,'블록 제목',200);text(b.body,'내용',10000);
  if(questions.has(b.type)){if(!b.title.trim()&&!b.body.trim())fail('문제의 제목이나 내용을 입력하세요.');integer(b.points,'배점',0,100);bool(b.required,'필수 응답');text(b.explanation,'해설',10000);}
  if(b.type==='image'){
   text(b.alt,'이미지 대체 설명',500,false);text(b.caption,'이미지 설명',3000);
   if(typeof b.src!=='string'||!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.src)||b.src.length>1400000)fail('이미지는 1 MiB 이하 PNG·JPEG·WebP 파일로 넣어 주세요.');
   const data=b.src.split(',')[1];if(data.length%4!==0)fail('이미지 데이터 형식을 확인하세요.');imageBytes+=b.src.length;
  }
  if(b.type==='choice'){
   if(!Array.isArray(b.options)||b.options.length<2||b.options.length>8)fail('객관식 보기는 2~8개입니다.');
   const ids=new Set();for(const o of b.options){shape(o,['id','text'],'보기');if(!ID.test(o.id||'')||ids.has(o.id))fail('보기 식별자가 중복되었거나 올바르지 않습니다.');ids.add(o.id);text(o.text,'보기',2000,false);}
   if(!ids.has(b.correct))fail('객관식 정답 보기를 선택하세요.');
  }
  if(b.type==='number'){finite(b.answer,'정답');finite(b.tolerance,'허용 오차',0);text(b.unit,'단위',30);}
  if(b.type==='short')text(b.modelAnswer,'모범답안',10000);
  if(b.type==='table'){
   if(!Array.isArray(b.headers)||b.headers.length<1||b.headers.length>10||!Array.isArray(b.rows)||b.rows.length>30)fail('표는 1~10열, 최대 30행입니다.');
   b.headers.forEach(h=>text(h,'표 머리글',200));b.rows.forEach(r=>{if(!Array.isArray(r)||r.length!==b.headers.length)fail('표의 열 수가 일치하지 않습니다.');r.forEach(c=>text(c,'표 내용',2000));});
  }
  if(b.type==='circuit'){
   if(!['single','series','parallel'].includes(b.layout)||!Array.isArray(b.resistors)||b.resistors.length!==(b.layout==='single'?1:2))fail('회로 형태와 저항 개수를 확인하세요.');
   finite(b.voltage,'전압',0,1e6);b.resistors.forEach(r=>finite(r,'저항',0.000001,1e9));
  }
 }
 if(imageBytes>2500000||new TextEncoder().encode(JSON.stringify(value)).length>2800000)fail('이미지와 제작 내용의 전체 용량을 줄여 주세요.');
 return JSON.parse(JSON.stringify(value));
}
export function publicSource(value){const s=validateSource(value);for(const b of s.blocks)for(const k of ['correct','answer','tolerance','modelAnswer','explanation'])delete b[k];return s;}
function numberResponse(value,unit){
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||value.length>200)return null;
 let s=value.trim().replace(/−/g,'-');if(unit&&s.endsWith(unit))s=s.slice(0,-unit.length).trim();
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s))return null;
 const n=Number(s);return Number.isFinite(n)?n:null;
}
export function gradeAnswers(value,answers){
 const s=validateSource(value);if(!object(answers)||Object.keys(answers).some(k=>!s.blocks.some(b=>questions.has(b.type)&&b.id===k)))fail('응답에 알 수 없는 문항이 있습니다.');
 const missing=[],results=[];let score=0,maxScore=0,pending=false;
 for(const b of s.blocks.filter(b=>questions.has(b.type))){
  const a=answers[b.id],blank=a==null||a==='';let valid=!blank,correct=false,expected='',points=0;
  if(b.type==='choice'){valid=typeof a==='string'&&b.options.some(o=>o.id===a);correct=valid&&a===b.correct;expected=b.options.find(o=>o.id===b.correct).text;}
  if(b.type==='number'){const n=numberResponse(a,b.unit);valid=n!==null;correct=valid&&Math.abs(n-b.answer)<=b.tolerance+Number.EPSILON*8*Math.max(1,Math.abs(b.answer));expected=String(b.answer)+(b.unit?' '+b.unit:'');}
  if(b.type==='short'){valid=typeof a==='string'&&a.length<=20000&&a.trim().length>0;correct=valid?null:false;expected=b.modelAnswer;if(valid)pending=true;}
  if(!valid&&b.required)missing.push(b.id);if(!blank&&!valid)missing.push(b.id);
  points=correct===true?b.points:0;score+=points;maxScore+=b.points;
  results.push({id:b.id,points,maxPoints:b.points,correct,explanation:b.explanation,expected});
 }
 return {complete:missing.length===0,missing:[...new Set(missing)],score,maxScore,status:pending?'pending_review':'graded',results};
}
export function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const json=x=>JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
export function extractAuthoring(html){
 if(typeof html!=='string'||new TextEncoder().encode(html).length>3*1024*1024)fail('HTML은 3 MiB 이하여야 합니다.');
 const found=[];const scripts=html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi);
 for(const m of scripts){const ids=[...m[1].matchAll(/\bid\s*=\s*(["'])(.*?)\1/gi)];if(ids.some(x=>x[2]==='science-authoring-source')){if(ids.length!==1||!/(?:^|\s)type\s*=\s*(["'])application\/json\1/i.test(m[1]))fail('제작 원본 블록 형식을 확인하세요.');found.push(m[2]);}}
 if(!found.length){if(/science-authoring-(?:source|version)/i.test(html))fail('제작 원본 정보가 없거나 손상되었습니다. 학생 표시용 HTML은 편집 원본으로 가져올 수 없습니다.');return null;}
 if(found.length!==1)fail('제작 원본 정보가 중복되었습니다.');let o;try{o=JSON.parse(found[0]);}catch{fail('제작 원본 JSON을 읽지 못했습니다.');}
 shape(o,['source','policy'],'제작 원본 묶음');return {source:validateSource(o.source),policy:validatePolicy(o.policy)};
}
export function parseSourceHTML(html){const result=extractAuthoring(html);if(!result)fail('이 제작기에서 내보낸 HTML 원본을 선택하세요. 기존 HTML은 수업 자료 등록에서 사용할 수 있습니다.');return result;}
function makeHTML(source,policy,runtimeCode,metadata,privateOriginal){
 const s=validateSource(source),p=validatePolicy(policy);
 if(typeof runtimeCode!=='string'||!runtimeCode.includes('ScienceAuthoringRuntime')||/<\/script/i.test(runtimeCode))fail('공통 수업 실행 파일을 확인하지 못했습니다.');
 let meta='';if(metadata!=null){shape(metadata,['unitKey','lessonId','lessonOrder','title','description','tags','worksheetPdf','category','adminOnly'],'등록 정보');meta='<script type="application/json" id="science-lesson-meta">'+json(metadata)+'</script>\n';}
 const doc='<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="science-authoring-version" content="1"><title>'+escapeHtml(s.title)+'</title>\n'+meta+(privateOriginal?'<script type="application/json" id="science-authoring-source">'+json({source:s,policy:p})+'</script>\n':'')+'<script type="application/json" id="science-authoring-public">'+json({source:publicSource(s),policy:p})+'</script>\n</head><body><main id="saLesson"></main><noscript>자료를 보려면 JavaScript를 활성화해 주세요.</noscript><script>'+runtimeCode+'</script></body></html>\n';
 if(new TextEncoder().encode(doc).length>3*1024*1024)fail('전체 HTML이 3 MiB를 초과합니다. 이미지나 내용을 줄여 주세요.');return doc;
}
export function renderSourceHTML(source,policy,runtimeCode,metadata){return makeHTML(source,policy,runtimeCode,metadata,true);}
export function renderProtectedHTML(source,policy,runtimeCode,metadata){return makeHTML(source,policy,runtimeCode,metadata,false);}
