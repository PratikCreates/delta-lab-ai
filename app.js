const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const elements = {
  oldCode: $('#oldCode'), newCode: $('#newCode'), functionName: $('#functionName'), schema: $('#inputSchema'),
  candidates: $('#candidateInputs'), useModel: $('#useModel'), maxCases: $('#maxCases'), runButton: $('#runButton'),
  formError: $('#formError'), resultsEmpty: $('#resultsEmpty'), progress: $('#runProgress'), progressTitle: $('#progressTitle'),
  progressDetail: $('#progressDetail'), results: $('#runResults'), summary: $('#summaryCard'), caseList: $('#caseList'),
  download: $('#downloadTest'), runnerStatus: $('#runnerStatus'), runnerDot: $('#runnerDot'), resultsHint: $('#resultsHint')
};
let latestExport = '';
let latestExportIncomplete = false;
let currentFilter = 'all';
let runtimeStatus = {runner: 'unknown', ready: null, model_configured: null};

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty = value => {
  try { return JSON.stringify(value, null, 2); }
  catch { return String(value); }
};

function setRunnerStatus(data = {}) {
  const runner = data.runner === 'wsl' || data.runner === 'docker' ? data.runner : data.runner ? 'unknown' : (typeof data.docker === 'boolean' ? 'docker' : 'unknown');
  const ready = typeof data.ready === 'boolean' ? data.ready : typeof data.docker === 'boolean' ? data.docker : null;
  runtimeStatus = {runner, ready, model_configured: data.model_configured};
  elements.runnerDot.className = 'status-indicator';
  const runnerMode = $('#runnerMode');
  runnerMode.textContent = runner === 'wsl' ? 'EXPERIMENTAL WSL · NO CGROUPS' : runner === 'docker' ? 'DOCKER · NETWORK OFF' : 'RUNNER UNKNOWN';
  runnerMode.classList.toggle('wsl-mode', runner === 'wsl');
  if (ready === true) {
    elements.runnerDot.classList.add('ready');
    const runnerName = runner === 'wsl' ? 'Experimental WSL runner' : runner === 'docker' ? 'Docker runner' : 'Runner';
    elements.runnerStatus.textContent = data.model_configured === false ? `${runnerName} ready · model unavailable` : `${runnerName} ready`;
  } else if (ready === false) {
    elements.runnerDot.classList.add('offline');
    const runnerName = runner === 'wsl' ? 'Experimental WSL runner' : runner === 'docker' ? 'Docker runner' : 'Runner';
    elements.runnerStatus.textContent = data.model_configured === false ? `${runnerName} unavailable · model unavailable` : `${runnerName} unavailable`;
  } else {
    elements.runnerDot.classList.add('unknown');
    elements.runnerStatus.textContent = 'Runner status unknown';
  }
  updateDataDisclosure();
}

