/**
 * 弹窗逻辑
 *
 * 职责：
 *   1. 读取当前标签页域名，回显该域名的配置与剩余倒计时
 *   2. 处理快捷项点击、自定义输入启用、停止等操作（启用后按需求关闭弹窗）
 *   3. 统一的校验与提示
 *
 * 说明：弹窗直接从 chrome.storage.local 读取状态并本地每秒刷新剩余时间，
 * 不打扰后台 Service Worker；所有变更都通过 chrome.runtime.sendMessage 交给后台执行。
 */

import {
  REFRESH_PRESETS,
  CLICK_PRESETS,
  STORE_KEY_CONFIGS,
  STORE_KEY_RUNTIMES,
  SECOND_MS,
  MSG,
} from '../src/shared/constants.js';
import {
  getHostFromUrl,
  isSupportedUrl,
  formatClock,
  formatInterval,
  validateRefreshSeconds,
  validateClickSeconds,
  validateSelector,
  validateClickBeforeRefresh,
  parseMatchToken,
  formatMatch,
  normalizeMatch,
} from '../src/shared/utils.js';

/* ------------------------------------------------------------------ *
 * DOM 引用
 * ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);

const el = {
  host: $('current-host'),
  hint: $('hint-bar'),

  refreshPill: $('refresh-pill'),
  refreshStatus: document.querySelector('#refresh-remaining')?.closest('.status'),
  refreshRemaining: $('refresh-remaining'),
  refreshStop: $('refresh-stop'),
  refreshChips: $('refresh-chips'),
  refreshForm: $('refresh-form'),
  refreshInput: $('refresh-input'),

  clickPill: $('click-pill'),
  clickStatus: document.querySelector('#click-remaining')?.closest('.status'),
  clickRemaining: $('click-remaining'),
  clickStop: $('click-stop'),
  clickChips: $('click-chips'),
  clickForm: $('click-form'),
  clickSelector: $('click-selector'),
  clickMatch: $('click-match'), // 命中多个元素时的序号（1 / 3 / last）
  clickInput: $('click-input'),

  lastEvent: $('last-event'),
};

/* ------------------------------------------------------------------ *
 * 弹窗本地状态（弹窗是短生命周期页面，内存状态足够）
 * ------------------------------------------------------------------ */
const state = {
  tabId: null,
  host: '',
  supported: false,
  config: null, // 当前域名的配置
  runtime: null, // 当前标签页的运行时
};

/* ------------------------------------------------------------------ *
 * 提示条
 * ------------------------------------------------------------------ */
/**
 * 显示提示信息。
 * @param {string} message 文案
 * @param {'success'|'warn'|'error'} level 语义级别
 */
function showHint(message, level = 'success') {
  if (!el.hint) return;
  el.hint.textContent = message;
  el.hint.className = `hint is-${level}`;
  el.hint.hidden = false;
}

function hideHint() {
  if (!el.hint) return;
  el.hint.hidden = true;
}

/* ------------------------------------------------------------------ *
 * 与后台通信
 * ------------------------------------------------------------------ */
async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, message: error?.message || '与后台通信失败' };
  }
}

/* ------------------------------------------------------------------ *
 * 状态读取与渲染
 * ------------------------------------------------------------------ */
async function loadState() {
  const data = await chrome.storage.local.get([STORE_KEY_CONFIGS, STORE_KEY_RUNTIMES]);
  const configs = data[STORE_KEY_CONFIGS] || {};
  const runtimes = data[STORE_KEY_RUNTIMES] || {};
  state.config = configs[state.host] || null;
  const runtime = state.tabId != null ? runtimes[String(state.tabId)] : null;
  // 只有运行时记录的域名与当前域名一致时才可用（避免切换域名后误用旧数据）
  state.runtime = runtime && runtime.hostname === state.host ? runtime : null;
}

