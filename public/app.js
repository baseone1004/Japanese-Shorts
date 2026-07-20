const $ = (id) => document.getElementById(id);

/** 마지막 실행 결과. 복사/CSV/모드 전달에서 재사용한다. */
const state = { gen: null, trans: null, meta: null };

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
  $('category').innerHTML = categories.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
  const saved = localStorage.getItem('js:category');
  if (saved && categories.some((c) => c.id === saved)) $('category').value = saved;
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
  $('metaTitleJa').textContent = r.titleJa;
  $('metaTitleKo').textContent = r.titleKo;
  $('metaDescJa').textContent = r.descriptionJa;
  $('metaDescKo').textContent = r.descriptionKo;
  $('metaTagsJa').textContent = r.tags.map((t) => t.ja).join(' ');
  $('metaTagsKo').textContent = r.tags.map((t) => t.ko).join(' ');
  $('resMeta').hidden = false;
}

$('copyMeta').addEventListener('click', async (e) => {
  if (!state.meta) return;
  const r = state.meta.result;
  const text = [
    '## 1. 일본어 제목',
    `* ${r.titleJa} (${r.titleKo})`,
    '',
    '## 2. 일본어 설명',
    `* ${r.descriptionJa}`,
    `* 한국어 해석: ${r.descriptionKo}`,
    '',
    '## 3. 태그 (5개)',
    `* ${r.tags.map((t) => t.ja).join(' ')}`,
    `* 한국어 해석: ${r.tags.map((t) => t.ko).join(' ')}`,
  ].join('\n');
  await navigator.clipboard.writeText(text);
  flash(e.target, '복사됨!');
});

// ─── 표 내보내기 (생성 / 번역 공용) ──────────────────────────────────────

/** 화면에 보이는 표와 동일한 2차원 배열을 만든다. */
function matrix(which) {
  if (which === 'gen') {
    const r = state.gen.result;
    return [['타임라인', '일본어 대사', '한국어 해석'], ...r.rows.map((x) => [x.timeline, x.ja, x.ko])];
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
showTab(localStorage.getItem('js:tab') ?? 'gen');
