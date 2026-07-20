const $ = (id) => document.getElementById(id);

const els = {
  category: $('category'),
  categoryHint: $('categoryHint'),
  script: $('script'),
  extra: $('extra'),
  run: $('run'),
  status: $('status'),
  results: $('results'),
  titles: $('titles'),
  descJa: $('descJa'),
  descKo: $('descKo'),
  tags: $('tags'),
  metaInfo: $('metaInfo'),
  thead: $('thead'),
  tbody: $('tbody'),
  copyTsv: $('copyTsv'),
  downloadCsv: $('downloadCsv'),
};

let lastResult = null;

// ---- 초기화 -------------------------------------------------------------

async function loadCategories() {
  const res = await fetch('/api/categories');
  const { categories } = await res.json();
  els.category.innerHTML = categories
    .map((c) => `<option value="${c.id}">${c.label}</option>`)
    .join('');
  const saved = localStorage.getItem('js:category');
  if (saved && categories.some((c) => c.id === saved)) els.category.value = saved;
  updateHint();
}

function updateHint() {
  localStorage.setItem('js:category', els.category.value);
  els.categoryHint.textContent =
    '선택한 장르에 맞춰 일본어 말투 · 훅 표현 · 해시태그 스타일이 자동으로 조정됩니다.';
}

els.category.addEventListener('change', updateHint);

// ---- 실행 ---------------------------------------------------------------

async function run() {
  const script = els.script.value.trim();
  if (!script) {
    setStatus('대본을 입력하세요.', true);
    return;
  }

  els.run.disabled = true;
  setStatus('번역 중… 대본 길이에 따라 30초~2분 정도 걸립니다.');

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script,
        category: els.category.value,
        extraInstructions: els.extra.value,
      }),
    });

    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

    lastResult = body;
    render(body);
    setStatus(
      `완료 · ${body.result.rows.length}행 · 토큰 ${body.usage.input}/${body.usage.output}` +
        (body.truncated ? ' · ⚠ 출력이 잘렸을 수 있습니다' : ''),
    );
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.run.disabled = false;
  }
}

els.run.addEventListener('click', run);

// Ctrl/Cmd + Enter 로 실행
els.script.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run();
});

function setStatus(msg, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle('error', isError);
}

// ---- 렌더링 -------------------------------------------------------------

function render(body) {
  const r = body.result;
  const hasKo = r.sourceLanguage !== 'ko';

  els.titles.innerHTML = r.titles
    .map(
      (t) =>
        `<li><div class="t-ja">${esc(t.ja)}</div><div class="t-ko">${esc(t.ko)}</div></li>`,
    )
    .join('');

  els.descJa.textContent = r.descriptionJa;
  els.descKo.textContent = r.descriptionKo;
  els.tags.textContent = r.tags.join(' ');

  els.metaInfo.textContent = `원문: ${r.sourceLanguageName} · 카테고리: ${body.categoryLabel}${
    hasKo ? ' · 한국어 번역 열 포함' : ' · 한국어 원문이므로 번역 열 생략'
  }`;

  const headers = hasKo
    ? ['타임라인', '원문', '한국어 번역', '일본어 번역']
    : ['타임라인', '원문', '일본어 번역'];

  els.thead.innerHTML = `<tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>`;
  els.tbody.innerHTML = r.rows
    .map((row) => {
      const cells = [`<td class="tl">${esc(row.timeline)}</td>`, `<td>${esc(row.source)}</td>`];
      if (hasKo) cells.push(`<td>${esc(row.ko ?? '')}</td>`);
      cells.push(`<td class="ja-cell">${esc(row.ja)}</td>`);
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('');

  els.results.hidden = false;
}

function esc(s) {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

// ---- 내보내기 -----------------------------------------------------------

function tableMatrix() {
  const r = lastResult.result;
  const hasKo = r.sourceLanguage !== 'ko';
  const head = hasKo
    ? ['타임라인', '원문', '한국어 번역', '일본어 번역']
    : ['타임라인', '원문', '일본어 번역'];
  const rows = r.rows.map((row) =>
    hasKo
      ? [row.timeline, row.source, row.ko ?? '', row.ja]
      : [row.timeline, row.source, row.ja],
  );
  return [head, ...rows];
}

els.copyTsv.addEventListener('click', async () => {
  if (!lastResult) return;
  // 탭 구분 → 엑셀/스프레드시트에 그대로 붙여넣으면 셀 분리된다.
  const tsv = tableMatrix()
    .map((r) => r.map((c) => String(c).replace(/[\t\n]/g, ' ')).join('\t'))
    .join('\n');
  await navigator.clipboard.writeText(tsv);
  flash(els.copyTsv, '복사됨!');
});

els.downloadCsv.addEventListener('click', () => {
  if (!lastResult) return;
  const csv = tableMatrix()
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');
  // Excel이 UTF-8로 열도록 BOM 추가
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shorts-ja-${lastResult.category}-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
});

function flash(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), 1400);
}

loadCategories();