async function checkStatus() {
  try {
    const response = await fetch('/api/status', {headers: {'Accept': 'application/json'}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Status endpoint unavailable.');
    setRunnerStatus(data);
  } catch {
    setRunnerStatus();
  }
}

function updateLineCount(input, output) {
  const count = input.value ? input.value.split('\n').length : 0;
  output.textContent = `${String(count).padStart(2, '0')} ${count === 1 ? 'LINE' : 'LINES'}`;
}

function updateDataDisclosure() {
  $('#transmissionDisclosure').textContent = elements.useModel.checked
    ? 'On Run, your browser sends full source files, JSON Schema, function name, case limit, and supplied cases to the Delta Lab server. If Nemotron is enabled and configured, the server sends the function name, schema, case limit, source diff (capped at 18,000 characters), and first 12,000 characters of each source file to Nebius Token Factory for case generation. Supplied cases are not sent to Nemotron.'
    : 'On Run, your browser sends full source files, JSON Schema, function name, case limit, and supplied cases to the Delta Lab server. With Nemotron off, the server sends no code or schema to Nebius.';
  const runnerDisclosure = runtimeStatus.runner === 'wsl'
    ? 'Selected runner: experimental WSL with bubblewrap. It disables networking and applies per-process CPU and address-space limits; the process-count limit is shared by the WSL user. It has no aggregate cgroup quotas and is not a VM. If WSL is unavailable, the run stops; it does not switch to Docker.'
    : runtimeStatus.runner === 'docker'
      ? 'Selected runner: Docker. It executes full source and selected inputs with container networking disabled. If Docker is unavailable, the run stops; it does not switch to WSL.'
      : 'The selected runner is unknown until the server responds. No automatic runner fallback is used.';
  const runnerDisclosureElement = $('#runnerDisclosure');
  runnerDisclosureElement.textContent = runnerDisclosure;
  runnerDisclosureElement.classList.toggle('experimental', runtimeStatus.runner === 'wsl');
}

function showError(message) {
  elements.formError.textContent = message;
  elements.formError.classList.remove('hidden');
  elements.formError.focus?.();
}

function validateForm() {
  const oldCode = elements.oldCode.value.trim();
  const newCode = elements.newCode.value.trim();
  const functionName = elements.functionName.value.trim();
  if (!oldCode || !newCode) throw new Error('Add both the baseline and proposed Python functions.');
  if (!/^[A-Za-z_]\w*$/.test(functionName)) throw new Error('Enter a valid Python function name, such as calculate_total.');

  let inputSchema;
  try { inputSchema = JSON.parse(elements.schema.value); }
  catch { throw new Error('Input contract must be valid JSON.'); }
  if (!inputSchema || Array.isArray(inputSchema) || typeof inputSchema !== 'object') {
    throw new Error('Input contract must be a JSON Schema object.');
  }

  let candidates;
  const candidateText = elements.candidates.value.trim();
  if (candidateText) {
    try { candidates = JSON.parse(candidateText); }
    catch { throw new Error('Supplied inputs must be valid JSON.'); }
    if (!Array.isArray(candidates)) throw new Error('Supplied inputs must be a JSON array of invocation objects.');
    if (candidates.some(item => !item || Array.isArray(item) || typeof item !== 'object')) {
      throw new Error('Each supplied case must be an object with args and/or kwargs.');
    }
  } else candidates = [];

  const maxCases = Number(elements.maxCases.value);
  if (!Number.isInteger(maxCases) || maxCases < 1 || maxCases > 12) throw new Error('Max cases must be a whole number from 1 to 12.');
  return {oldCode, newCode, functionName, inputSchema, candidates, maxCases};
}

function outcomeMarkup(outcome) {
  if (!outcome || typeof outcome !== 'object') {
    return `<span class="outcome-kind unknown-kind">NO RESULT</span><pre>${escapeHTML(pretty(outcome))}</pre>`;
  }
  const isException = outcome.kind === 'exception';
  const label = isException ? `${outcome.type || 'Exception'}` : outcome.kind === 'return' ? 'RETURNED' : String(outcome.kind || 'OBSERVED');
  const value = isException ? outcome.message ?? outcome.value ?? '' : outcome.value;
  return `<span class="outcome-kind ${isException ? 'exception-kind' : 'return-kind'}">${escapeHTML(label)}</span><pre>${escapeHTML(pretty(value))}</pre>`;
}

function invocationMarkup(input, label = 'Invocation') {
  const safeInput = input && typeof input === 'object' ? input : {};
  const args = Array.isArray(safeInput.args) ? safeInput.args : [];
  const kwargs = safeInput.kwargs && typeof safeInput.kwargs === 'object' ? safeInput.kwargs : {};
  return `<div class="invocation"><div class="invocation-label">${escapeHTML(label)}</div><div class="argument-row"><span>ARGS</span><pre>${escapeHTML(pretty(args))}</pre></div><div class="argument-row"><span>KWARGS</span><pre>${escapeHTML(pretty(kwargs))}</pre></div></div>`;
}

function traceMarkup(runs) {
  if (!Array.isArray(runs) || !runs.length) return '';
  return `<details class="trace-details"><summary><span class="trace-symbol">↳</span> Inspect observed execution trace <span class="trace-count">${runs.length} ${runs.length === 1 ? 'STEP' : 'STEPS'}</span></summary><div class="trace-list">${runs.map((run, index) => `<article class="trace-step"><div class="trace-step-head"><span class="trace-step-number">${String(index + 1).padStart(2, '0')}</span><strong>${run.phase === 'shrink' ? 'Counterexample reduction attempt' : 'Initial execution'}</strong><span>${run.different ? 'DIFFERENT' : 'SAME'}</span></div>${invocationMarkup(run.input, run.phase === 'shrink' ? 'Candidate input' : 'Executed input')}<div class="outcome-grid"><section class="outcome-box old-outcome"><div><i></i> BASELINE</div>${outcomeMarkup(run.old)}</section><section class="outcome-box new-outcome"><div><i></i> PROPOSED</div>${outcomeMarkup(run.new)}</section></div></article>`).join('')}</div></details>`;
}

function caseMarkup(testCase, index) {
  const different = Boolean(testCase.different);
  const minimized = Boolean(testCase.minimized);
  const source = testCase.source === 'model' ? 'NEMOTRON' : testCase.source === 'user' ? 'SUPPLIED' : 'CASE';
  const title = different ? 'Behavior differs' : 'Behavior matches';
  const runs = Array.isArray(testCase.runs) ? testCase.runs : [];
  return `<article class="case-card ${different ? 'is-different' : 'is-same'}" data-different="${different}">
    <div class="case-head"><div class="case-title-wrap"><span class="case-number">${String(index + 1).padStart(2, '0')}</span><div><h4>${title}</h4><span class="case-source">${source} INPUT</span></div></div><div class="case-badges">${minimized ? '<span class="mini-badge">SIMPLIFIED COUNTEREXAMPLE</span>' : ''}<span class="difference-badge">${different ? 'DIFFERENCE FOUND' : 'MATCH'}</span></div></div>
    ${invocationMarkup(testCase.input, minimized ? 'Simplified counterexample input' : 'Executed input')}
    ${minimized && testCase.original_input ? `<details class="original-input"><summary>Compare with original input</summary>${invocationMarkup(testCase.original_input, 'Original invocation')}</details>` : ''}
    <div class="outcome-grid"><section class="outcome-box old-outcome"><div><i></i> BASELINE</div>${outcomeMarkup(testCase.old)}</section><section class="outcome-box new-outcome"><div><i></i> PROPOSED</div>${outcomeMarkup(testCase.new)}</section></div>
    ${minimized ? `<div class="shrink-note"><span>↘</span> This input was locally simplified${Number.isFinite(testCase.shrink_attempts) ? ` across ${testCase.shrink_attempts} evaluated reduction attempts` : ''}. It is not guaranteed to be globally minimal.</div>` : ''}
    ${traceMarkup(runs)}
  </article>`;
}

function renderCases(cases, incomplete = false) {
  const safeCases = Array.isArray(cases) ? cases : [];
  const diffCount = safeCases.filter(item => item?.different).length;
  $('#allCount').textContent = safeCases.length;
  $('#diffCount').textContent = diffCount;
  $('#caseSubhead').textContent = `${safeCases.length} completed ${safeCases.length === 1 ? 'invocation' : 'invocations'} · ${diffCount} behavioral ${diffCount === 1 ? 'difference' : 'differences'}${incomplete ? ' · PARTIAL RUN' : ''}`;
  $('#caseList').innerHTML = safeCases.length ? safeCases.map(caseMarkup).join('') : '<div class="no-cases"><span>∅</span><strong>No valid cases were executed.</strong><p>Check the schema and generation settings, then run again.</p></div>';
  applyFilter(currentFilter);
}

function renderSummary(data) {
  const summary = data.summary || {};
  const tested = Number(summary.tested ?? (Array.isArray(data.cases) ? data.cases.length : 0));
  const differences = Array.isArray(data.cases) ? data.cases.filter(item => item?.different).length : 0;
  const modelCandidates = Number(summary.model_candidates ?? 0);
  const hasModelError = Boolean(summary.model_error);
  const modelValid = Number.isFinite(Number(summary.model_valid)) ? Number(summary.model_valid) : null;
  const modelTested = Number.isFinite(Number(summary.model_tested)) ? Number(summary.model_tested) : null;
  const incomplete = summary.incomplete === true;
  const state = incomplete
    ? differences ? 'PARTIAL · DIFFERENCES OBSERVED' : tested ? 'PARTIAL · NO DIFFERENCES YET' : 'PARTIAL · NO COMPLETED CASES'
    : differences ? 'DIFFERENCES OBSERVED' : tested ? 'NO DIFFERENCES OBSERVED' : 'NO CASES EXECUTED';
  const modelFollowup = modelValid === null || modelTested === null
    ? 'schema-valid / tested counts unavailable'
    : `${modelValid} schema-valid · ${modelTested} tested by runner`;
  const stateClass = [differences ? 'has-differences' : tested ? 'all-matched' : 'no-execution', incomplete ? 'is-incomplete' : ''].filter(Boolean).join(' ');
  elements.summary.innerHTML = `<div class="summary-state ${stateClass}"><span class="summary-state-icon">${incomplete ? '!' : differences ? 'Δ' : tested ? '✓' : '!'}</span><div><span class="summary-overline">${incomplete ? 'ANALYSIS INCOMPLETE' : 'RUN COMPLETE'}</span><strong>${state}</strong><small>${tested} completed ${tested === 1 ? 'case' : 'cases'} executed against both implementations</small></div></div><div class="summary-metrics"><div><span>TESTED CASES</span><strong>${tested}</strong></div><div><span>DIFFERENCES</span><strong class="${differences ? 'metric-alert' : ''}">${differences}</strong></div><div><span>MODEL PROPOSALS</span><strong class="metric-model">${modelCandidates} proposed</strong><small>${escapeHTML(modelFollowup)}</small></div></div>`;
  if (incomplete) {
    const reason = typeof summary.incomplete_reason === 'string' && summary.incomplete_reason.trim()
      ? summary.incomplete_reason.trim()
      : 'The analysis stopped before all planned comparisons finished.';
    const comparisons = Number(summary.comparisons);
    const comparisonNote = Number.isFinite(comparisons) ? `${comparisons} comparison${comparisons === 1 ? '' : 's'} completed.` : '';
    elements.summary.insertAdjacentHTML('beforeend', `<div class="incomplete-warning"><span>!</span><div><strong>Partial run — this is not a complete suite.</strong><p>${escapeHTML(reason)} ${escapeHTML(comparisonNote)} Only completed cases are shown; inputs not run are not covered.</p></div></div>`);
    $('#exportTitle').textContent = 'Partial-run export · completed cases only';
    $('#exportContext').textContent = 'This file contains only observed differences from completed comparisons; unrun cases are absent. It uses baseline outputs as candidate expectations. Set DELTA_TARGET_MODULE and review whether that behavior is intended before adopting it.';
  } else {
    $('#exportTitle').textContent = 'Take the regression test with you.';
    $('#exportContext').textContent = 'Only differing cases are included. The test uses baseline outputs as candidate expectations; set DELTA_TARGET_MODULE and review whether that behavior is intended.';
  }
  if (hasModelError) {
    elements.summary.insertAdjacentHTML('beforeend', `<div class="model-warning"><span>!</span><p><strong>Nemotron case generation did not complete.</strong> ${escapeHTML(summary.model_error)}${tested ? ' Supplied or previously available cases were still executed.' : ' No generated cases are being represented as executed.'}</p></div>`);
  }
  const runner = summary.runner ? `Executed with ${summary.runner}.` : 'Executed by the isolated runner.';
  const comparisonCount = Number(summary.comparisons);
  $('#resultFootnote').textContent = incomplete
    ? `${runner} This partial run completed ${Number.isFinite(comparisonCount) ? comparisonCount : tested} comparisons before stopping. Treat these as partial observations; unrun inputs are not covered.`
    : `${runner} Differences are observations; review intent and context before labeling any result a regression.`;
}

function applyFilter(filter) {
  currentFilter = filter;
  $$('.filter-button').forEach(button => button.classList.toggle('active', button.dataset.filter === filter));
  $$('.case-card', elements.caseList).forEach(card => {
    card.classList.toggle('filtered-out', filter === 'different' && card.dataset.different !== 'true');
  });
  const visible = $$('.case-card:not(.filtered-out)', elements.caseList).length;
  const emptyFilter = $('.filter-empty', elements.caseList);
  if (filter === 'different' && visible === 0 && $$('.case-card', elements.caseList).length) {
    if (!emptyFilter) elements.caseList.insertAdjacentHTML('beforeend', '<div class="filter-empty">No behavioral differences were observed in this run.</div>');
  } else emptyFilter?.remove();
}

function showProgress() {
  elements.resultsEmpty.classList.add('hidden');
  elements.results.classList.add('hidden');
  elements.progress.classList.remove('hidden');
  elements.progressTitle.textContent = elements.useModel.checked ? 'Generating cases and executing both versions…' : 'Executing supplied cases in isolation…';
  elements.progressDetail.textContent = elements.useModel.checked
    ? 'Nemotron suggestions are checked against the schema, then both functions receive the same inputs.'
    : 'Both functions receive the same schema-valid invocation inputs inside the isolated runner.';
  elements.resultsHint.textContent = 'RUN IN PROGRESS';
}

function lockInputs(locked) {
  [elements.oldCode, elements.newCode, elements.functionName, elements.schema, elements.candidates,
    elements.useModel, elements.maxCases, $('#loadExample')].forEach(control => { control.disabled = locked; });
}

function showRunError(message) {
  elements.progress.classList.add('hidden');
  elements.results.classList.add('hidden');
  elements.resultsEmpty.classList.remove('hidden');
  elements.resultsHint.textContent = 'RUN NOT COMPLETED';
  showError(message);
}

async function runComparison() {
  elements.formError.classList.add('hidden');
  let payload;
  try { payload = validateForm(); }
  catch (error) { showError(error.message); return; }

  elements.runButton.disabled = true;
  lockInputs(true);
  elements.runButton.classList.add('busy');
  elements.runButton.querySelector('.run-button-label').textContent = 'Running comparison…';
  elements.download.disabled = true;
  latestExport = '';
  showProgress();
  $('#results').scrollIntoView({behavior: 'smooth', block: 'start'});

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
      body: JSON.stringify({
        old_code: payload.oldCode,
        new_code: payload.newCode,
        function_name: payload.functionName,
        input_schema: payload.inputSchema,
        candidates: payload.candidates,
        model: elements.useModel.checked,
        max_cases: payload.maxCases
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Run failed (HTTP ${response.status}).`);
    renderSummary(data);
    renderCases(data.cases, data.summary?.incomplete === true);
    latestExport = typeof data.export === 'string' ? data.export : '';
    latestExportIncomplete = data.summary?.incomplete === true;
    elements.download.disabled = !latestExport;
    elements.progress.classList.add('hidden');
    elements.results.classList.remove('hidden');
    const tested = Number(data.summary?.tested ?? data.cases?.length ?? 0);
    const caseLabel = `${tested} ${tested === 1 ? 'CASE' : 'CASES'}`;
    elements.resultsHint.textContent = latestExportIncomplete ? `PARTIAL RUN · ${caseLabel}` : `${caseLabel} EVALUATED`;
  } catch (error) {
    showRunError(error.message || 'The differential run could not be completed.');
  } finally {
    elements.runButton.disabled = false;
    lockInputs(false);
    elements.runButton.classList.remove('busy');
    elements.runButton.querySelector('.run-button-label').textContent = 'Generate cases & compare';
  }
}

elements.oldCode.addEventListener('input', () => updateLineCount(elements.oldCode, $('#oldLines')));
elements.newCode.addEventListener('input', () => updateLineCount(elements.newCode, $('#newLines')));
elements.runButton.addEventListener('click', runComparison);
elements.useModel.addEventListener('change', updateDataDisclosure);
updateDataDisclosure();
$$('.filter-button').forEach(button => button.addEventListener('click', () => applyFilter(button.dataset.filter)));

$('#loadExample').addEventListener('click', async event => {
  const button = event.currentTarget;
  const originalLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Loading upstream source…';
  elements.formError.classList.add('hidden');
  try {
    const response = await fetch('/api/example', {headers: {'Accept': 'application/json'}});
    const example = await response.json();
    if (!response.ok) throw new Error(example.error || `Could not load example (HTTP ${response.status}).`);
    elements.oldCode.value = example.old_code || '';
    elements.newCode.value = example.new_code || '';
    elements.functionName.value = example.function_name || '';
    elements.schema.value = pretty(example.input_schema || {});
    elements.candidates.value = pretty(Array.isArray(example.candidates) ? example.candidates : []);
    updateLineCount(elements.oldCode, $('#oldLines'));
    updateLineCount(elements.newCode, $('#newLines'));
    const notice = $('#exampleNotice');
    const provenance = example.provenance ? ` ${escapeHTML(example.provenance)}` : '';
    notice.querySelector('p').innerHTML = `<strong>Upstream regression fixture loaded.</strong>${provenance} No run results are bundled; execute it here to inspect observed behavior.`;
    notice.classList.remove('hidden');
    elements.useModel.checked = true;
    elements.resultsEmpty.classList.remove('hidden');
    elements.results.classList.add('hidden');
    elements.progress.classList.add('hidden');
    elements.resultsHint.textContent = 'NO RUN YET';
    $('#workbench').scrollIntoView({behavior: 'smooth', block: 'start'});
  } catch (error) {
    showError(error.message || 'Could not load the upstream fixture.');
  } finally {
    button.disabled = false;
    button.innerHTML = originalLabel;
  }
});

$('#dismissExample').addEventListener('click', () => $('#exampleNotice').classList.add('hidden'));

elements.download.addEventListener('click', () => {
  if (!latestExport) return;
  const file = new Blob([latestExport], {type: 'text/x-python;charset=utf-8'});
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = latestExportIncomplete ? 'delta-regression-test-partial.py' : 'delta-regression-test.py';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

checkStatus();
