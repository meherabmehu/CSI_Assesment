const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const number = new Intl.NumberFormat('en-US');
const formatTime = (value) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const selected = new Set();
let snapshot = null;
let view = 'pending';
let latestCount = null;
let refreshVersion = 0;
let refreshController = null;
let tableSignature = '';
let submitting = false;
let acknowledging = false;
let toastTimer;

$('today').textContent = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('The server returned an unreadable response. Please try again.'); }
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function badge(status) {
  return `<span class="badge ${escape(String(status).toLowerCase())}">${escape(String(status).replaceAll('_', ' '))}</span>`;
}

function updateSelection() {
  $('selected-count').textContent = selected.size;
  $('ack-button').disabled = !selected.size || acknowledging || !snapshot;
  const visibleIds = [...document.querySelectorAll('[data-event-checkbox]')].map((input) => input.dataset.eventCheckbox);
  const all = $('select-all');
  if (all) {
    all.checked = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
    all.indeterminate = !all.checked && visibleIds.some((id) => selected.has(id));
  }
}

function renderTable() {
  if (!snapshot) return;
  const search = $('event-search').value.trim().toLowerCase();
  const rows = snapshot[view].filter((row) => [row.event_id, row.source_id, row.status, row.reason, row.target_event_id]
    .some((value) => String(value || '').toLowerCase().includes(search)));
  const signature = JSON.stringify([view, rows, [...selected].sort()]);
  $('ack-button').hidden = view !== 'pending';
  $('event-table-panel').setAttribute('aria-labelledby', `tab-${view}`);
  $('table-caption').textContent = `${rows.length} shown · Latest 200 records per view`;
  if (signature === tableSignature) { updateSelection(); return; }
  tableSignature = signature;
  const focusedId = document.activeElement?.dataset?.eventCheckbox;
  const pending = view === 'pending';
  $('table-head').innerHTML = `<tr>${pending ? '<th class="checkbox-cell"><input type="checkbox" id="select-all" aria-label="Select all visible events"></th>' : ''}<th>EVENT / SOURCE</th><th>TYPE</th><th>QUANTITY</th><th>${view === 'exceptions' ? 'STATUS / REASON' : 'STATUS'}</th><th>RECEIVED</th></tr>`;
  $('table-body').innerHTML = rows.map((row) => {
    const eventType = row.type || row.raw_payload?.type || '—';
    const quantity = row.quantity ?? row.raw_payload?.quantity;
    const status = pending ? 'PENDING' : row.status;
    return `<tr>${pending ? `<td class="checkbox-cell"><input type="checkbox" data-event-checkbox="${escape(row.event_id)}" aria-label="Select ${escape(row.event_id)}" ${selected.has(row.event_id) ? 'checked' : ''}></td>` : ''}<td><strong>${escape(row.event_id)}</strong><small>${escape(row.source_id)}${row.transport ? ` · ${escape(row.transport)}` : ''}</small></td><td><span class="type-pill">${escape(eventType)}</span>${row.target_event_id || row.raw_payload?.target_event_id ? `<small>↳ ${escape(row.target_event_id || row.raw_payload.target_event_id)}</small>` : ''}</td><td class="quantity">${eventType === 'COUNT' && typeof quantity === 'number' ? escape(`${quantity > 0 ? '+' : ''}${number.format(quantity)}`) : '—'}</td><td${view === 'exceptions' ? ' class="reason-cell"' : ''}>${badge(status)}${row.reason ? `<small>${escape(row.reason)}</small>` : ''}</td><td><span title="${escape(new Date(row.received_at).toLocaleString())}">${escape(formatTime(row.received_at))}</span></td></tr>`;
  }).join('');
  $('table-empty').hidden = rows.length > 0;
  const emptyLabels = {
    pending: ['All caught up', 'No completed counts are waiting for review.'],
    exceptions: ['No exceptions to review', 'Unresolved corrections and invalid submissions appear here.'],
    history: ['Your production story starts here', 'Submit your first event to build a traceable history.'],
  };
  const [title, subtitle] = search ? ['No matching events', 'Try another event ID or production line.'] : emptyLabels[view];
  $('table-empty').innerHTML = `<div class="empty-icon" aria-hidden="true">${view === 'exceptions' ? '⌁' : '✓'}</div><strong>${title}</strong><p>${subtitle}</p>`;
  document.querySelectorAll('[data-event-checkbox]').forEach((input) => {
    if (input.dataset.eventCheckbox === focusedId) input.focus();
    input.addEventListener('change', () => {
      if (input.checked) selected.add(input.dataset.eventCheckbox);
      else selected.delete(input.dataset.eventCheckbox);
      tableSignature = '';
      updateSelection();
    });
  });
  $('select-all')?.addEventListener('change', (event) => {
    for (const input of document.querySelectorAll('[data-event-checkbox]')) {
      input.checked = event.target.checked;
      if (input.checked) selected.add(input.dataset.eventCheckbox);
      else selected.delete(input.dataset.eventCheckbox);
    }
    tableSignature = '';
    updateSelection();
  });
  updateSelection();
}

