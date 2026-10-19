/**
 * 后台 Service Worker（Manifest V3）
 *
 * 职责：
 *   1. 保存域名级配置与标签页级运行时（全部持久化在 chrome.storage.local）
 *   2. 每 1 秒滴答一次：更新扩展图标 badge 倒计时，并在到点时执行刷新 / 点击
 *   3. 监听标签页事件，实现「同域名所有标签页生效」「地址变更重新计时」
 *   4. 响应弹窗的启用 / 停止指令
 *
 * 设计要点：
 *   - SW 是瞬态的（空闲约 30 秒会被回收），因此**禁止用全局变量保存业务状态**，
 *     所有状态都从 chrome.storage 读取；滴答器在 SW 启动时由 ensureTicker() 重建。
 *   - 倒计时只存「下次触发时间戳 nextAt」，剩余时间由 nextAt - Date.now() 推导，
 *     SW 被回收再唤醒也不会算错。
 *   - 触发动作前先把 nextAt 推进一个周期（乐观推进），天然避免重复触发。
 */

import {
  STORE_KEY_CONFIGS,
  STORE_KEY_RUNTIMES,
  TICK_MS,
  HEARTBEAT_ALARM,
  HEARTBEAT_PERIOD_MINUTES,
  MSG,
  ICONS,
  BADGE_BACKGROUND_COLOR,
  BADGE_FOREGROUND_COLOR,
  BADGE_BORDER_COLOR,
  BADGE_STYLE,
  BADGE_SOLID_BACKGROUND_COLOR,
  BADGE_SOLID_TEXT_COLOR,
  BADGE_SOLID_RADIUS_RATIO,
  BADGE_ICON_SIZES,
  BADGE_BASE_ICON,
  DEFAULT_ACTION_TITLE,
} from './src/shared/constants.js';
import {
  getHostFromUrl,
  isSupportedUrl,
  formatBadge,
  formatInterval,
  formatMatch,
  normalizeMatch,
} from './src/shared/utils.js';

/* ================================================================== *
 * 一、状态读写（唯一的持久化入口）
 * ================================================================== */

/** 读取全部域名配置 */
async function readConfigs() {
  const data = await chrome.storage.local.get(STORE_KEY_CONFIGS);
  return data[STORE_KEY_CONFIGS] || {};
}

/** 写入全部域名配置 */
async function writeConfigs(configs) {
  await chrome.storage.local.set({ [STORE_KEY_CONFIGS]: configs });
}

/** 读取全部标签页运行时 */
async function readRuntimes() {
  const data = await chrome.storage.local.get(STORE_KEY_RUNTIMES);
  return data[STORE_KEY_RUNTIMES] || {};
}

/** 写入全部标签页运行时 */
async function writeRuntimes(runtimes) {
  await chrome.storage.local.set({ [STORE_KEY_RUNTIMES]: runtimes });
}

/* ================================================================== *
 * 二、纯 UI 缓存（不承载业务状态，仅用于减少无意义的 chrome.action 调用）
 * ================================================================== */
const badgeTextCache = new Map(); // tabId -> 上一次 badge 文案
const iconStateCache = new Map(); // tabId -> 上一次是否为启用态图标
const titleCache = new Map(); // tabId -> 上一次 tooltip 文案

/* ================================================================== *
 * 三、标签页图标 / 倒计时胶囊呈现
 *
 * 说明：原生 chrome.action badge 在 3 个字符（如 "60M"）时会自动折行，
 * 且无法控制内边距。这里改用 OffscreenCanvas 把「图标 + 淡蓝倒计时胶囊」
 * 自绘成 imageData 交给 chrome.action.setIcon，从而精确控制背景色、
 * 内边距与字号，保证始终单行显示；自绘不可用时自动退回原生 badge。
 * ================================================================== */

/** 底图位图缓存（只加载一次，避免每秒 fetch） */
let iconBitmapsPromise = null;

/**
 * 加载底图位图。
 * @returns {Promise<{ normal: ImageBitmap, active: ImageBitmap }>}
 */
