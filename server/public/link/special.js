// Личная ссылка гостя (проход 4, шаг 7; разделы 6.2 и 14) — минимальный вид, не финальный дизайн.
// Один экран без входа: предложение → имя, телефон, почта → согласие → «Подтвердить». Состояние всегда берётся с сервера
// (обновление страницы показывает то же). Адрес и Telegram сервер отдаёт только после подтверждения.
import { $, esc, money, fmtDay } from '/shared/views.js';

const GONE = {
  expired: ['⌛', 'Срок предложения истёк', 'Даты освобождены. Напишите владельцу — он может прислать новую ссылку.'],
  revoked: ['🚫', 'Ссылка отозвана', 'Владелец отменил это предложение. Если это ошибка — напишите ему.'],
  cancelled: ['❌', 'Бронь отменена', 'Ссылка больше не действует — напишите владельцу.'],
  completed: ['✅', 'Проживание завершено', 'Ссылка больше не действует. Спасибо, что были у нас!'],
};
const CONFLICT = 'Даты стали недоступны — владелец свяжется с вами. Бронь пока не подтверждена.';

async function call(path, body) {
  const init = body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) { const e = new Error(data?.error || `Ошибка ${res.status}`); e.status = res.status; e.data = data; throw e; }
  return data;
}
const view = (html) => { $('#view').innerHTML = html; return $('#view'); };
const until = (iso) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const termsText = (j) => j.terms === 'deposit' ? `Залог ${money(j.depositKzt)} — остаток ${money(j.totalKzt - j.depositKzt)} при заезде` : 'Оплата наличными при заезде';
const nightsWord = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'ночь' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'ночи' : 'ночей');