function renderMqtt(data) {
  $('mqtt-state').textContent = data.connected ? 'Connected' : String(data.state || 'OFFLINE').replaceAll('_', ' ');
  $('mqtt-description').textContent = data.connected ? 'Listening for production challenges' : data.enabled ? 'Waiting for the MQTT broker' : 'MQTT is disabled in settings';
  $('mqtt-dot').className = `status-dot ${data.connected ? 'online' : data.last_error ? 'error' : ''}`;
  $('candidate-id').textContent = data.candidate_id || '—';
  $('last-heartbeat').textContent = formatTime(data.last_heartbeat_at);
  $('mqtt-broker').textContent = data.broker || '—';
  $('mqtt-topic').textContent = data.topics?.challenge || '—';
  for (const key of ['received', 'completed', 'failed']) $('challenges-' + key).textContent = number.format(data.counts?.[key] ?? 0);
  $('mqtt-error').hidden = !data.last_error;
  $('mqtt-error').textContent = data.last_error || '';
  $('last-challenge-id').textContent = data.last_challenge_id || 'No challenge yet';
  $('last-challenge-time').textContent = formatTime(data.last_challenge_time);
  $('last-response').innerHTML = data.last_response_status ? badge(data.last_response_status) : '—';
  $('challenge-list').innerHTML = (data.challenges || []).slice(0, 3).map((item) => `<div class="challenge-row"><div><strong>${escape(item.challenge_id)}</strong><small>${escape(formatTime(item.received_at))}${item.error_code ? ` · ${escape(item.error_code)}` : ''}</small></div>${badge(item.status)}</div>`).join('');
  const response = data.last_response_body || data.challenges?.[0]?.response_body;
  $('response-details').hidden = !response;
  $('response-json').textContent = response ? JSON.stringify(response, null, 2) : '';
}

async function refresh({ manual = false } = {}) {
  if (refreshController && !manual) return;
  refreshController?.abort();
  const controller = new AbortController();
  refreshController = controller;
  const version = ++refreshVersion;
  $('refresh').disabled = true;
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const source = $('source-filter').value;
    const data = await api('/api/dashboard' + (source ? `?source_id=${encodeURIComponent(source)}` : ''), { signal: controller.signal });
    if (version !== refreshVersion) return;
    snapshot = data;
    for (const [key, value] of Object.entries(data.summary)) $(`metric-${key}`).textContent = number.format(value);
    const pendingIds = new Set(data.pending.map((event) => event.event_id));
    for (const id of selected) if (!pendingIds.has(id)) selected.delete(id);
    const choices = [['', 'All production lines'], ...data.sources.map((line) => [line.source_id, line.display_name])];
    if (source && !choices.some(([id]) => id === source)) choices.push([source, source]);
    const choiceSignature = JSON.stringify(choices);
    if ($('source-filter').dataset.choices !== choiceSignature) {
      $('source-filter').innerHTML = choices.map(([id, name]) => `<option value="${escape(id)}">${escape(name)}</option>`).join('');
      $('source-filter').value = source;
      $('source-filter').dataset.choices = choiceSignature;
    }
    $('source-count').textContent = `${data.sources.length} production ${data.sources.length === 1 ? 'line' : 'lines'}`;
    $('pending-badge').textContent = data.pending.length;
    $('exceptions-badge').textContent = data.exceptions.length;
    $('updated').textContent = `Updated ${formatTime(new Date().toISOString())}`;
    $('sync-label').textContent = 'Updates every 5 seconds';
    $('connection-error').hidden = true;
    renderTable();
    renderMqtt(data.mqtt);
  } catch (error) {
    if (version !== refreshVersion) return;
    $('connection-error').textContent = error.name === 'AbortError' ? 'The server is taking too long to respond. Refresh to try again.' : `Could not refresh production data. ${error.message}`;
    $('connection-error').hidden = false;
    $('sync-label').textContent = snapshot ? 'Showing the last successful update' : 'Waiting for the backend';
  } finally {
    clearTimeout(timeout);
    if (version === refreshVersion) { refreshController = null; $('refresh').disabled = false; }
  }
}

