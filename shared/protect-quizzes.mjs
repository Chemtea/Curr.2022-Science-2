// Pure Node/Deno module. Never evaluate uploaded JavaScript.
export const PROTECTED_QUIZ_VERSION = '20260914-1';

function fail(message) {
  throw new Error(`형성평가 보호 변환 실패: ${message}`);
}

// Deliberately restricted JavaScript data literals: strings, finite numbers,
// booleans, null, arrays and objects. Executable expressions fail closed.
export function parseDataLiteral(source, start = 0) {
  let at = start;
  const skip = () => {
    for (;;) {
      while (/\s/.test(source[at] || '') && at < source.length) at++;
      if (source.startsWith('//', at)) {
        const end = source.indexOf('\n', at + 2);
        at = end < 0 ? source.length : end + 1;
      } else if (source.startsWith('/*', at)) {
        const end = source.indexOf('*/', at + 2);
        if (end < 0) fail('닫히지 않은 주석입니다.');
        at = end + 2;
      } else return;
    }
  };
  function string() {
    const quote = source[at++];
    let result = '';
    while (at < source.length) {
      const char = source[at++];
      if (char === quote) return result;
      if (quote === '`' && char === '$' && source[at] === '{') fail('문자열 보간은 지원하지 않습니다.');
      if (char !== '\\') {
        if (quote !== '`' && /[\r\n]/.test(char)) fail('문자열 안의 줄바꿈입니다.');
        result += char;
        continue;
      }
      const escaped = source[at++];
      const simple = {n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', v:'\v', '0':'\0', '\\':'\\', "'":"'", '"':'"', '`':'`', '/':'/', '$':'$'};
      if (escaped === '\n') continue;
      if (escaped === '\r') { if (source[at] === '\n') at++; continue; }
      if (escaped === 'x' || escaped === 'u') {
        const length = escaped === 'x' ? 2 : 4;
        const hex = source.slice(at, at + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(hex)) fail('지원하지 않는 문자 이스케이프입니다.');
        result += String.fromCharCode(parseInt(hex, 16));
        at += length;
      } else if (Object.hasOwn(simple, escaped)) {
        if (escaped === '0' && /[0-9]/.test(source[at] || '')) fail('8진수 이스케이프는 지원하지 않습니다.');
        result += simple[escaped];
      } else fail('지원하지 않는 문자 이스케이프입니다.');
    }
    fail('닫히지 않은 문자열입니다.');
  }
  function value(depth = 0) {
    if (depth > 20) fail('데이터 중첩이 너무 깊습니다.');
    skip();
    const char = source[at];
    if (char === '"' || char === "'" || char === '`') return string();
    if (char === '{' || char === '[') {
      const object = char === '{';
      const close = object ? '}' : ']';
      const result = object ? Object.create(null) : [];
      at++; skip();
      while (source[at] !== close) {
        let key;
        if (object) {
          if (source[at] === '"' || source[at] === "'") key = string();
          else {
            const match = /^(?:[A-Za-z_$][\w$]*|\d+)/.exec(source.slice(at));
            if (!match) fail('지원하지 않는 객체 키입니다.');
            key = match[0]; at += key.length;
          }
          if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) fail('허용되지 않거나 중복된 객체 키입니다.');
          skip();
          if (source[at++] !== ':') fail('객체의 콜론이 없습니다.');
        }
        const next = value(depth + 1);
        if (object) result[key] = next; else result.push(next);
        skip();
        if (source[at] === close) break;
        if (source[at++] !== ',') fail('객체 또는 배열 구분자가 없습니다.');
        skip();
      }
      at++;
      return result;
    }
    const token = /^(?:true\b|false\b|null\b|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at));
    if (!token) fail('데이터 안의 실행식 또는 지원하지 않는 문법입니다.');
    at += token[0].length;
    const result = JSON.parse(token[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) fail('유한하지 않은 숫자입니다.');
    return result;
  }
  const result = value();
  const end = at;
  skip();
  return {value:result, start, end, next:at};
}