/** 当前启用的刷新 / 点击配置（未启用返回 null） */
function activeRefresh() {
  return state.config?.refresh?.enabled ? state.config.refresh : null;
}

function activeClick() {
  return state.config?.click?.enabled ? state.config.click : null;
}

/**
 * 计算某个功能的剩余毫秒数。
 * 若还没有运行时（例如刚刚导航完成），则按完整周期回显。
 * @param {'refreshNextAt'|'clickNextAt'} key
 * @param {number} intervalMs
 */
function remainingOf(key, intervalMs) {
  const nextAt = state.runtime?.[key];
  if (typeof nextAt === 'number') return Math.max(0, nextAt - Date.now());
  return intervalMs;
}

/** 每秒刷新剩余时间文案（本地计算，不写 storage、不打扰后台） */
function paintCountdown() {
  const refresh = activeRefresh();
  const click = activeClick();

  if (el.refreshRemaining) {
    el.refreshRemaining.textContent = refresh
      ? formatClock(remainingOf('refreshNextAt', refresh.intervalMs))
      : '--:--';
  }
  if (el.clickRemaining) {
    el.clickRemaining.textContent = click
      ? formatClock(remainingOf('clickNextAt', click.intervalMs))
      : '--:--';
  }
}

/** 渲染配置相关 UI：状态胶囊、停止按钮、快捷项高亮、最近执行结果 */
function renderStatus() {
  const refresh = activeRefresh();
  const click = activeClick();

  if (el.refreshPill) {
    el.refreshPill.textContent = refresh ? `运行中 · ${formatInterval(refresh.intervalMs)}` : '未启用';
    el.refreshPill.classList.toggle('is-running', Boolean(refresh));
  }
  if (el.refreshStop) el.refreshStop.hidden = !refresh;
  el.refreshStatus?.classList.toggle('is-running', Boolean(refresh));

  if (el.clickPill) {
    // 序号非 1 时才在胶囊里补充展示，避免文案过长
    const match = normalizeMatch(click?.match);
    const matchText = click && match !== 1 ? ` · ${formatMatch(match)}` : '';
    el.clickPill.textContent = click
      ? `运行中 · ${formatInterval(click.intervalMs)}${matchText}`
      : '未启用';
    el.clickPill.classList.toggle('is-running', Boolean(click));
  }
  if (el.clickStop) el.clickStop.hidden = !click;
  el.clickStatus?.classList.toggle('is-running', Boolean(click));

  // 快捷项高亮：与当前生效周期一致时填充主色
  paintChips(el.refreshChips, refresh?.intervalMs);
  paintChips(el.clickChips, click?.intervalMs);

  // 已有配置时回填输入框，方便查看与微调（用户正在输入时不覆盖）
  if (refresh && el.refreshInput && document.activeElement !== el.refreshInput) {
    el.refreshInput.value = String(refresh.intervalMs / SECOND_MS);
  }
  if (click && el.clickSelector && document.activeElement !== el.clickSelector) {
    el.clickSelector.value = click.selector;
  }
  if (click && el.clickMatch && document.activeElement !== el.clickMatch) {
    const match = normalizeMatch(click.match);
    el.clickMatch.value = match === 'last' ? 'last' : String(match);
  }
  if (click && el.clickInput && document.activeElement !== el.clickInput) {
    el.clickInput.value = String(click.intervalMs / SECOND_MS);
  }

  // 最近一次执行结果
  if (el.lastEvent) {
    const message = state.runtime?.lastError;
    el.lastEvent.textContent = message ? `${message}` : '暂无';
  }
}

/**
 * 渲染快捷选项按钮。
 * @param {HTMLElement|null} container
 * @param {{label: string, ms: number}[]} presets
 * @param {(ms: number) => void} onPick
 */
function renderChips(container, presets, onPick) {
  if (!container) return;
  const buttons = presets.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.textContent = preset.label;
    button.dataset.ms = String(preset.ms);
    button.addEventListener('click', () => {
      void onPick(preset.ms);
    });
    return button;
  });
  container.replaceChildren(...buttons);
}