export async function showSpecial(token) {
  const base = `/api/special-link/${encodeURIComponent(token)}`;
  let busy = false;
  $('#title').textContent = 'Предложение брони';
  document.title = document.title.replace('задача', 'бронь');

  const goneView = (st) => { const [icon, title, sub] = GONE[st] || GONE.expired; view(`<div class="card empty" data-state="${esc(st || 'expired')}"><div style="font-size:40px">${icon}</div><b>${title}</b><div class="sub" style="margin-top:6px">${sub}</div></div>`); };
  /** Закрытая / неверная ссылка / лимит — показать понятный экран; true, если ошибка обработана. */
  const fail = (e) => {
    if (e.status === 410) goneView(e.data?.details?.status);
    else if (e.status === 429) view('<div class="card empty"><b>Слишком много запросов — попробуйте через несколько минут</b></div>');
    else if (e.status === 404) view('<div class="card empty" data-state="notfound"><div style="font-size:40px">🔗</div><b>Ссылка недействительна или заменена новой</b><div class="sub" style="margin-top:6px">Попросите владельца прислать актуальную ссылку.</div></div>');
    else return false;
    return true;
  };

  const offer = (j) => `${j.apartment.photo ? `<img src="${esc(j.apartment.photo)}" alt="" style="width:100%;border-radius:14px;max-height:220px;object-fit:cover">` : ''}
    <div class="card"><h2 style="font-size:19px;margin:0 0 6px">${esc(j.apartment.title)}</h2>
      <dl class="kv"><dt>Заезд</dt><dd>${fmtDay(j.checkIn)}, с ${esc(j.checkInTime)}</dd><dt>Выезд</dt><dd>${fmtDay(j.checkOut)}, до ${esc(j.checkOutTime)}</dd>
      <dt>Ночей</dt><dd>${j.nights} ${nightsWord(j.nights)}</dd><dt>Гостей</dt><dd>${j.guestsCount}</dd>
      ${j.apartment.rooms ? `<dt>Комнат</dt><dd>${j.apartment.rooms}</dd>` : ''}
      <dt>Сумма</dt><dd class="money">${money(j.totalKzt)}</dd><dt>Условия</dt><dd>${termsText(j)}</dd></dl>
      ${j.note ? `<div class="sub" style="white-space:pre-wrap">💬 ${esc(j.note)}</div>` : ''}</div>`;

  const confirmedView = (j) => view(`<div class="alert green" data-state="confirmed" style="font-size:16px">✅ <b>Бронь №${esc(j.booking.number)} подтверждена</b></div>
    <div class="card"><h2 style="font-size:19px;margin:0 0 6px">${esc(j.apartment.title)}</h2>
      <dl class="kv"><dt>Адрес</dt><dd>${esc(j.apartment.address || '')}</dd>
      <dt>Заезд</dt><dd>${fmtDay(j.checkIn)}, с ${esc(j.checkInTime)}</dd><dt>Выезд</dt><dd>${fmtDay(j.checkOut)}, до ${esc(j.checkOutTime)}</dd>
      <dt>Гостей</dt><dd>${j.guestsCount}</dd><dt>Сумма</dt><dd class="money">${money(j.totalKzt)}</dd><dt>Условия</dt><dd>${termsText(j)}</dd></dl></div>
    ${j.telegramLink ? `<a class="btn primary block" id="tg" href="${esc(j.telegramLink)}" target="_blank" rel="noopener">Получать сообщения в Telegram</a>` : ''}`);

  const checklist = (j) => {
    const m = j.missing || [];
    const row = (done, text) => `<div class="cl-item">${done ? '✔' : '⏳'} <span>${text}</span></div>`;
    return `<div class="card"><b>Что нужно для подтверждения</b>
      ${row(!m.includes('guest') && !m.includes('terms'), 'Ваши данные и согласие с условиями')}
      ${j.terms === 'deposit' ? row(!m.includes('deposit'), `Залог ${money(j.depositKzt)} — владелец отметит, когда получит`) : ''}
      ${j.extraCheckRequired ? row(!m.includes('extra_check'), 'Дополнительное подтверждение — владелец отметит, когда получит') : ''}
      <div class="sub" style="margin-top:6px">Бронь подтвердится автоматически, когда будут отмечены все пункты.</div></div>`;
  };

  const activeView = (j, flash) => {
    const m = j.missing || [];
    const waitingAdmin = j.stage === 'waiting_admin';
    const entered = !!(j.guest.name && j.guest.phone) && j.stage !== 'waiting_guest';
    let banner = '';
    if (flash) banner = flash;
    else if (waitingAdmin) {
      const what = [m.includes('deposit') ? 'залог' : '', m.includes('extra_check') ? 'дополнительное подтверждение' : ''].filter(Boolean).join(' и ');
      banner = `<div class="alert amber" data-state="${m.includes('deposit') ? 'waiting_deposit' : 'waiting_extra_check'}">⏳ <b>Данные отправлены.</b> Ждём, когда владелец отметит ${what}. Страницу можно закрыть и открыть позже по этой же ссылке.</div>`;
    } else if (j.stage === 'ready') banner = '<div class="alert blue" data-state="ready">Всё готово — нажмите «Подтвердить».</div>';
    else if (entered && m.includes('terms')) banner = '<div class="alert amber" data-state="entered">Данные сохранены. Отметьте согласие с условиями (если владелец изменил условия — проверьте их ещё раз) и нажмите «Подтвердить».</div>';
    else if (entered) banner = '<div class="alert blue" data-state="entered">Данные сохранены — нажмите «Подтвердить».</div>';
    const extra = j.extraCheckRequired ? `<div class="alert blue">📎 <b>Нужно дополнительное подтверждение.</b> ${esc(j.extraCheckNote || 'Владелец напишет, что и куда прислать.')} Пришлите его в переписке с владельцем — загружать на сайт ничего не нужно.</div>` : '';
    const deposit = j.terms === 'deposit' ? `<div class="alert blue">💳 Залог ${money(j.depositKzt)} — договоритесь с владельцем, как его передать. Бронь подтвердится, когда владелец отметит получение.</div>` : '';
    const form = waitingAdmin ? `<button class="btn block" id="spCheck">Проверить статус</button>` : `<div class="card" id="spForm">
      <label for="spName">Имя и фамилия</label><input id="spName" autocomplete="name" maxlength="80" value="${esc(j.guest.name || '')}">
      <label for="spPhone">Телефон</label><input id="spPhone" type="tel" autocomplete="tel" maxlength="30" placeholder="+7 700 000 00 00" value="${esc(j.guest.phone || '')}">
      <label for="spEmail">Почта (необязательно)</label><input id="spEmail" type="email" autocomplete="email" maxlength="120">
      <label class="check"><input type="checkbox" id="spTerms"> Согласен с условиями: ${termsText(j)}, сумма ${money(j.totalKzt)}</label>
      <div id="spErr" class="alert red" hidden></div>
      <button class="btn primary block big" id="spSubmit">Подтвердить</button></div>`;
    const root = view(`${banner}${offer(j)}
      ${j.holdUntil ? `<div class="hint" id="spUntil">⏰ Предложение действует до ${until(j.holdUntil)}</div>` : ''}
      ${deposit}${extra}${(j.terms === 'deposit' || j.extraCheckRequired) ? checklist(j) : ''}${form}`);
    root.querySelector('#spSubmit')?.addEventListener('click', () => submit(root));
    root.querySelector('#spCheck')?.addEventListener('click', (ev) => recheck(ev.currentTarget));
  };

  const render = (j, flash) => (j.status === 'completed' ? confirmedView(j) : activeView(j, flash));
  async function load(flash) {
    try { render(await call(base), flash); } catch (e) { if (!fail(e)) view(`<div class="card empty"><b>${esc(e.message)}</b><div class="sub">Обновите страницу.</div></div>`); }
  }
  async function submit(root) {
    if (busy) return;   // защита от двойного нажатия
    const btn = root.querySelector('#spSubmit'), err = root.querySelector('#spErr');
    const showErr = (msg) => { err.textContent = msg; err.hidden = false; };
    err.hidden = true;
    const body = { name: root.querySelector('#spName').value.trim(), phone: root.querySelector('#spPhone').value.trim(), email: root.querySelector('#spEmail').value.trim(), acceptTerms: root.querySelector('#spTerms').checked };
    if (!body.name || !body.phone) return showErr('Укажите имя и телефон');
    if (!body.acceptTerms) return showErr('Отметьте согласие с условиями');
    busy = true; btn.disabled = true; btn.textContent = 'Отправляем…';
    try {
      await call(`${base}/guest`, body);
      await call(`${base}/submit`, {}); await load();   // ответ «completed» / «active» — полное состояние берём GET
    } catch (e) {
      if (e.status === 409 && /недоступны/.test(e.message)) return load(`<div class="alert red" data-state="conflict">⚠️ ${CONFLICT}</div>`);
      if (e.status === 409) return load();
      if (fail(e)) return;
      showErr(e.data?.details?.[0]?.message || e.message);
    } finally { busy = false; if (btn.isConnected) { btn.disabled = false; btn.textContent = 'Подтвердить'; } }
  }
  async function recheck(btn) {
    if (busy) return;
    busy = true; btn.disabled = true;
    try { await call(`${base}/submit`, {}); await load();   // ответ «completed» / «active» — полное состояние берём GET } catch (e) {
      if (e.status === 409) return load(`<div class="alert red" data-state="conflict">⚠️ ${CONFLICT}</div>`);
      if (!fail(e)) load();
    } finally { busy = false; if (btn.isConnected) btn.disabled = false; }
  }
  await load();
}