function loadIconBitmaps() {
  if (!iconBitmapsPromise) {
    iconBitmapsPromise = (async () => {
      const [normal, active] = await Promise.all([
        fetchBitmap(BADGE_BASE_ICON.normal),
        fetchBitmap(BADGE_BASE_ICON.active),
      ]);
      return { normal, active };
    })().catch((error) => {
      iconBitmapsPromise = null; // 失败后允许下次重试
      throw error;
    });
  }
  return iconBitmapsPromise;
}

/** 把扩展内的 PNG 读成 ImageBitmap（Worker 中可用 createImageBitmap） */
async function fetchBitmap(path) {
  const response = await fetch(chrome.runtime.getURL(path));
  const blob = await response.blob();
  return createImageBitmap(blob);
}

/** 倒计时文案的字号比例：数字尽可能大，单位字母（M/S）约为数字的一半 */
const BADGE_NUMBER_FONT_RATIO = 0.6;
const BADGE_UNIT_FONT_RATIO = 0.52; // 相对数字字号的比例
const BADGE_FONT_FAMILY = '"Helvetica Neue", Arial, sans-serif';

/**
 * 在图标底部绘制倒计时胶囊。
 *
 * 排版策略（为了让倒计时在小小的图标里尽可能大）：
 *   1. 胶囊铺满图标底部整条，横向可用宽度最大化；
 *   2. 文案拆成「数字 + 单位字母」两段：数字用大字号，M/S 用小字号，
 *      视觉主体（数字）比整串统一字号大约 30%；
 *   3. 字号仍是"先给大值，再按实际宽度收敛"，保证任何文案都单行显示。
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} size 画布边长
 * @param {string} text 倒计时文案，如 "60M" / "59S"
 */
