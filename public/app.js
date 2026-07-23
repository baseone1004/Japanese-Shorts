const $ = (id) => document.getElementById(id);

/** 마지막 실행 결과. 복사/CSV/모드 전달에서 재사용한다. */
const state = { gen: null, trans: null, meta: null, imgp: null, disc: null };

/** 발굴 기능으로 추가된 카테고리. 프리셋 전체를 서버로 함께 보낸다. */
const customCategories = JSON.parse(localStorage.getItem('js:customCategories') ?? '{}');

// ─── 탭 ──────────────────────────────────────────────────────────────────

function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tabpane').forEach((p) => (p.hidden = p.dataset.pane !== name));
  localStorage.setItem('js:tab', name);
}

$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab');
  if (btn) showTab(btn.dataset.tab);
});

// ─── 카테고리 ────────────────────────────────────────────────────────────

async function loadCategories() {
  const { categories } = await (await fetch('/api/categories')).json();
  const builtin = categories.map((c) => `<option value="${c.id}">${c.label}</option>`);
  // 이전에 발굴해서 저장해 둔 카테고리를 목록 끝에 되살린다.
  const custom = Object.entries(customCategories).map(
    ([value, c]) => `<option value="${value}">⭐ ${esc(c.label)}</option>`,
  );
  $('category').innerHTML = builtin.concat(custom).join('');

  const saved = localStorage.getItem('js:category');
  if (saved && $('category').querySelector(`option[value="${CSS.escape(saved)}"]`)) {
    $('category').value = saved;
  }
}

$('category').addEventListener('change', () => localStorage.setItem('js:category', $('category').value));

// ─── 공통 요청 ───────────────────────────────────────────────────────────

async function post(url, payload, statusEl, btn, pendingMsg) {
  btn.disabled = true;
  setStatus(statusEl, pendingMsg, 'pending');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: $('category').value,
        // 커스텀 카테고리는 서버에 프리셋이 없으므로 내용을 함께 보낸다.
        customCategory: customCategories[$('category').value],
        extraInstructions: $('extra').value,
        ...payload,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  } finally {
    btn.disabled = false;
  }
}

/** kind: 'pending' | 'done' | 'error' — 스피너/체크/색상을 CSS가 결정한다. */
function setStatus(el, msg, kind = 'done') {
  el.textContent = msg;
  el.classList.remove('pending', 'done', 'error');
  el.classList.add(kind);
}

function doneMsg(body, extra = '') {
  return (
    `완료 · ${extra}토큰 ${body.usage.input}/${body.usage.output}` +
    (body.truncated ? ' · ⚠ 출력이 잘렸을 수 있습니다' : '')
  );
}

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

// ─── ①-A 주제 추천 ───────────────────────────────────────────────────────

