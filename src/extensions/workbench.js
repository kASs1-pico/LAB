(function (global) {
  'use strict';

  const modules = new Map();
  const cleanups = new Set();
  const order = ['spatial', 'sketch', 'drawing', 'solid', 'mechanisms', 'metrology', '3d-print', 'cad-code', 'teacher', 'workspace'];
  let active, dialog, tabs, body, output, trigger, mounted;

  function el(tag, content, className) {
    const element = document.createElement(tag);
    if (content !== undefined && content !== null) element.textContent = content;
    if (className) element.className = className;
    return element;
  }

  function status(message) {
    if (output) output.textContent = message || '';
  }

  function button(label, action) {
    const control = el('button', label);
    control.type = 'button';
    control.addEventListener('click', async event => {
      const page = mounted;
      try {
        const result = action(event);
        if (result?.then) {
          control.disabled = true;
          await result;
        }
      } catch (error) {
        if (page === mounted) status(error?.message || 'Не удалось выполнить действие.');
      } finally {
        control.disabled = false;
      }
    });
    return control;
  }

  function download(data, filename, mime = 'application/json') {
    const blob = data instanceof Blob ? data : new Blob([data], {type: mime});
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.download = filename;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function dispose() {
    mounted = null;
    for (const cleanup of cleanups) {
      try { cleanup(); } catch (error) { console.error(error); }
    }
    cleanups.clear();
  }

  function select(id, focus = false) {
    dispose();
    active = id;
    status('');
    body.replaceChildren();
    for (const tab of tabs.children) {
      const selected = tab.dataset.module === id;
      tab.setAttribute('aria-pressed', String(selected));
      if (selected && focus) tab.focus({preventScroll:true});
    }
    const page = {};
    mounted = page;
    const ui = {
      el, button, download, app:global.LabApp,
      close:() => { if (mounted === page) dialog.close(); },
      status:message => { if (mounted === page) status(message); },
      isActive:() => mounted === page,
      onCleanup:cleanup => {
        if (typeof cleanup !== 'function') return;
        if (mounted === page) cleanups.add(cleanup);
        else cleanup();
      }
    };
    try {
      const result = modules.get(id).mount(body, ui);
      if (typeof result === 'function') ui.onCleanup(result);
      if (result?.then) result.catch(error => ui.status(error.message));
    } catch (error) {
      ui.status(error.message);
    }
    body.scrollTop = 0;
  }

  function makeDialog() {
    dialog = el('dialog', null, 'lab-workbench');
    dialog.id = 'lab-workbench';
    dialog.setAttribute('aria-labelledby', 'lab-workbench-title');
    const heading = el('h2', 'Лаборатория и практикумы');
    heading.id = 'lab-workbench-title';
    const close = button('×', () => dialog.close());
    close.setAttribute('aria-label', 'Закрыть');
    const header = el('header', null, 'lab-workbench-head');
    header.append(heading, close);
    tabs = el('nav', null, 'lab-workbench-tabs');
    tabs.setAttribute('aria-label', 'Разделы лаборатории');
    body = el('section', null, 'lab-workbench-body');
    output = el('p', '', 'lab-workbench-status');
    output.setAttribute('role', 'status');
    dialog.append(header, tabs, body, output);
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      if (dialog.open) return;
      dispose();
      body.replaceChildren();
      if (!document.querySelector('dialog[open]')) trigger?.focus({preventScroll:true});
    });
  }

  function open(id) {
    if (!modules.size) return;
    if (document.body.classList.contains('teaching-limited')) {
      global.LabApp?.toast('Дополнительные инструменты закрыты на время самостоятельной работы.');
      return;
    }
    if (!dialog) makeDialog();
    if (!dialog.open) {
      trigger = document.getElementById('studio-menu-toggle');
      const menu = document.getElementById('studio-menu');
      if (menu) menu.hidden = true;
      trigger?.setAttribute('aria-expanded', 'false');
      const ids = [...order.filter(key => modules.has(key)), ...[...modules.keys()].filter(key => !order.includes(key))];
      tabs.replaceChildren(...ids.map(key => {
        const tab = button(modules.get(key).title, () => select(key));
        tab.dataset.module = key;
        return tab;
      }));
      dialog.showModal();
    }
    select(modules.has(id) ? id : active || tabs.firstElementChild.dataset.module, true);
  }

  function register(module) {
    if (!module?.id || !module.title || typeof module.mount !== 'function' || modules.has(module.id)) {
      throw new Error('Раздел лаборатории уже зарегистрирован или описан неверно.');
    }
    modules.set(module.id, module);
  }

  global.LabExtensions = Object.freeze({register, open, sections:() => [...modules.keys()]});
  document.getElementById('lab-workbench-launch')?.addEventListener('click', () => open());
})(window);