function example(type) {
  const id = `EV-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const base = { source_id: $('source-filter').value || 'LINE-01', event_id: id, type: 'COUNT', quantity: 5, event_time: new Date().toISOString() };
  let payload;
  if (type === 'count') { latestCount = base.event_id; payload = base; }
  else if (type === 'void') payload = { ...base, type: 'VOID', quantity: null, target_event_id: latestCount || 'EV-COUNT-TO-REVERSE' };
  else {
    const target = { ...base, event_id: `${id}-TARGET`, quantity: 3 };
    payload = [
      { ...base, event_id: `${id}-VOID`, type: 'VOID', quantity: null, target_event_id: target.event_id },
      target, base, { ...base }, { ...base, event_id: `${id}-INVALID`, quantity: -1 },
    ];
    latestCount = base.event_id;
  }
  $('event-input').value = JSON.stringify(payload, null, 2);
  $('submit-message').hidden = true;
  $('submission-results').replaceChildren();
}

$('submit-button').addEventListener('click', async () => {
  if (submitting) return;
  let body;
  try { body = JSON.parse($('event-input').value); }
  catch {
    $('submit-message').className = 'notice error';
    $('submit-message').textContent = 'Please enter valid JSON. Check quotes, commas and brackets.';
    $('submit-message').hidden = false;
    return;
  }
  submitting = true;
  $('submit-button').disabled = true;
  $('submit-button').textContent = 'Submitting…';
  $('submit-message').hidden = true;
  $('submission-results').replaceChildren();
  try {
    const data = await api('/api/events', { method: 'POST', body: JSON.stringify(body) });
    $('submission-results').innerHTML = data.results.map((item) => `<div class="result-row">${badge(item.status)}<div><strong>${escape(item.event_id || 'Invalid item')}</strong><small>${escape(item.message)}</small></div></div>`).join('');
    const submitted = Array.isArray(body) ? body : [body];
    for (let i = 0; i < data.results.length; i++) {
      if (data.results[i].status === 'ACCEPTED' && submitted[i]?.type === 'COUNT') latestCount = data.results[i].event_id;
    }
    if (!data.results.length) {
      $('submit-message').className = 'notice';
      $('submit-message').textContent = 'The empty batch contained no events.';
      $('submit-message').hidden = false;
    }
    await refresh({ manual: true });
  } catch (error) {
    $('submit-message').className = 'notice error';
    $('submit-message').textContent = error.message;
    $('submit-message').hidden = false;
  } finally {
    submitting = false;
    $('submit-button').disabled = false;
    $('submit-button').innerHTML = 'Submit event <span aria-hidden="true">→</span>';
  }
});

$('ack-button').addEventListener('click', async () => {
  if (acknowledging || !selected.size) return;
  acknowledging = true;
  updateSelection();
  try {
    const data = await api('/api/ack', { method: 'POST', body: JSON.stringify({ event_ids: [...selected] }) });
    toast(data.results.map((item) => `${item.event_id}: ${item.status.replaceAll('_', ' ')}`).join(' · '));
    selected.clear();
    await refresh({ manual: true });
  } catch (error) { toast(error.message); }
  finally { acknowledging = false; updateSelection(); }
});

document.querySelectorAll('[data-example]').forEach((button) => button.addEventListener('click', () => example(button.dataset.example)));
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach((tab) => {
    tab.classList.toggle('active', tab === button);
    tab.setAttribute('aria-selected', String(tab === button));
  });
  renderTable();
}));
$('event-search').addEventListener('input', renderTable);
$('source-filter').addEventListener('change', () => { selected.clear(); refresh({ manual: true }); });
$('refresh').addEventListener('click', () => refresh({ manual: true }));
document.querySelectorAll('.nav-link').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('.nav-link').forEach((item) => item.classList.toggle('active', item === link));
}));
example('count');
refresh();
setInterval(() => { if (!document.hidden) refresh(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh({ manual: true }); });