function drawBadge(ctx, size, text) {
  // 外边距与内边距都按图标尺寸等比缩小，尽量把空间留给文字
  const margin = Math.max(1, Math.round(size * 0.02));
  const padX = Math.max(1, Math.round(size * 0.04));
  const padY = Math.max(1, Math.round(size * 0.04));
  const maxTextWidth = size - margin * 2 - padX * 2;

  // 拆分数字与单位；非预期格式（理论上不会出现）时按整串处理
  const matched = /^(\d+)(\D*)$/.exec(text);
  const numberPart = matched ? matched[1] : text;
  const unitPart = matched ? matched[2] : '';

  const fontOf = (px) => `800 ${px}px ${BADGE_FONT_FAMILY}`;
  let numberFont = Math.round(size * BADGE_NUMBER_FONT_RATIO);
  const unitFontOf = () => Math.max(5, Math.round(numberFont * BADGE_UNIT_FONT_RATIO));
  const gapOf = () => Math.round(numberFont * 0.04);

  /** 当前字号下「数字 + 单位」的实际总宽 */
  const measureTotal = () => {
    ctx.font = fontOf(numberFont);
    let width = ctx.measureText(numberPart).width;
    if (unitPart) {
      ctx.font = fontOf(unitFontOf());
      width += gapOf() + ctx.measureText(unitPart).width;
    }
    return width;
  };

  // 先给大字号，再逐像素收敛到可容纳的最大值
  while (numberFont > 5 && measureTotal() > maxTextWidth) {
    numberFont -= 1;
  }

  const unitFont = unitFontOf();
  const gap = gapOf();
  ctx.font = fontOf(numberFont);
  const numberWidth = ctx.measureText(numberPart).width;
  let unitWidth = 0;
  if (unitPart) {
    ctx.font = fontOf(unitFont);
    unitWidth = ctx.measureText(unitPart).width;
  }
  const totalWidth = numberWidth + (unitPart ? gap + unitWidth : 0);

  // 胶囊：贴底部的整条圆角矩形（宽度取满，横向空间全留给倒计时）
  const pillWidth = Math.min(size - margin * 2, Math.ceil(totalWidth + padX * 2));
  const pillHeight = Math.min(size - margin * 2, Math.ceil(numberFont * 1.12) + padY * 2);
  const x = Math.round((size - pillWidth) / 2);
  const y = size - pillHeight - margin;

  // 淡蓝底 + 淡蓝描边，保证在任何页面背景下都看得清
  const radius = Math.min(pillHeight / 2, pillWidth / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.arcTo(x + pillWidth, y, x + pillWidth, y + radius, radius);
  ctx.lineTo(x + pillWidth, y + pillHeight - radius);
  ctx.arcTo(x + pillWidth, y + pillHeight, x + pillWidth - radius, y + pillHeight, radius);
  ctx.lineTo(x + radius, y + pillHeight);
  ctx.arcTo(x, y + pillHeight, x, y + pillHeight - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = BADGE_BACKGROUND_COLOR;
  ctx.fill();
  ctx.lineWidth = Math.max(1, Math.round(size * 0.035));
  ctx.strokeStyle = BADGE_BORDER_COLOR;
  ctx.stroke();

  // 文字：数字与单位共用同一条基线，整体在胶囊内水平居中
  ctx.fillStyle = BADGE_FOREGROUND_COLOR;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const baselineY = y + pillHeight / 2 + numberFont * 0.36;
  let cursorX = x + (pillWidth - totalWidth) / 2;
  ctx.font = fontOf(numberFont);
  ctx.fillText(numberPart, cursorX, baselineY);
  if (unitPart) {
    cursorX += numberWidth + gap;
    ctx.font = fontOf(unitFont);
    ctx.fillText(unitPart, cursorX, baselineY);
  }
}

/**
 * 绘制「纯色倒计时牌」：整块圆角色块，不再画底图。
 *
 * 排版：数字独占一行（尽可能大，约占 0.7 倍边长），单位字母（M/S）
 * 用小字号居中排在其下方。因为数字不必再和单位抢横向空间，
 * 所以数字比"底部胶囊"方案大约再大 20%~30%，是三种方案里最醒目的。
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} size 画布边长
 * @param {string} text 倒计时文案，如 "60M" / "59S"
 */
function drawSolidBadge(ctx, size, text) {
  // 1) 纯色圆角底板（铺满整个图标区域）
  const radius = size * BADGE_SOLID_RADIUS_RATIO;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.arcTo(size, 0, size, radius, radius);
  ctx.lineTo(size, size - radius);
  ctx.arcTo(size, size, size - radius, size, radius);
  ctx.lineTo(radius, size);
  ctx.arcTo(0, size, 0, size - radius, radius);
  ctx.lineTo(0, radius);
  ctx.arcTo(0, 0, radius, 0, radius);
  ctx.closePath();
  ctx.fillStyle = BADGE_SOLID_BACKGROUND_COLOR;
  ctx.fill();

  // 2) 拆分数字与单位
  const matched = /^(\d+)(\D*)$/.exec(text);
  const numberPart = matched ? matched[1] : text;
  const unitPart = matched ? matched[2] : '';

  // 3) 数字字号：从 0.78 倍边长开始，按实际宽度收敛
  const fontOf = (px) => `800 ${px}px ${BADGE_FONT_FAMILY}`;
  const padX = size * 0.08;
  const maxNumberWidth = size - padX * 2;
  let numberFont = Math.round(size * BADGE_NUMBER_FONT_RATIO * 1.3);
  ctx.font = fontOf(numberFont);
  while (numberFont > 6 && ctx.measureText(numberPart).width > maxNumberWidth) {
    numberFont -= 1;
    ctx.font = fontOf(numberFont);
  }
  const unitFont = Math.max(5, Math.round(numberFont * 0.34));

  // 4) 数字居中偏上，单位排在其下方；两者共用"视觉重心"居中
  ctx.fillStyle = BADGE_SOLID_TEXT_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const numberBaseline = size / 2 + numberFont * (unitPart ? 0.22 : 0.36);
  ctx.font = fontOf(numberFont);
  ctx.fillText(numberPart, size / 2, numberBaseline);
  if (unitPart) {
    ctx.font = fontOf(unitFont);
    ctx.fillText(unitPart, size / 2, numberBaseline + unitFont * 0.95);
  }
}

/**
 * 生成带倒计时的图标 imageData（多尺寸，供不同设备像素比使用）。
 * 样式由常量 BADGE_STYLE 决定：'solid' 画纯色倒计时牌，'overlay' 画底部胶囊。
 * @param {string} text 倒计时文案；空字符串表示只画底图
 * @param {boolean} active 是否使用启用态底图
 * @returns {Promise<Record<number, ImageData>>}
 */
async function renderIconImageData(text, active) {
  // 纯色牌模式下不需要底图，这里跳过位图加载（少一次 fetch，也避免加载失败影响绘制）
  const solid = BADGE_STYLE === 'solid' && Boolean(text);
  const bitmaps = solid ? null : await loadIconBitmaps();
  const imageData = {};
  for (const size of BADGE_ICON_SIZES) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    if (solid) {
      // 纯色倒计时牌：整块重绘，不画底图（底图位图在此模式下无需加载）
      drawSolidBadge(ctx, size, text);
    } else {
      const base = active ? bitmaps.active : bitmaps.normal;
      ctx.drawImage(base, 0, 0, size, size);
      if (text) drawBadge(ctx, size, text);
    }
    imageData[size] = ctx.getImageData(0, 0, size, size);
  }
  return imageData;
}

/**
 * 把一个标签页恢复成普通态图标并清空倒计时。
 * @param {number} tabId
 */
async function clearTabUi(tabId) {
  badgeTextCache.delete(tabId);
  iconStateCache.delete(tabId);
  titleCache.delete(tabId);
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setIcon({ tabId, path: ICONS.normal });
    await chrome.action.setTitle({ tabId, title: DEFAULT_ACTION_TITLE });
  } catch {
    // 标签页已关闭等情况忽略
  }
}

