'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'moa-design-shelf:preferences:v1';
  const PAGE_SIZE = 24;
  let embeddedImages={};try{embeddedImages=JSON.parse(document.getElementById('embedded-images')?.textContent||'{}');}catch{}
  const state = { data: null, query: '', category: 'all', source: 'all', sort: 'discovered', savedView: false, hideRead: false, limit: PAGE_SIZE, saved: new Set(), read: new Set(), loading: false, error: false };
  const dateFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Seoul' });
  const timeFormatter = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });
  function node(tag, className, text) { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; }
  function safeURL(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; } }
  function timestamp(value) { const time = typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(time) ? time : 0; }
  function date(value, detailed = false) { if (!timestamp(value)) return '정보 없음'; return (detailed ? timeFormatter : dateFormatter).format(new Date(value)) + (detailed ? ' 한국 시간' : ''); }
  function validIds(value) { return Array.isArray(value) && value.length <= 100000 && value.every(id => typeof id === 'string' && id.length > 0 && id.length <= 1000); }
  function storageWarning() { $('storage-warning').hidden = false; $('storage-warning').textContent = '브라우저 저장 공간을 사용할 수 없어요. 이번 화면에서는 저장과 읽음 표시가 유지되지만, 새로고침하면 사라질 수 있습니다. 목록 내보내기로 백업하세요.'; }
  function loadPreferences() { try { const raw = localStorage.getItem(STORAGE_KEY); if (!raw) return; const value = JSON.parse(raw); if (value.version !== 1 || !validIds(value.savedIds) || !validIds(value.readIds)) throw new Error('invalid preferences'); state.saved = new Set(value.savedIds); state.read = new Set(value.readIds); state.hideRead = value.hideRead === true; } catch { storageWarning(); } $('hide-read').checked = state.hideRead; }
  function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, savedIds: [...state.saved], readIds: [...state.read], hideRead: state.hideRead })); } catch { storageWarning(); } }
  function validateLibrary(raw) {
    if (!raw || raw.version !== 1 || !Array.isArray(raw.items) || !Array.isArray(raw.sources) || !Array.isArray(raw.runs)) throw new Error('지원하지 않는 데이터 형식입니다.');
    const sourceIds = new Set();
    const sources = raw.sources.map(source => {
      if (!source || typeof source.id !== 'string' || !source.id || sourceIds.has(source.id) || source.id === 'all' || typeof source.name !== 'string' || !source.name.trim()) throw new Error('출처 데이터 형식이 올바르지 않습니다.');
      sourceIds.add(source.id); return source;
    });
    const allowedSources = new Set(sources.map(source => source.id));
    const ids = new Set();
    const items = raw.items.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.title !== 'string' || !safeURL(item.url) || !allowedSources.has(item.sourceId) || typeof item.category !== 'string' || !Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string')) throw new Error('자료 데이터 형식이 올바르지 않습니다.');
      ids.add(item.id);
      return { ...item, description: typeof item.description === 'string' ? item.description : '', sourceName: sources.find(source => source.id === item.sourceId).name, accessNote: typeof item.accessNote === 'string' ? item.accessNote : '' };
    });
    return { ...raw, items: items.filter(item => item.access === 'free' && item.pricingEvidence?.checkedAt), sources, runs: raw.runs.filter(run => run && timestamp(run.at)) };
  }
  function buildCategories() {
    const categories = [...new Set(state.data.items.map(item => item.category).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'ko'));
    const fragment = document.createDocumentFragment();
    for (const value of ['all', ...categories]) { const button = node('button', 'chip', value === 'all' ? '전체' : categoryLabel(value)); button.type = 'button'; button.setAttribute('aria-pressed', String(state.category === value)); button.addEventListener('click', () => { state.category = value; state.limit = PAGE_SIZE; buildCategories(); render(); }); fragment.append(button); }
    $('categories').replaceChildren(fragment);
  }
  function sourceLabel(id) { return state.data?.sources.find(source => source.id === id)?.name || id; }
  function thumbnailURL(value) {
    if (typeof value !== 'string') return null;
    if (document.getElementById('embedded-library') && value.startsWith('preview-image:') && Object.prototype.hasOwnProperty.call(embeddedImages,value)) value=embeddedImages[value];
    // Offline data URLs are accepted only in the self-contained, builder-generated preview.
    if (document.getElementById('embedded-library') && /^data:image\/(?:webp|png|jpeg|gif|avif);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
    if (/^\.\/thumbnails\/[A-Za-z0-9_./-]+\.(?:webp|png|jpe?g|gif|avif)$/i.test(value) && !value.split('/').includes('..')) return value;
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function buildSourceControls() {
    const list = $('source-list'); const select = $('source-filter');
    list.replaceChildren(); select.replaceChildren();
    const all = node('option', '', '모든 출처'); all.value = 'all'; select.append(all);
    for (const source of state.data.sources.filter(s=>s.eligibleCount>0)) {
      const option = node('option', '', source.name); option.value = source.id; select.append(option);
      const url = safeURL(source.url); const link = node(url ? 'a' : 'span', 'source-link');
      const dot = node('span', 'source-dot'); dot.setAttribute('aria-hidden', 'true');
      link.append(dot, node('span', 'source-name', source.name));
      if (url) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; const arrow = node('span', 'source-arrow', '↗'); arrow.setAttribute('aria-hidden', 'true'); link.append(arrow); }
      list.append(link);
    }
    if (!state.data.sources.some(source => source.id === state.source)) state.source = 'all';
    select.value = state.source;
    $('source-count').textContent = String(state.data.sources.filter(s=>s.eligibleCount>0).length);
    const names = state.data.sources.map(source => source.name).join(' · ');
    const withData=state.data.sources.filter(source => (source.eligibleCount || 0)>0).length;const discovery=state.data.discovery;
    $('source-scope').textContent = '자료가 있는 출처 '+withData+'곳 · 이번 회차 무작위 수집 '+(discovery?.selectedCount || 0)+'곳 · 후보 '+(discovery?.totalSourceCount || state.data.sources.length)+'곳';
    $('dialog-scope').textContent = '현재 수집 범위: ' + (names || '등록된 출처 없음');
    $('footer-scope').textContent = '현재 ' + state.data.sources.length + '개 출처의 공개 자료를 수집합니다.';
  }
  function categoryLabel(value) { return {'3D · WebGL':'3D · 웹 효과','UI 컴포넌트':'화면 구성요소'}[value] || value; }
  function tagLabel(value) { const labels = {'Three.js':'쓰리제이에스','three-js':'3D 그래픽','landing-pages':'웹사이트','hero':'첫 화면','3d-assets':'3D 소품','backgrounds':'배경 효과','buttons':'버튼','sections':'화면 구역','text-animation':'글자 움직임','motion-design':'모션 디자인','ui-elements':'화면 구성요소','css':'화면 스타일'}; return labels[value] || categoryLabel(value); }
  function shownTitle(item) { const text = item.titleKo || (/[가-힣]/.test(item.title) ? item.title : categoryLabel(item.category) + ' 자료 · 번역 준비 중'); return text.replaceAll('BLACK FRIDAY 98% OFF', '블랙프라이데이 98% 할인'); }
  function shownDescription(item) { return item.descriptionKo || (/[가-힣]/.test(item.description) ? item.description : '이 자료의 한국어 설명을 준비 중입니다. 원문 정보는 아래에서 펼쳐볼 수 있어요.'); }
  function isNew(item) { const runs = state.data.runs; if (runs.length < 2) return false; const latest = runs.reduce((a,b) => timestamp(a.at) > timestamp(b.at) ? a : b); return timestamp(item.firstSeenAt) > 0 && timestamp(item.firstSeenAt) === timestamp(latest.at); }
  function resourceCard(item, index) {
    const article = node('article', 'resource-card' + (state.read.has(item.id) ? ' is-read' : ''));
    const visual = node('div', 'card-visual');
    const imageUrl = thumbnailURL(item.thumbnail);
    const fallback = node('span', 'thumbnail-empty', '미리보기 이미지 없음');
    if (imageUrl) {
      const image = node('img', 'card-thumbnail'); image.loading = 'lazy'; image.decoding = 'async';
      image.alt = typeof item.thumbnailAlt === 'string' && item.thumbnailAlt.trim() ? item.thumbnailAlt : shownTitle(item) + ' 원본 미리보기';
      image.addEventListener('error', () => { image.remove(); visual.prepend(fallback); }, { once: true });
      image.src = imageUrl; visual.append(image);
    } else visual.append(fallback);
    visual.append(node('span', 'visual-source', sourceLabel(item.sourceId)));
    if (isNew(item)) visual.append(node('span', 'new-badge', '신규'));
    const title = shownTitle(item);
    const saved = state.saved.has(item.id);
    const save = node('button', 'save-button', saved ? '◆' : '◇'); save.type = 'button'; save.setAttribute('aria-label', title + (saved ? ' 저장 취소' : ' 저장')); save.setAttribute('aria-pressed', String(saved));
    save.addEventListener('click', () => { if (state.saved.has(item.id)) state.saved.delete(item.id); else state.saved.add(item.id); persist(); render({ id: item.id, control: 'save' }); }); save.dataset.control = 'save'; save.dataset.itemId = item.id;
    visual.append(save);
    const body = node('div', 'card-body'); const top = node('div', 'card-topline'); const source = node('span', 'card-source'); source.append(node('span', 'source-dot'), document.createTextNode(sourceLabel(item.sourceId)));
    const accessLabels = { 'public-link': '공개 링크', unknown: '조건 미확인', free: '자료 무료', paid: '유료 표시' };
    const access = node('span', 'access', accessLabels[item.access] || '조건 미확인'); access.title = item.accessNote || '원본 페이지에서 이용 조건을 확인하세요.'; top.append(source, access);
    const heading = node('h3'); const link = node('a', 'title-link', title + ' ↗'); link.href = safeURL(item.url); link.target = '_blank'; link.rel = 'noopener noreferrer'; heading.append(link);
    const description = node('p', 'card-description', shownDescription(item));
    const tags = node('div', 'tags'); for (const tag of [...new Set([categoryLabel(item.category), ...item.tags.map(tagLabel)])].filter(Boolean).slice(0, 3)) tags.append(node('span', 'tag', tag));
    const bottom = node('div', 'card-bottom'); const dates = node('div', 'dates'); const firstSeen = node('span', '', '발견 ' + date(item.firstSeenAt)); firstSeen.title = '모아가 처음 확인한 시각: ' + date(item.firstSeenAt, true); const published = node('span', '', '게시 ' + (timestamp(item.publishedAt) ? date(item.publishedAt) : '날짜 미확인')); published.title = '원본의 게시 날짜'; dates.append(firstSeen, published);
    const read = node('button', 'read-button', state.read.has(item.id) ? '읽음 취소' : '읽음 표시'); read.type = 'button'; read.setAttribute('aria-pressed', String(state.read.has(item.id))); read.setAttribute('aria-label', title + (state.read.has(item.id) ? ' 읽음 취소' : ' 읽음 표시')); read.dataset.control = 'read'; read.dataset.itemId = item.id;
    read.addEventListener('click', () => { if (state.read.has(item.id)) state.read.delete(item.id); else state.read.add(item.id); persist(); render({ id: item.id, control: 'read' }); });
    bottom.append(dates, read); body.append(top, heading, description);
    if(item.usageKo){const use=node('section','card-usage');use.append(node('strong','','이렇게 활용하세요'),node('p','',item.usageKo));body.append(use);}
    if(Array.isArray(item.stepsKo)&&item.stepsKo.length){const guide=node('details','usage-details');guide.append(node('summary','','시작 방법·준비물·주의사항'));if(item.audienceKo)guide.append(node('p','', '추천 대상: '+item.audienceKo));const steps=node('ol');for(const step of item.stepsKo)steps.append(node('li','',step));guide.append(steps);if(item.requirementsKo)guide.append(node('p','', '준비물: '+item.requirementsKo));if(item.cautionsKo)guide.append(node('p','guide-caution','주의: '+item.cautionsKo));for(const [i,url] of (item.referenceUrls||[]).entries()){if(safeURL(url)){const ref=node('a','guide-reference','확인한 원문 '+(i+1)+' ↗');ref.href=safeURL(url);ref.target='_blank';ref.rel='noopener noreferrer';guide.append(ref);}}if(item.reviewedAt)guide.append(node('p','review-date','내용 확인: '+date(item.reviewedAt)));body.append(guide);}
    if (item.titleKo || !/[가-힣]/.test(item.title)) { const original = node('details', 'original-details'); const summary = node('summary', '', '영어 원문 보기'); original.append(summary, node('strong', '', item.originalTitle || item.title), node('p', '', item.originalDescription || item.description), node('p', 'translation-note', item.titleKo ? '원문 내용을 바탕으로 정리한 한국어 안내입니다. 연결된 사이트 본문은 원문으로 열립니다.' : '새 자료이거나 원문이 바뀌어 번역을 기다리고 있습니다.')); body.append(original); }
    if (item.toolCostNote && item.editorialStatus!=='reviewed') body.append(node('p','tool-cost-note',item.toolCost === 'paid-plan' ? '소개 기능은 유료 요금제 대상 · 이 자료는 무료' : '소개 도구의 요금제·크레딧 비용은 별도 확인'));
    const provenance = node('details', 'original-details');
    if (safeURL(item.thumbnailSourceUrl)) { const imageSource = node('a', '', '미리보기 원본 ↗'); imageSource.href = safeURL(item.thumbnailSourceUrl); imageSource.target = '_blank'; imageSource.rel = 'noopener noreferrer'; provenance.append(imageSource); }
     provenance.append(node('summary', '', '출처 및 무료 확인 근거')); const srcLink = node('a', '', '수집한 원본 자료실'); srcLink.href = safeURL(item.sourceUrl); srcLink.target = '_blank'; srcLink.rel = 'noopener noreferrer'; provenance.append(srcLink); if (safeURL(item.sourceEntryUrl)) { const entryLink=node('a','',' · 원본 목록 항목');entryLink.href=safeURL(item.sourceEntryUrl);entryLink.target='_blank';entryLink.rel='noopener noreferrer';provenance.append(entryLink); } provenance.append(node('p','',item.pricingEvidence?.method || '무료 여부를 별도 확인했습니다.'),node('p','','무료 확인: '+date(item.pricingEvidence?.checkedAt,true)));if(item.toolCostNote)provenance.append(node('p','',item.toolCostNote));body.append(provenance,tags, bottom); article.append(visual, body); return article;
  }
  function filteredItems() {
    const query = state.query.toLocaleLowerCase('ko');
    const sorted = state.data.items.filter(item => (!state.savedView || state.saved.has(item.id)) && (!state.hideRead || !state.read.has(item.id)) && (state.category === 'all' || item.category === state.category) && (state.source === 'all' || item.sourceId === state.source) && (!query || [shownTitle(item), shownDescription(item), item.usageKo || '', item.audienceKo || '', ...(item.stepsKo || []), item.title, item.description, sourceLabel(item.sourceId), item.sourceName, item.category, categoryLabel(item.category), ...item.tags].join(' ').toLocaleLowerCase('ko').includes(query))).sort((a,b) => {
      if (state.sort === 'title') return shownTitle(a).localeCompare(shownTitle(b), 'ko') || a.id.localeCompare(b.id);
      const field = state.sort === 'published' ? 'publishedAt' : 'firstSeenAt'; return timestamp(b[field]) - timestamp(a[field]) || (state.sort === 'discovered' ? timestamp(b.publishedAt) - timestamp(a.publishedAt) : 0) || shownTitle(a).localeCompare(shownTitle(b), 'ko');
    });
    if (state.sort !== 'discovered' || state.source !== 'all') return sorted;
    // Keep discovery days newest-first; rotate sources within a day for a representative first screen.
    const days = new Map();
    for (const item of sorted) { const key = date(item.firstSeenAt); if (!days.has(key)) days.set(key, []); days.get(key).push(item); }
    const balanced = [];
    for (const items of days.values()) {
      const buckets = new Map(state.data.sources.map(source => [source.id, []]));
      for (const item of items) buckets.get(item.sourceId).push(item);
      let remaining = items.length;
      while (remaining) for (const bucket of buckets.values()) if (bucket.length) { balanced.push(bucket.shift()); remaining--; }
    }
    return balanced;
  }
  function showState(title, message, retry = false) { const container = $('library-state'); container.hidden = false; container.replaceChildren(node('h3', '', title), node('p', '', message)); const button = node('button', 'outline-button', retry ? '다시 불러오기' : '필터 초기화'); button.type = 'button'; button.addEventListener('click', retry ? loadLibrary : resetFilters); container.append(button); }
  function render(focus) {
    if (!state.data) return;
    const items = filteredItems();
    $('all-count').textContent = state.data.items.length;
    const savedInLibrary = state.data.items.filter(item => state.saved.has(item.id)).length;
    $('saved-count').textContent = savedInLibrary;
    $('collection-title').firstChild.textContent = state.savedView ? '저장한 자료 ' : '전체 자료함 ';
    $('heading-count').textContent = state.savedView ? savedInLibrary : state.data.items.length;
    $('view-all').classList.toggle('active', !state.savedView); $('view-saved').classList.toggle('active', state.savedView); $('view-all').setAttribute('aria-pressed', String(!state.savedView)); $('view-saved').setAttribute('aria-pressed', String(state.savedView));
    const visible = items.slice(0, state.limit);
    $('result-count').textContent = items.length + '개의 자료' + (items.length ? ' · ' + visible.length + '개 표시' : '') + (state.savedView ? ' · 저장한 목록' : '');
    $('reset-filters').hidden = !(state.query || state.category !== 'all' || state.source !== 'all' || state.hideRead);
    const fragment = document.createDocumentFragment(); visible.forEach((item,index) => fragment.append(resourceCard(item,index))); $('grid').replaceChildren(fragment);
    $('library-state').hidden = true;
    if (!items.length) { if (!state.data.items.length) showState('아직 채워지지 않은 선반', '첫 수집이 완료되면 공개 자료가 여기에 나타나요. 수집 안내에서 상태를 확인하세요.'); else if (state.savedView && !savedInLibrary) showState('마음에 드는 발견을 저장하세요', '카드 오른쪽 위 저장 버튼을 누르면 나만의 선반에 모아둘 수 있어요.'); else showState('찾으시는 자료가 없어요', '다른 검색어를 입력하거나 필터를 바꿔보세요.'); }
    $('load-more').hidden = visible.length >= items.length; $('remaining-count').textContent = '(' + (items.length - visible.length) + '개 남음)';
    if (focus) { const target = Array.from($('grid').querySelectorAll('button')).find(button => button.dataset.itemId === focus.id && button.dataset.control === focus.control); if (target) target.focus({ preventScroll: true }); else (state.savedView ? $('view-saved') : $('hide-read')).focus({ preventScroll: true }); }
  }
  function resetFilters() { state.query = ''; state.category = 'all'; state.source = 'all'; state.hideRead = false; state.limit = PAGE_SIZE; $('search').value = ''; $('source-filter').value = 'all'; $('hide-read').checked = false; persist(); if (state.data) { buildCategories(); render(); } }
  function renderSources() {
    const container = $('source-details'); container.replaceChildren();
    container.append(node('p','small-note','새 출처 탐색과 수집은 자동으로 실행합니다. 새 GitHub 자료는 실제 내용·활용법을 확인한 한국어 설명이 있어야 공개하며, 검수 전 자료와 주제가 맞지 않거나 실습 파일이 없는 자료는 자료함에서 보류합니다.')); 
    if(state.data?.discovery){const d=state.data.discovery;const log=node('section','source-detail');log.append(node('strong','','무작위 수집 기록'),node('p','','후보 '+(d.totalSourceCount || state.data.sources.length)+'곳 중 '+(d.selectedCount || 0)+'곳 선택 · 신규 출처 '+(d.newSourceIds?.length || 0)+'곳 발견'),node('p','',d.scope || '새 출처 탐색은 공개 저장소 검색을 사용합니다. 웹 전체·SNS 직접 크롤링은 아닙니다.'),node('p','','선택한 곳: '+(d.selectedSourceIds||[]).map(sourceLabel).join(' · ')));if(d.errors?.length)log.append(node('p','source-error','탐색 오류 '+d.errors.length+'건 · 기존 자료는 유지했습니다.'));container.append(log);}
    if (!state.data || !state.data.sources.length) { container.append(node('p', '', '아직 확인할 수집 기록이 없습니다.')); return; }
    for (const source of state.data.sources) {
      const block = node('section', 'source-detail'); const head = node('div', 'source-detail-head'); head.append(node('strong', '', sourceLabel(source.id)), node('span', 'status-pill' + (source.status === 'error' ? ' error' : ''), source.status === 'ok' ? '이번 회차 확인' : source.status === 'error' ? '수집 오류' : '이번 회차 미선택')); block.append(head);
      block.append(node('p', '', '마지막 시도: ' + date(source.lastAttemptAt, true)), node('p', '', '마지막 성공: ' + date(source.lastSuccessAt, true)), node('p', '', '원본 목록 ' + (Number.isFinite(source.itemCount) ? source.itemCount : 0) + '개 · 신규 ' + (Number.isFinite(source.newCount) ? source.newCount : 0) + '개 · 변경 ' + (Number.isFinite(source.changedCount) ? source.changedCount : 0) + '개'));
      block.append(node('p','','현재 표시: '+(source.eligibleCount || 0)+'개 · 유료 분류: '+(source.paidCount || 0)+'개 · 무료 미확인: '+(source.unverifiedCount || 0)+'개'));
      if (source.error) block.append(node('p', 'source-error', String(source.error)));
      const url = safeURL(source.url); if (url) { const link = node('a', '', '원본 소스 방문 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; block.append(link); }
      container.append(block);
    }
  }
  async function loadLibrary() {
    if (state.loading) return; state.loading = true; state.error = false;
    $('result-count').textContent = '자료함을 불러오고 있어요.'; $('library-state').hidden = true; $('grid').setAttribute('aria-busy', 'true');
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const embedded = document.getElementById('embedded-library');
      if (embedded) { state.data = validateLibrary(JSON.parse(embedded.textContent)); }
      else { const response = await fetch('./data/library.json', { cache: 'no-cache', signal: controller.signal }); if (!response.ok) throw new Error('데이터 응답 오류'); state.data = validateLibrary(await response.json()); }
      const policy=state.data.policy; if ($('policy-summary')) $('policy-summary').textContent = policy ? '무료 확인 '+state.data.items.length+'개 표시 · 유료 분류 '+(policy.excludedCounts?.paid || 0)+'개 제외 · 무료 여부 미확인 '+(policy.excludedCounts?.unverified || 0)+'개 보류'+(policy.excludedCounts?.translationPending?' · 한국어 설명 검수 대기 '+policy.excludedCounts.translationPending+'개':'')+(policy.excludedCounts?.outOfScope?' · 내용·주제 검토 제외 '+policy.excludedCounts.outOfScope+'개':'') : '무료 확인 자료만 표시합니다. 소개 도구의 요금은 별도입니다.';
      $('collected-at').textContent = '마지막 수집 ' + date(state.data.updatedAt, true);
      $('baseline-note').textContent = state.data.runs.length <= 1 ? '첫 수집은 기준 목록으로 표시합니다' : '신규는 가장 최근 수집에서 처음 발견한 링크';
      buildSourceControls();
      buildCategories(); render(); renderSources();
    } catch (error) {
      state.error = true; $('result-count').textContent = '자료함을 불러오지 못했어요.'; $('collected-at').textContent = '수집 데이터 확인 필요'; $('baseline-note').textContent = ''; $('grid').replaceChildren(); $('load-more').hidden = true;
      showState('선반을 불러오지 못했어요', '웹 서버에서 실행 중인지, data/library.json 파일이 있는지 확인한 뒤 다시 시도하세요.', true);
      renderSources();
    } finally { clearTimeout(timeout); state.loading = false; $('grid').setAttribute('aria-busy', 'false'); }
  }

  function renderDeploymentState(){if(!document.getElementById('embedded-library')&&location.protocol==='https:'){const top=document.querySelector('.topbar-right');if(top)top.textContent='사이트형 · 클라우드 수집';const schedule=document.querySelector('.sidebar-bottom p');if(schedule)schedule.textContent='매일 09:15 한국 시간 · 자동 수집';const strong=document.querySelector('.schedule-card strong');if(strong)strong.textContent='매일 09:15 한국 시간 · 클라우드 자동 수집';const info=document.querySelector('.schedule-card p');if(info)info.textContent='GitHub Actions에서 새 출처 탐색·무작위 수집·썸네일 갱신·게시를 실행합니다. 기기에서 수집 프로그램을 실행하지 않습니다. 일정은 플랫폼 사정으로 지연될 수 있습니다.';}}
  function openGuide() { renderSources(); const dialog = $('info-dialog'); if (!dialog.open) dialog.showModal(); }
  $('collection-guide').addEventListener('click', openGuide); $('source-status').addEventListener('click', openGuide); $('close-dialog').addEventListener('click', () => $('info-dialog').close());
  $('info-dialog').addEventListener('click', event => { if (event.target === $('info-dialog')) { const rect = event.target.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close(); } });
  $('view-all').addEventListener('click', () => { state.savedView = false; state.limit = PAGE_SIZE; render(); }); $('view-saved').addEventListener('click', () => { state.savedView = true; state.limit = PAGE_SIZE; render(); });
  $('search').addEventListener('input', event => { state.query = event.target.value.trim(); state.limit = PAGE_SIZE; render(); });
  $('source-filter').addEventListener('change', event => { state.source = event.target.value; state.limit = PAGE_SIZE; render(); }); $('sort').addEventListener('change', event => { state.sort = event.target.value; state.limit = PAGE_SIZE; render(); });
  $('hide-read').addEventListener('change', event => { state.hideRead = event.target.checked; state.limit = PAGE_SIZE; persist(); render(); }); $('reset-filters').addEventListener('click', resetFilters);
  $('load-more').addEventListener('click', () => { const previous = Math.min(state.limit, filteredItems().length); state.limit += PAGE_SIZE; render(); const nextLink = $('grid').children[previous]?.querySelector('.title-link'); if (nextLink) nextLink.focus({ preventScroll: true }); });
  document.addEventListener('keydown', event => { const target = event.target; if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT','TEXTAREA','SELECT'].includes(target.tagName) && !target.isContentEditable && !$('info-dialog').open) { event.preventDefault(); $('search').focus(); } });
  $('export-backup').addEventListener('click', () => {
    try { const backup = { version: 1, exportedAt: new Date().toISOString(), savedIds: [...state.saved], readIds: [...state.read] }; const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = 'moa-bookmarks-' + new Date().toISOString().slice(0,10) + '.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); $('backup-status').textContent = '저장 ID와 읽음 ID를 내보냈어요.'; } catch { $('backup-status').textContent = '내보내지 못했어요. 다시 시도하세요.'; }
  });
  $('import-backup').addEventListener('click', () => $('backup-file').click());
  $('backup-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('백업은 5MB 이하만 가져올 수 있어요.');
      const value = JSON.parse(await file.text()); if (!value || value.version !== 1 || !validIds(value.savedIds) || (value.readIds !== undefined && !validIds(value.readIds))) throw new Error('올바른 MOA 버전 1 백업 파일이 아니에요.');
      const previousSaved = state.saved.size; value.savedIds.forEach(id => state.saved.add(id)); (value.readIds || []).forEach(id => state.read.add(id)); persist(); render();
      $('backup-status').textContent = '저장 ' + (state.saved.size - previousSaved) + '개를 기존 목록에 합쳤어요. 현재 없는 자료 ID도 보존합니다.';
    } catch (error) { $('backup-status').textContent = error instanceof SyntaxError ? 'JSON 파일을 읽을 수 없어요. 파일 형식을 확인하세요.' : error.message || '백업을 가져오지 못했어요.'; } finally { event.target.value = ''; }
  });
  renderDeploymentState(); loadPreferences(); loadLibrary();
})();