$('runTopics').addEventListener('click', async () => {
  const status = $('statusTopics');
  try {
    const body = await post('/api/topics', {}, status, $('runTopics'), '주제 뽑는 중…');
    renderTopics(body);
    setStatus(status, `${body.result.topics.length}개 제안 · 카드를 누르면 그 주제로 대본을 만듭니다.`);
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

const DIFF = { easy: '쉬움', normal: '보통', hard: '어려움' };

function renderTopics(body) {
  $('topicList').innerHTML = body.result.topics
    .map(
      (t, i) => `
      <button class="topic-card" data-topic="${esc(t.titleKo)}">
        <span class="topic-num">${String(i + 1).padStart(2, '0')}</span>
        <span class="topic-body">
          <span class="topic-title">${esc(t.titleKo)}</span>
          <span class="topic-hook">${esc(t.hookJa)}</span>
          <span class="topic-reason">${esc(t.reasonKo)}</span>
        </span>
        <span class="topic-diff d-${t.difficulty}">${DIFF[t.difficulty] ?? t.difficulty}</span>
      </button>`,
    )
    .join('');
  $('topicList').hidden = false;
}

// 카드를 누르면 주제 칸을 채우고 곧바로 대본 생성까지 이어간다.
$('topicList').addEventListener('click', (e) => {
  const card = e.target.closest('.topic-card');
  if (!card) return;
  $('topic').value = card.dataset.topic;
  $('topicList')
    .querySelectorAll('.topic-card')
    .forEach((c) => c.classList.toggle('picked', c === card));
  $('runGen').click();
});

// ─── ① 대본 생성 ─────────────────────────────────────────────────────────

$('runGen').addEventListener('click', async () => {
  const status = $('statusGen');
  try {
    const body = await post(
      '/api/script',
      { topic: $('topic').value, seconds: Number($('seconds').value) },
      status,
      $('runGen'),
      '대본 작성 중… 30초~1분 정도 걸립니다.',
    );
    state.gen = body;
    renderGen(body);
    setStatus(status, doneMsg(body, `${body.result.rows.length}행 · `));
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

function renderGen(body) {
  const r = body.result;
  $('genTopic').textContent = r.topicKo;
  $('genInfo').textContent = `${body.categoryLabel} · 약 ${r.totalSeconds}초 · ${r.rows.length}컷 · 주제(JA): ${r.topicJa}`;
  $('genBody').innerHTML = r.rows
    .map(
      (row) =>
        `<tr><td class="tl">${esc(row.timeline)}</td><td class="ja-cell">${esc(row.ja)}</td><td>${esc(row.ko)}</td></tr>`,
    )
    .join('');
  $('genNote').textContent = r.productionNoteKo;
  $('resGen').hidden = false;
}

// 생성된 대본을 다른 탭으로 넘긴다.
function genAsText(lang) {
  return state.gen.result.rows
    .map((r) => `${r.timeline} ${lang === 'ja' ? r.ja : r.ko}`.trim())
    .join('\n');
}

$('toTranslate').addEventListener('click', () => {
  if (!state.gen) return;
  // 번역 탭은 한국어 원문을 받는 흐름이므로 한국어 해석을 넘긴다.
  $('scriptTrans').value = genAsText('ko');
  showTab('trans');
});

$('toMeta').addEventListener('click', () => {
  if (!state.gen) return;
  $('scriptMeta').value = genAsText('ja');
  showTab('meta');
});

// ─── ② 대본 번역 ─────────────────────────────────────────────────────────

$('runTrans').addEventListener('click', async () => {
  const status = $('statusTrans');
  const script = $('scriptTrans').value.trim();
  if (!script) return setStatus(status, '대본을 입력하세요.', 'error');

  try {
    const body = await post('/api/translate', { script }, status, $('runTrans'), '번역 중… 30초~2분 정도 걸립니다.');
    state.trans = body;
    renderTrans(body);
    setStatus(status, doneMsg(body, `${body.result.rows.length}행 · `));
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

function renderTrans(body) {
  const r = body.result;
  const hasKo = r.sourceLanguage !== 'ko';

  $('transTitles').innerHTML = r.titles
    .map((t) => `<li><div class="t-ja">${esc(t.ja)}</div><div class="t-ko">${esc(t.ko)}</div></li>`)
    .join('');
  $('transDescJa').textContent = r.descriptionJa;
  $('transDescKo').textContent = r.descriptionKo;
  $('transTags').textContent = r.tags.join(' ');
  $('transInfo').textContent =
    `원문: ${r.sourceLanguageName} · ${body.categoryLabel}` +
    (hasKo ? ' · 한국어 번역 열 포함' : ' · 한국어 원문이므로 번역 열 생략');

  const headers = hasKo
    ? ['타임라인', '원문', '한국어 번역', '일본어 번역']
    : ['타임라인', '원문', '일본어 번역'];
  $('transHead').innerHTML = `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  $('transBody').innerHTML = r.rows
    .map((row) => {
      const cells = [`<td class="tl">${esc(row.timeline)}</td>`, `<td>${esc(row.source)}</td>`];
      if (hasKo) cells.push(`<td>${esc(row.ko ?? '')}</td>`);
      cells.push(`<td class="ja-cell">${esc(row.ja)}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  $('resTrans').hidden = false;
}

// ─── ③ 메타데이터 ────────────────────────────────────────────────────────

$('runMeta').addEventListener('click', async () => {
  const status = $('statusMeta');
  const script = $('scriptMeta').value.trim();
  if (!script) return setStatus(status, '대본 또는 영상 설명을 입력하세요.', 'error');

  try {
    const body = await post('/api/metadata', { script }, status, $('runMeta'), '메타데이터 생성 중…');
    state.meta = body;
    renderMeta(body);
    setStatus(status, doneMsg(body));
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

function renderMeta(body) {
  const r = body.result;

  const card = (x) =>
    `<li><div class="angle">${esc(x.angleKo)}</div>` +
    `<div class="t-ja">${esc(x.ja)}</div>` +
    `<div class="t-ko">${esc(x.ko)}</div></li>`;

  $('metaTitles').innerHTML = r.titles.map(card).join('');
  $('metaDescs').innerHTML = r.descriptions.map(card).join('');
  $('metaTagsJa').textContent = r.tags.map((t) => t.ja).join(' ');
  $('metaTagsKo').textContent = r.tags.map((t) => t.ko).join(' ');
  $('resMeta').hidden = false;
}

$('copyMeta').addEventListener('click', async (e) => {
  if (!state.meta) return;
  const r = state.meta.result;
  const text = [
    '## 1. 일본어 제목 (3안)',
    ...r.titles.map((t, i) => `${i + 1}. [${t.angleKo}] ${t.ja}\n   해석: ${t.ko}`),
    '',
    '## 2. 일본어 설명 (3안)',
    ...r.descriptions.map((d, i) => `${i + 1}. [${d.angleKo}] ${d.ja}\n   해석: ${d.ko}`),
    '',
    '## 3. 태그 (5개)',
    `* ${r.tags.map((t) => t.ja).join(' ')}`,
    `* 한국어 해석: ${r.tags.map((t) => t.ko).join(' ')}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  flash(e.target, '복사됨!');
});

// ─── ④ 이미지 프롬프트 ───────────────────────────────────────────────────

const SHEET_KEY = 'js:characterSheet';
/** 저장 당시의 기본값. 사용자가 직접 고쳤는지 판별하는 데 쓴다. */
const SHEET_BASE_KEY = 'js:characterSheetBase';
let defaultSheet = '';

async function loadCharacterSheet() {
  const { characterSheet } = await (await fetch('/api/character-sheet')).json();
  defaultSheet = characterSheet;

  const saved = localStorage.getItem(SHEET_KEY);
  const savedBase = localStorage.getItem(SHEET_BASE_KEY);

  // 사용자가 손대지 않은 상태라면 새 기본값으로 갱신한다.
  // (기본 묘사를 개선해도 브라우저에 옛 버전이 남아 반영되지 않던 문제)
  const untouched = saved == null || saved === savedBase;
  $('characterSheet').value = untouched ? characterSheet : saved;

  localStorage.setItem(SHEET_BASE_KEY, characterSheet);
  if (untouched) localStorage.setItem(SHEET_KEY, characterSheet);
}

$('characterSheet').addEventListener('input', () =>
  localStorage.setItem(SHEET_KEY, $('characterSheet').value),
);

$('resetSheet').addEventListener('click', () => {
  $('characterSheet').value = defaultSheet;
  localStorage.setItem(SHEET_KEY, defaultSheet);
});

// ① 대본을 일본어 대사 기준으로 가져온다 (그림은 대사 내용에 맞춰 그려야 하므로).
$('imgpFromScript').addEventListener('click', () => {
  if (!state.gen) return setStatus($('statusImgp'), '먼저 ① 탭에서 대본을 만드세요.', 'error');
  $('scriptImgp').value = state.gen.result.rows
    .map((r) => `${r.timeline} ${r.ja}  (${r.ko})`)
    .join('\n');
  setStatus($('statusImgp'), `① 대본 ${state.gen.result.rows.length}컷을 가져왔습니다.`);
});

$('runImgp').addEventListener('click', async () => {
  const status = $('statusImgp');
  const script = $('scriptImgp').value.trim();
  if (!script) return setStatus(status, '대본을 입력하거나 ①에서 가져오세요.', 'error');

  try {
    const body = await post(
      '/api/imageprompts',
      { script, characterSheet: $('characterSheet').value },
      status,
      $('runImgp'),
      '컷별 프롬프트 작성 중…',
    );
    state.imgp = body;
    $('imgpBody').innerHTML = body.result.prompts
      .map(
        (p) =>
          `<tr><td class="tl">${esc(p.timeline)}</td><td>${esc(p.sceneKo)}</td><td class="prompt-cell">${esc(p.prompt)}</td></tr>`,
      )
      .join('');
    $('resImgp').hidden = false;
    setStatus(status, doneMsg(body, `${body.result.prompts.length}컷 · `));
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

// ─── ⚡ 한번에 만들기 ────────────────────────────────────────────────────

const VOICE_KEY = 'js:voiceId';

async function loadAutoStatus() {
  try {
    const s = await (await fetch('/api/auto/status')).json();
    const bar = $('autoStatus');
    const sel = $('autoVoice');

    if (!s.hasTts) {
      bar.className = 'statusbar warn';
      bar.textContent =
        '⚠ TYPECAST_API_KEY가 없어 음성 없이 만들어집니다. .env에 키를 넣으면 음성과 정확한 자막이 함께 생성됩니다.';
      sel.innerHTML = '<option value="">(키 없음)</option>';
      return;
    }

    if (s.voiceError) {
      bar.className = 'statusbar warn';
      bar.textContent = `⚠ 목소리 목록을 못 불러왔습니다: ${s.voiceError}`;
      sel.innerHTML = '<option value="">(불러오기 실패)</option>';
      return;
    }

    bar.className = 'statusbar ok';
    bar.textContent = `✓ 저장 위치: ${s.outputRoot} · 하루 최대 ${s.dailyLimit}편`;

    sel.innerHTML = s.voices
      .map((v) => `<option value="${esc(v.id)}">${esc(v.name)} (${esc(v.gender ?? '')})</option>`)
      .join('');

    const saved = localStorage.getItem(VOICE_KEY);
    if (saved && s.voices.some((v) => v.id === saved)) sel.value = saved;
  } catch {
    /* 상태 표시는 부가 기능이라 실패해도 앱은 그대로 쓴다 */
  }
}

$('autoVoice').addEventListener('change', () =>
  localStorage.setItem(VOICE_KEY, $('autoVoice').value),
);

$('runAuto').addEventListener('click', async () => {
  const btn = $('runAuto');
  const status = $('statusAuto');
  const log = $('autoLog');

  btn.disabled = true;
  log.hidden = false;
  log.innerHTML = '';
  $('resAuto').hidden = true;
  setStatus(status, '시작하는 중…', 'pending');

  const started = Date.now();
  const tick = setInterval(() => {
    const s = Math.floor((Date.now() - started) / 1000);
    setStatus(status, `진행 중… ${Math.floor(s / 60)}분 ${s % 60}초 경과`, 'pending');
  }, 1000);

  const addLine = (msg) => {
    const el = document.createElement('div');
    el.className = 'autolog-line';
    el.textContent = msg;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  };

  try {
    const res = await fetch('/api/auto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: $('category').value,
        customCategory: customCategories[$('category').value],
        extraInstructions: $('extra').value,
        topic: $('autoTopic').value,
        seconds: Number($('autoSeconds').value),
        voiceId: $('autoVoice').value,
        emotion: $('autoEmotion').value,
        characterSheet: $('characterSheet').value,
      }),
    });

    // 진행 상황이 줄 단위 JSON으로 흘러온다.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = null;
    let failed = null;

    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.type === 'progress') addLine(ev.message);
        else if (ev.type === 'done') done = ev.result;
        else if (ev.type === 'error') failed = ev.message;
      }
    }

    clearInterval(tick);

    if (failed) throw new Error(failed);
    if (!done) throw new Error('결과를 받지 못했습니다.');

    renderAuto(done);
    const secs = Math.round((Date.now() - started) / 1000);
    setStatus(status, `완료 · ${secs}초 소요 · 오늘 ${done.remainingToday}편 더 만들 수 있습니다.`);
  } catch (err) {
    clearInterval(tick);
    setStatus(status, err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

function renderAuto(r) {
  $('autoBadge').textContent = r.durationSec ? `${r.durationSec.toFixed(1)}초` : '음성 없음';
  $('autoFolder').textContent = r.folder;
  $('autoFiles').innerHTML = r.files.map((f) => `<li><code>${esc(f)}</code></li>`).join('');
  $('resAuto').hidden = false;
}

// ─── ＋ 카테고리 발굴 ────────────────────────────────────────────────────

const EFFORT = { easy: '쉬움', normal: '보통', hard: '어려움' };
const CONF = { high: '근거 탄탄', medium: '보통', low: '추측성' };

$('runDisc').addEventListener('click', async () => {
  const status = $('statusDisc');
  try {
    const body = await post(
      '/api/discover',
      { count: Number($('discCount').value), extraInstructions: $('discHint').value },
      status,
      $('runDisc'),
      '새 장르 찾는 중…',
    );
    state.disc = body;
    renderIdeas(body.result.ideas);
    setStatus(status, doneMsg(body, `${body.result.ideas.length}개 · `));
  } catch (err) {
    setStatus(status, err.message, 'error');
  }
});

function renderIdeas(ideas) {
  $('discList').innerHTML = ideas
    .map(
      (x, i) => `
      <div class="idea">
        <div class="idea-head">
          <span class="idea-label">${esc(x.label)}</span>
          <span class="idea-badges">
            <span class="topic-diff d-${x.effort}">${EFFORT[x.effort] ?? x.effort}</span>
            <span class="conf c-${x.confidence}">${CONF[x.confidence] ?? x.confidence}</span>
          </span>
        </div>
        <p class="idea-why">${esc(x.whyKo)}</p>
        <p class="idea-risk"><strong>약점:</strong> ${esc(x.riskKo)}</p>
        <p class="idea-hooks">${x.hooks.map(esc).join(' / ')}</p>
        <p class="idea-tags">${x.tags.map(esc).join(' ')}</p>
        <button class="use-idea" data-idx="${i}">이 카테고리로 주제 뽑기</button>
      </div>`,
    )
    .join('');
  $('resDisc').hidden = false;
}

// 발굴한 카테고리를 임시 카테고리로 등록하고 ① 탭으로 이동한다.
$('discList').addEventListener('click', (e) => {
  const btn = e.target.closest('.use-idea');
  if (!btn || !state.disc) return;
  const idea = state.disc.result.ideas[Number(btn.dataset.idx)];

  const sel = $('category');
  let opt = sel.querySelector(`option[value="custom:${idea.id}"]`);
  if (!opt) {
    opt = document.createElement('option');
    opt.value = `custom:${idea.id}`;
    opt.textContent = `⭐ ${idea.label}`;
    sel.appendChild(opt);
  }
  customCategories[`custom:${idea.id}`] = idea;
  sel.value = `custom:${idea.id}`;
  localStorage.setItem('js:category', sel.value);
  localStorage.setItem('js:customCategories', JSON.stringify(customCategories));

  showTab('gen');
  $('runTopics').click();
});

// ─── 표 내보내기 (생성 / 번역 공용) ──────────────────────────────────────

/** 화면에 보이는 표와 동일한 2차원 배열을 만든다. */
function matrix(which) {
  if (which === 'gen') {
    const r = state.gen.result;
    return [['타임라인', '일본어 대사', '한국어 해석'], ...r.rows.map((x) => [x.timeline, x.ja, x.ko])];
  }
  if (which === 'imgp') {
    const r = state.imgp.result;
    return [
      ['타임라인', '장면', '이미지 프롬프트'],
      ...r.prompts.map((x) => [x.timeline, x.sceneKo, x.prompt]),
    ];
  }
  const r = state.trans.result;
  const hasKo = r.sourceLanguage !== 'ko';
  const head = hasKo
    ? ['타임라인', '원문', '한국어 번역', '일본어 번역']
    : ['타임라인', '원문', '일본어 번역'];
  const rows = r.rows.map((x) =>
    hasKo ? [x.timeline, x.source, x.ko ?? '', x.ja] : [x.timeline, x.source, x.ja],
  );
  return [head, ...rows];
}

document.addEventListener('click', async (e) => {
  const copyKey = e.target.dataset?.copy;
  const csvKey = e.target.dataset?.csv;

  if (copyKey && state[copyKey]) {
    // 탭 구분 → 엑셀/스프레드시트에 붙여넣으면 셀이 분리된다.
    const tsv = matrix(copyKey)
      .map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t'))
      .join('\n');
    await navigator.clipboard.writeText(tsv);
    flash(e.target, '복사됨!');
  }

  if (csvKey && state[csvKey]) {
    const csv = matrix(csvKey)
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    // Excel이 UTF-8로 열도록 BOM 추가
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shorts-${csvKey}-${state[csvKey].category}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
});

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1400);
}

// ─── 시작 ────────────────────────────────────────────────────────────────

loadCategories();
loadCharacterSheet();
loadAutoStatus();
showTab(localStorage.getItem('js:tab') ?? 'gen');