/**
 * 根据当前剩余时间刷新标签页的 badge / 图标 / tooltip。
 * @param {number} tabId
 * @param {{ refreshRemaining: number|null, clickRemaining: number|null, refreshMs: number|null, clickMs: number|null, selector: string }} view
 */
async function updateTabUi(tabId, view) {
  const running = view.refreshRemaining !== null || view.clickRemaining !== null;
  if (!running) {
    await clearTabUi(tabId);
    return;
  }

  // 倒计时优先展示刷新；只启用点击时展示点击
  const remaining = view.refreshRemaining ?? view.clickRemaining;
  const text = formatBadge(Math.max(0, remaining));

  // 仅在文案变化时重绘，避免每秒重复绘制
  if (badgeTextCache.get(tabId) !== text || iconStateCache.get(tabId) !== true) {
    badgeTextCache.set(tabId, text);
    iconStateCache.set(tabId, true);
    try {
      const imageData = await renderIconImageData(text, true);
      await chrome.action.setIcon({ tabId, imageData });
      // 倒计时已画在图标上，清掉原生 badge，避免重复显示
      await chrome.action.setBadgeText({ tabId, text: '' });
    } catch (error) {
      console.warn('[auto-refresh] 自绘图标失败，退回原生 badge：', error);
      try {
        await chrome.action.setIcon({ tabId, path: ICONS.active });
        await chrome.action.setBadgeText({ tabId, text });
        await chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_BACKGROUND_COLOR });
        // 淡蓝底配深蓝字，保证可读性（旧版 Chrome 无此 API 时忽略）
        if (chrome.action.setBadgeTextColor) {
          await chrome.action.setBadgeTextColor({ tabId, color: BADGE_FOREGROUND_COLOR });
        }
      } catch {
        /* 标签页已关闭则忽略 */
      }
    }
  }

  // tooltip 补充完整信息，方便鼠标悬停查看
  const parts = [];
  if (view.refreshMs) parts.push(`定时刷新 ${formatInterval(view.refreshMs)}`);
  if (view.clickMs) {
    parts.push(`自动点击 ${view.selector || '—'}（${formatMatch(view.match)}）${formatInterval(view.clickMs)}`);
  }
  // tooltip 只描述"已启用了什么"（剩余时间由 badge 呈现），这样文案稳定、可被缓存命中
  const title = parts.join(' · ') || DEFAULT_ACTION_TITLE;
  // tooltip 同样做缓存，避免每秒调用 API
  if (titleCache.get(tabId) !== title) {
    titleCache.set(tabId, title);
    try {
      await chrome.action.setTitle({ tabId, title });
    } catch {
      /* 忽略 */
    }
  }
}

/* ================================================================== *
 * 四、运行时构建与对齐
 * ================================================================== */

/**
 * 依据域名配置创建一个标签页的运行时（全新倒计时）。
 * @param {string} hostname
 * @param {string} url
 * @param {object} config 域名配置
 * @param {number} now
 */