function lessonIdentity(html) {
  const marker = '/* ML:EDIT:CONFIG:START */';
  const index = html.indexOf(marker);
  if (index !== -1) {
    const config = parseDataLiteral(html, index + marker.length).value;
    const match = /^u(\d+)_l(\d+)$/.exec(config.lessonKey || '');
    if (!match || config.unitKey !== `unit${match[1]}` || config.templateMode !== false) fail('실제 차시 설정이 필요합니다.');
    return config.lessonKey;
  }
  const lesson = /\bconst\s+THIS_LESSON_ID\s*=\s*['"](u\d+_l\d+)['"]\s*;/.exec(html);
  const unit = /\bconst\s+THIS_UNIT_KEY\s*=\s*['"](unit\d+)['"]\s*;/.exec(html);
  if (!lesson || !unit || unit[1] !== `unit${/^u(\d+)_/.exec(lesson[1])[1]}`) fail('차시 식별자를 확인할 수 없습니다.');
  return lesson[1];
}

function validateQuiz(data, choices) {
  if (!data || Array.isArray(data) || Object.keys(data).join(',') !== '1,2,3,4') fail('현재 지원 형식은 1~4번 문항입니다.');
  for (let q = 1; q <= 4; q++) {
    const item = data[q];
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail(`${q}번 데이터가 올바르지 않습니다.`);
    if (Object.keys(item).some(key => !['correct', 'wrongReasons', 'wrongHint', 'correctFb', 'correctExpl'].includes(key))) fail(`${q}번에 지원하지 않는 항목이 있습니다.`);
    if (!Number.isInteger(item.correct) || !item.wrongReasons || Array.isArray(item.wrongReasons)) fail(`${q}번 정답 설정이 올바르지 않습니다.`);
    for (const field of ['wrongHint', 'correctFb', 'correctExpl']) if (typeof item[field] !== 'string') fail(`${q}번 해설이 누락되었습니다.`);
    const options = choices.filter(choice => choice.q === q);
    if (options.length < 2 || options.length > 8 || new Set(options.map(option => option.opt)).size !== options.length) fail(`${q}번 선택지 구성이 올바르지 않습니다.`);
    if (options.filter(option => option.correct).length !== 1 || !options.some(option => option.correct && option.opt === item.correct)) fail(`${q}번 데이터와 선택지 정답이 다릅니다.`);
    for (const option of options) {
      if (option.opt !== item.correct && typeof item.wrongReasons[option.opt] !== 'string') fail(`${q}번 오답 해설이 누락되었습니다.`);
    }
    for (const [option, reason] of Object.entries(item.wrongReasons)) {
      if (!options.some(choice => String(choice.opt) === option) || typeof reason !== 'string') fail(`${q}번 오답 해설 구조가 올바르지 않습니다.`);
    }
  }
}

export function transformQuiz(html) {
  if (typeof html !== 'string') fail('HTML 문자열이 필요합니다.');
  if (html.includes('CT_PROTECTED_QUIZ:')) fail('이미 보호된 배포본입니다. 정답이 포함된 교사용 원본을 업로드해 주세요.');
  const declarations = [...html.matchAll(/\b(?:const|let|var)\s+quizData\s*=/g)];
  if (!declarations.length) {
    if (/\b(?:quizData|quizInfo|handleQuiz)\b/.test(html)) fail('인식할 수 없는 형성평가 구조입니다.');
    return {html, quizData:null, lessonKey:null};
  }
  if (declarations.length !== 1 || (html.match(/\bquizData\b/g) || []).length !== 2) fail('정답 데이터의 추가 참조가 있어 안전하게 분리할 수 없습니다.');
  const lessonKey = lessonIdentity(html);
  const declaration = declarations[0];
  const parsed = parseDataLiteral(html, declaration.index + declaration[0].length);
  if (html[parsed.next] !== ';') fail('정답 데이터는 단일 리터럴이어야 합니다.');
  const choices = [];
  const optionPattern = /onclick\s*=\s*(["'])handleQuiz\(\s*([1-4])\s*,\s*this\s*,\s*(true|false)\s*,\s*([1-8])\s*\)\s*;?\1/g;
  html.replace(optionPattern, (_, quote, q, correct, opt) => {
    choices.push({q:Number(q), correct:correct === 'true', opt:Number(opt)});
    return '';
  });
  validateQuiz(parsed.value, choices);
  if ((html.match(/\bhandleQuiz\s*\(/g) || []).length !== choices.length + 1) fail('지원하지 않는 형성평가 호출이 있습니다.');
  const handler = /function\s+handleQuiz\(qNum,\s*el,\s*isCorrect,\s*optNum\)\s*\{/;
  const dataUse = /const\s+data\s*=\s*quizData\[qNum\]\s*;/;
  if (!handler.test(html) || !dataUse.test(html) || !/const\s+userQuizState\s*=/.test(html) || !/let\s+isSubmitted\s*=\s*false/.test(html)) fail('지원하지 않는 채점 함수입니다.');
  const replacement = `const quizData = Object.freeze({}); // CT_PROTECTED_QUIZ:${PROTECTED_QUIZ_VERSION}`;
  html = html.slice(0, declaration.index) + replacement + html.slice(parsed.next + 1);
  html = html.replace(optionPattern, (_, quote, q, correct, opt) => `onclick=${quote}handleQuiz(${q}, this, null, ${opt})${quote}`);
  html = html.replace(handler, `async function handleQuiz(qNum, el, isCorrect, optNum) {
            if (!isSubmitted && userQuizState[\`q\${qNum}\`] !== null) return;
            if (!window.CTProtectedQuiz) { alert('채점 기능을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.'); return; }
            const protectedAnswer = await window.CTProtectedQuiz.checkAnswer({qNum, optNum, element:el});
            if (!protectedAnswer) return;
            isCorrect = protectedAnswer.isCorrect;`);
  html = html.replace(dataUse, 'const data = protectedAnswer.feedback;');
  // The existing lock screen includes literal </head> inside a JS template.
  // Inject after the first actual opening head instead of that inner string.
  if (!/<head(?:\s[^>]*)?>/i.test(html)) fail('HTML head 시작 태그가 없습니다.');
  html = html.replace(/<head(?:\s[^>]*)?>/i, tag => `${tag}\n<script src="protected-quiz.js?v=${PROTECTED_QUIZ_VERSION}"></script>`);
  return {html, quizData:JSON.parse(JSON.stringify(parsed.value)), lessonKey};
}