/** 给与当前周期一致的快捷项加上高亮 */
function paintChips(container, intervalMs) {
  if (!container) return;
  for (const chip of container.querySelectorAll('.chip')) {
    chip.classList.toggle('is-active', Number(chip.dataset.ms) === intervalMs);
  }
}

/* ------------------------------------------------------------------ *
 * 启用 / 停止
 * ------------------------------------------------------------------ */

/**
 * 启用定时刷新。
 * @param {number} intervalMs 周期（毫秒）
 * @param {number} [closeDelay] 关闭弹窗的延迟（用于让用户看到提示）
 */
async function enableRefresh(intervalMs, closeDelay = 0) {
  const response = await send({
    type: MSG.ENABLE_REFRESH,
    host: state.host,
    intervalMs,
  });
  if (!response?.ok) {
    showHint(response?.message || '启用失败，请重试', 'error');
    return;
  }
  closePopup(closeDelay);
}

/**
 * 启用自动定时点击。
 * @param {number} intervalMs
 * @param {string} selector
 * @param {number|'last'} match 第几个；'last' 表示最后一个
 * @param {number} [closeDelay]
 */
async function enableClick(intervalMs, selector, match, closeDelay = 0) {
  const response = await send({
    type: MSG.ENABLE_CLICK,
    host: state.host,
    selector,
    intervalMs,
    match,
  });
  if (!response?.ok) {
    showHint(response?.message || '启用失败，请重试', 'error');
    return;
  }
  closePopup(closeDelay);
}

/** 关闭弹窗（可延迟，便于用户看到提示文案） */
function closePopup(delay = 0) {
  if (delay > 0) {
    setTimeout(() => window.close(), delay);
    return;
  }
  window.close();
}

/** 刷新启用前的校验：若已启用点击，刷新周期必须大于点击周期 */
function checkRefreshAgainstClick(intervalMs) {
  const click = activeClick();
  if (click && intervalMs <= click.intervalMs) {
    return `刷新周期需大于已启用的点击周期（当前点击 ${formatInterval(click.intervalMs)}）`;
  }
  return '';
}

/* ------------------------------------------------------------------ *
 * 事件绑定（MV3 禁止内联事件，全部在这里绑定）
 * ------------------------------------------------------------------ */
function bindEvents() {
  // 快捷项：点击即生效
  renderChips(el.refreshChips, REFRESH_PRESETS, (ms) => {
    const error = checkRefreshAgainstClick(ms);
    if (error) {
      showHint(error, 'error');
      return;
    }
    void enableRefresh(ms);
  });

  renderChips(el.clickChips, CLICK_PRESETS, (ms) => {
    void handleClickEnable(ms);
  });

  // 定时刷新：自定义秒数 + 启用
  el.refreshForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ensureSupported()) return;

    const result = validateRefreshSeconds(el.refreshInput.value);
    if (!result.ok) {
      showHint(result.message, 'error');
      el.refreshInput.focus();
      return;
    }

    // 小于 60 秒时自动重置为 60（需求要求），并提示用户后再关闭
    if (result.level === 'warn') {
      el.refreshInput.value = String(result.seconds);
      showHint(result.message, 'warn');
    }

    const intervalMs = result.seconds * SECOND_MS;
    const error = checkRefreshAgainstClick(intervalMs);
    if (error) {
      showHint(error, 'error');
      return;
    }

    void enableRefresh(intervalMs, result.level === 'warn' ? 900 : 0);
  });

  // 自动定时点击：自定义秒数 + 启用（与快捷项共用校验）
  el.clickForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!ensureSupported()) return;

    const seconds = validateClickSeconds(el.clickInput.value);
    if (!seconds.ok) {
      showHint(seconds.message, 'error');
      el.clickInput.focus();
      return;
    }
    if (seconds.level === 'warn') {
      el.clickInput.value = String(seconds.seconds);
      showHint(seconds.message, 'warn');
    }
    void handleClickEnable(seconds.seconds * SECOND_MS, seconds.level === 'warn' ? 900 : 0);
  });

  // 停止按钮
  el.refreshStop?.addEventListener('click', () => {
    void stopFeature(MSG.STOP_REFRESH, '已停止定时刷新');
  });
  el.clickStop?.addEventListener('click', () => {
    void stopFeature(MSG.STOP_CLICK, '已停止自动点击');
  });

  // 输入时清掉上一次的错误提示，避免边打字边报错
  for (const input of [el.refreshInput, el.clickInput, el.clickSelector, el.clickMatch]) {
    input?.addEventListener('input', () => {
      if (el.hint && !el.hint.hidden && el.hint.classList.contains('is-error')) hideHint();
    });
  }
}