function createRuntime(hostname, url, config, now) {
  return {
    hostname,
    url,
    refreshNextAt: config.refresh?.enabled ? now + config.refresh.intervalMs : null,
    clickNextAt: config.click?.enabled ? now + config.click.intervalMs : null,
    // 记录"当前倒计时所使用的周期/选择器"，用于识别用户是否改过配置
    refreshIntervalMs: config.refresh?.enabled ? config.refresh.intervalMs : null,
    clickIntervalMs: config.click?.enabled ? config.click.intervalMs : null,
    clickSelector: config.click?.enabled ? config.click.selector : undefined,
    // 匹配序号（第几个 / last）：与选择器一起决定"点了谁"
    clickMatch: config.click?.enabled ? normalizeMatch(config.click.match) : undefined,
    lastError: '',
    lastEventAt: null,
  };
}

/**
 * 重置一个已有运行时的倒计时（同域名内地址变更时调用）。
 * @param {object} runtime
 * @param {object} config
 * @param {number} now
 */
function resetRuntime(runtime, config, now) {
  runtime.refreshNextAt = config.refresh?.enabled ? now + config.refresh.intervalMs : null;
  runtime.clickNextAt = config.click?.enabled ? now + config.click.intervalMs : null;
  runtime.refreshIntervalMs = config.refresh?.enabled ? config.refresh.intervalMs : null;
  runtime.clickIntervalMs = config.click?.enabled ? config.click.intervalMs : null;
  runtime.clickSelector = config.click?.enabled ? config.click.selector : undefined;
  runtime.clickMatch = config.click?.enabled ? normalizeMatch(config.click.match) : undefined;
}

/**
 * 让单个标签页与域名配置对齐：
 *   - 页面不支持 / 该域名未启用 → 清理运行时与 badge
 *   - 新标签页或首次启用 → 全新倒计时
 *   - 同域名内 URL 变化 → 重新计时
 *   - 自身刷新（URL 未变）→ 保持当前倒计时，不重复重置
 * @param {chrome.tabs.Tab} tab
 * @param {object} configs
 * @param {object} runtimes
 * @param {number} now
 */
async function alignTab(tab, configs, runtimes, now) {
  const key = String(tab.id);
  const hostname = getHostFromUrl(tab.url);
  const config = hostname ? configs[hostname] : null;
  const shouldRun = Boolean(
    config && (config.refresh?.enabled || config.click?.enabled) && isSupportedUrl(tab.url),
  );

  if (!shouldRun) {
    if (runtimes[key]) {
      delete runtimes[key];
      await clearTabUi(tab.id);
    }
    return;
  }

  const previous = runtimes[key];
  if (!previous || previous.hostname !== hostname) {
    // 新开的同域名标签页，或切换到了另一个已配置的域名
    runtimes[key] = createRuntime(hostname, tab.url || '', config, now);
    return;
  }

  // 同一域名下地址（路径/查询串）发生变化 → 重新计时
  if (previous.url !== (tab.url || '')) {
    previous.url = tab.url || '';
    resetRuntime(previous, config, now);
    return;
  }

  // 配置中已停用的功能要清掉对应倒计时；新启用 / 改过周期的功能重新开始计时
  // ——需求：用户切换定时时间后，计时器按新的周期重新计算
  if (config.refresh?.enabled) {
    const intervalChanged = previous.refreshIntervalMs !== config.refresh.intervalMs;
    if (previous.refreshNextAt == null || intervalChanged) {
      previous.refreshNextAt = now + config.refresh.intervalMs;
      previous.refreshIntervalMs = config.refresh.intervalMs;
    }
  } else {
    previous.refreshNextAt = null;
    previous.refreshIntervalMs = null;
  }

  if (config.click?.enabled) {
    // 选择器、序号或周期变更都视为新任务，重新开始计时
    const match = normalizeMatch(config.click.match);
    const selectorChanged = previous.clickSelector !== config.click.selector;
    const matchChanged = previous.clickMatch !== match;
    const intervalChanged = previous.clickIntervalMs !== config.click.intervalMs;
    if (previous.clickNextAt == null || selectorChanged || matchChanged || intervalChanged) {
      previous.clickNextAt = now + config.click.intervalMs;
      previous.clickIntervalMs = config.click.intervalMs;
      previous.clickSelector = config.click.selector;
      previous.clickMatch = match;
    }
  } else {
    previous.clickNextAt = null;
    previous.clickIntervalMs = null;
    previous.clickSelector = undefined;
    previous.clickMatch = undefined;
  }
}

/**
 * 全量对齐：把所有标签页与最新域名配置同步，并清理已关闭标签页的运行时。
 * 配置变化（启用 / 停止）、浏览器启动、扩展安装后都会调用。
 */
async function syncAllTabs() {
  const configs = await readConfigs();
  const runtimes = await readRuntimes();
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const alive = new Set();

  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    alive.add(String(tab.id));
    await alignTab(tab, configs, runtimes, now);
    // 配置变更 / 浏览器启动后立即重绘图标，不等下一次滴答
    await repaintTab(tab.id, configs, runtimes);
  }

  // 清理已关闭的标签页
  for (const key of Object.keys(runtimes)) {
    if (!alive.has(key)) {
      delete runtimes[key];
      await clearTabUi(Number(key));
    }
  }

  await writeRuntimes(runtimes);
  await updateHeartbeat(configs);
}

/* ================================================================== *
 * 五、动作执行
 * ================================================================== */

/**
 * 刷新标签页。
 * @param {number} tabId
 */
async function refreshTab(tabId) {
  try {
    await chrome.tabs.reload(tabId);
  } catch (error) {
    console.warn('[auto-refresh] 刷新页面失败：', error);
  }
}

/**
 * 注入到页面执行点击的函数。
 * 注意：executeScript 会把函数序列化后注入，**不能引用外部作用域的变量**，
 * 只能通过 args 传参。
 *
 * 匹配策略：先用 querySelectorAll 取出全部命中元素，
 * 再按序号取第 N 个（从 1 开始）或最后一个，因此类选择器命中多个时也能精确指定。
 *
 * @param {string} selector CSS 选择器
 * @param {number|'last'} match 第几个；'last' 表示最后一个
 * @returns {{ ok: boolean, reason?: string, total: number, target?: number }}
 */
function clickBySelector(selector, match) {
  try {
    const nodes = document.querySelectorAll(selector);
    const total = nodes.length;
    if (total === 0) return { ok: false, reason: '未找到匹配元素', total };
    // 'last' 等价于最后一个；数字按 1 起步换算成下标
    const wanted = match === 'last' ? total : match;
    if (wanted > total) {
      return {
        ok: false,
        reason: `只匹配到 ${total} 个元素，序号 ${wanted} 超出范围`,
        total,
      };
    }
    nodes[wanted - 1].click();
    return { ok: true, total, target: wanted };
  } catch (error) {
    return { ok: false, reason: `选择器无效：${error && error.message ? error.message : error}`, total: 0 };
  }
}

/**
 * 在标签页中点击匹配选择器的元素。
 * @param {number} tabId
 * @param {string} selector
 * @param {number|'last'} match 第几个；'last' 表示最后一个
 */
async function clickInTab(tabId, selector, match) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: clickBySelector,
      args: [selector, match],
    });
    const result = results?.[0]?.result;
    if (result && result.ok) {
      const target = match === 'last' ? '最后一个' : `第 ${match} 个`;
      await recordEvent(tabId, `已点击 ${selector} 的${target}（共 ${result.total} 个匹配）`);
      return;
    }
    // 未命中或选择器非法：记录提示但继续倒计时
    await recordEvent(tabId, result?.reason || '未找到匹配元素，请检查选择器');
  } catch (error) {
    console.warn('[auto-refresh] 点击失败：', error);
    await recordEvent(tabId, '无法访问该页面，自动点击已跳过');
  }
}

/**
 * 记录最近一次执行结果，供弹窗回显。
 * @param {number} tabId
 * @param {string} message
 */
async function recordEvent(tabId, message) {
  const runtimes = await readRuntimes();
  const runtime = runtimes[String(tabId)];
  if (!runtime) return;
  runtime.lastError = message;
  runtime.lastEventAt = Date.now();
  await writeRuntimes(runtimes);
}