/**
 * 点击功能启用流程：校验选择器 → 校验周期 → 启用。
 * @param {number} intervalMs
 * @param {number} [closeDelay]
 */
async function handleClickEnable(intervalMs, closeDelay = 0) {
  if (!ensureSupported()) return;

  const selector = validateSelector(el.clickSelector?.value);
  if (!selector.ok) {
    showHint(selector.message, 'error');
    el.clickSelector?.focus();
    return;
  }

  // 匹配序号：留空按第 1 个；支持数字与 last
  const match = parseMatchToken(el.clickMatch?.value);
  if (!match.ok) {
    showHint(match.message, 'error');
    el.clickMatch?.focus();
    return;
  }

  const refresh = activeRefresh();
  const check = validateClickBeforeRefresh(intervalMs, refresh ? refresh.intervalMs : null);
  if (!check.ok) {
    showHint(check.message, 'error');
    return;
  }

  await enableClick(intervalMs, selector.value, match.value, closeDelay);
}

/**
 * 停止某个功能并刷新弹窗状态。
 * @param {string} type 消息类型
 * @param {string} successMessage
 */
async function stopFeature(type, successMessage) {
  const response = await send({ type, host: state.host });
  if (!response?.ok) {
    showHint(response?.message || '停止失败，请重试', 'error');
    return;
  }
  await loadState();
  renderStatus();
  paintCountdown();
  showHint(successMessage, 'success');
}

/** 当前页面是否可用；不可用时给出提示 */
function ensureSupported() {
  if (state.supported) return true;
  showHint('当前页面不支持自动刷新/点击（仅支持 http/https 网站）', 'error');
  return false;
}

/** 不支持的页面：禁用所有交互控件 */
function disableAll() {
  for (const control of [
    el.refreshInput,
    el.clickSelector,
    el.clickMatch,
    el.clickInput,
    ...(el.refreshChips?.querySelectorAll('button') ?? []),
    ...(el.clickChips?.querySelectorAll('button') ?? []),
    ...(el.refreshForm?.querySelectorAll('button') ?? []),
    ...(el.clickForm?.querySelectorAll('button') ?? []),
  ]) {
    if (control) control.disabled = true;
  }
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabId = tab?.id ?? null;
  state.host = getHostFromUrl(tab?.url);
  state.supported = isSupportedUrl(tab?.url);

  if (el.host) {
    el.host.textContent = state.host || (tab?.url ? '不支持的页面' : '未获取到页面');
  }

  if (!state.supported) {
    showHint('当前页面不支持自动刷新/点击（仅支持 http/https 网站）', 'error');
    renderChips(el.refreshChips, REFRESH_PRESETS, () => {});
    renderChips(el.clickChips, CLICK_PRESETS, () => {});
    disableAll();
    return;
  }

  await loadState();
  bindEvents();
  renderStatus();
  paintCountdown();

  // 本地每秒刷新剩余时间展示
  setInterval(paintCountdown, 1000);
}

void init();