/* ================================================================== *
 * 六、滴答器：每秒计算剩余时间，到点触发动作
 * ================================================================== */

let tickHandle = null; // 仅用于避免重复创建定时器
let ticking = false; // 防止上一次滴答未结束时重入

/**
 * 构造渲染图标所需的数据（剩余时间 + 当前生效配置）。
 * @param {object} runtime 标签页运行时
 * @param {object} config 域名配置
 * @param {number} now
 */
function buildTabView(runtime, config, now) {
  return {
    refreshRemaining: runtime.refreshNextAt != null ? runtime.refreshNextAt - now : null,
    clickRemaining: runtime.clickNextAt != null ? runtime.clickNextAt - now : null,
    refreshMs: config.refresh?.enabled ? config.refresh.intervalMs : null,
    clickMs: config.click?.enabled ? config.click.intervalMs : null,
    selector: config.click?.selector || '',
    match: normalizeMatch(config.click?.match),
  };
}

/**
 * 丢弃某个标签页的 UI 缓存。
 * 场景：页面导航完成后 Chrome 会重置该标签页的图标/badge，
 * 此时必须清掉缓存，否则滴答器会因"文案没变"而跳过重绘，导致启用态图标丢失。
 * @param {number} tabId
 */
function invalidateTabUi(tabId) {
  badgeTextCache.delete(tabId);
  iconStateCache.delete(tabId);
  titleCache.delete(tabId);
}

/**
 * 立即重绘某个标签页的图标（导航完成、配置变更后调用）。
 * @param {number} tabId
 * @param {object} configs
 * @param {object} runtimes
 */
async function repaintTab(tabId, configs, runtimes) {
  const runtime = runtimes[String(tabId)];
  if (!runtime) return;
  const config = configs[runtime.hostname];
  if (!config || !(config.refresh?.enabled || config.click?.enabled)) return;
  invalidateTabUi(tabId);
  await updateTabUi(tabId, buildTabView(runtime, config, Date.now()));
}

/** 确保滴答器在跑（SW 每次唤醒都要调用一次） */
function ensureTicker() {
  if (tickHandle !== null) return;
  tickHandle = setInterval(() => {
    void tick();
  }, TICK_MS);
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const configs = await readConfigs();
    const runtimes = await readRuntimes();
    const now = Date.now();
    const jobs = [];
    let changed = false;

    for (const key of Object.keys(runtimes)) {
      const tabId = Number(key);
      const runtime = runtimes[key];
      const config = configs[runtime.hostname];

      // 配置已删除或页面不再支持 → 清理
      if (!config || !(config.refresh?.enabled || config.click?.enabled)) {
        delete runtimes[key];
        changed = true;
        jobs.push(clearTabUi(tabId));
        continue;
      }

      // 刷新到点：先推进 nextAt，再执行，避免重复刷新
      if (config.refresh?.enabled && runtime.refreshNextAt != null && now >= runtime.refreshNextAt) {
        runtime.refreshNextAt = now + config.refresh.intervalMs;
        runtime.lastError = '已刷新页面';
        runtime.lastEventAt = now;
        changed = true;
        jobs.push(refreshTab(tabId));
      }

      // 点击到点
      if (config.click?.enabled && runtime.clickNextAt != null && now >= runtime.clickNextAt) {
        runtime.clickNextAt = now + config.click.intervalMs;
        changed = true;
        jobs.push(clickInTab(tabId, config.click.selector, normalizeMatch(config.click.match)));
      }

      jobs.push(updateTabUi(tabId, buildTabView(runtime, config, now)));
    }

    // 先落盘再执行动作，确保即使动作阻塞也不会重复触发
    if (changed) await writeRuntimes(runtimes);
    await Promise.allSettled(jobs);
  } catch (error) {
    console.warn('[auto-refresh] 滴答异常：', error);
  } finally {
    ticking = false;
  }
}

/* ================================================================== *
 * 七、兜底心跳：SW 被回收后由 alarm 唤醒并重建滴答器
 * ================================================================== */

/**
 * 存在任一启用配置时开启心跳 alarm，否则关闭，避免空转。
 * @param {object} configs
 */
async function updateHeartbeat(configs) {
  const anyEnabled = Object.values(configs).some(
    (config) => config?.refresh?.enabled || config?.click?.enabled,
  );
  if (anyEnabled) {
    const existing = await chrome.alarms.get(HEARTBEAT_ALARM);
    if (existing) return;
    try {
      await chrome.alarms.create(HEARTBEAT_ALARM, {
        delayInMinutes: HEARTBEAT_PERIOD_MINUTES,
        periodInMinutes: HEARTBEAT_PERIOD_MINUTES,
      });
    } catch {
      // 旧版 Chrome 最小周期为 1 分钟，这里回退
      await chrome.alarms.create(HEARTBEAT_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
    }
  } else {
    await chrome.alarms.clear(HEARTBEAT_ALARM);
  }
}

/* ================================================================== *
 * 八、弹窗指令
 * ================================================================== */

/**
 * 更新某个域名的其中一项配置。
 * @param {string} hostname
 * @param {'refresh'|'click'} feature
 * @param {object|null} value null 表示停用
 */
async function setFeature(hostname, feature, value) {
  const configs = await readConfigs();
  const config = configs[hostname] || { refresh: null, click: null };
  config[feature] = value;
  configs[hostname] = config;
  await writeConfigs(configs);
  await syncAllTabs();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    try {
      switch (message.type) {
        case MSG.ENABLE_REFRESH: {
          await setFeature(message.host, 'refresh', {
            enabled: true,
            intervalMs: message.intervalMs,
          });
          sendResponse({ ok: true });
          break;
        }
        case MSG.STOP_REFRESH: {
          await setFeature(message.host, 'refresh', null);
          sendResponse({ ok: true });
          break;
        }
        case MSG.ENABLE_CLICK: {
          await setFeature(message.host, 'click', {
            enabled: true,
            selector: message.selector,
            intervalMs: message.intervalMs,
            match: normalizeMatch(message.match),
          });
          sendResponse({ ok: true });
          break;
        }
        case MSG.STOP_CLICK: {
          await setFeature(message.host, 'click', null);
          sendResponse({ ok: true });
          break;
        }
        default: {
          sendResponse({ ok: false, message: '未知指令' });
        }
      }
    } catch (error) {
      console.warn('[auto-refresh] 处理指令失败：', error);
      sendResponse({ ok: false, message: error?.message || '操作失败' });
    }
  })();

  return true; // 异步响应必须返回 true
});

/* ================================================================== *
 * 九、事件注册（必须在 SW 顶层同步注册，条件判断放在监听器内部）
 * ================================================================== */

/** 标签页导航完成：对齐配置、按需重新计时 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  void (async () => {
    try {
      const configs = await readConfigs();
      const runtimes = await readRuntimes();
      await alignTab(tab, configs, runtimes, Date.now());
      await writeRuntimes(runtimes);
      // 页面导航（含本扩展触发的刷新）会重置该标签页的图标/badge，
      // 这里立刻重绘一次，保证启用态图标与倒计时不会丢失。
      await repaintTab(tabId, configs, runtimes);
      await updateHeartbeat(configs);
      ensureTicker();
    } catch (error) {
      console.warn('[auto-refresh] 处理标签页更新失败：', error);
    }
  })();
});

/** 标签页关闭：清理运行时与 badge */
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    try {
      const runtimes = await readRuntimes();
      if (!runtimes[String(tabId)]) return;
      delete runtimes[String(tabId)];
      await writeRuntimes(runtimes);
      await clearTabUi(tabId);
    } catch (error) {
      console.warn('[auto-refresh] 清理标签页失败：', error);
    }
  })();
});

/** SW 被回收后由心跳 alarm 唤醒：重建滴答器并立即补一次滴答 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  ensureTicker();
  void tick();
});

/** 扩展安装 / 更新：全量对齐一次 */
chrome.runtime.onInstalled.addListener(() => {
  void syncAllTabs();
  ensureTicker();
});

/** 浏览器启动：全量对齐一次 */
chrome.runtime.onStartup.addListener(() => {
  void syncAllTabs();
  ensureTicker();
});

// SW 每次启动都恢复滴答器（全局变量会随 SW 终止丢失，这里只需重建定时器）
ensureTicker();
