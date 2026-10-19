/**
 * 共享工具函数：域名归一化、时间格式化、统一校验规则。
 * 弹窗与后台共用同一份实现，避免前后端规则漂移。
 */

import {
  SECOND_MS,
  MINUTE_MS,
  REFRESH_MIN_SECONDS,
  REFRESH_MAX_SECONDS,
  CLICK_MIN_SECONDS,
  CLICK_MAX_SECONDS,
} from './constants.js';

/* ------------------------------------------------------------------ *
 * 域名处理
 * ------------------------------------------------------------------ */

/**
 * 归一化 hostname：小写、去掉首尾空白、去掉开头的 "www."。
 * 这样 www.baidu.com 与 baidu.com 被视为同一域名。
 * @param {string} hostname
 * @returns {string} 归一化后的域名；空值返回 ''
 */
export function normalizeHost(hostname) {
  if (typeof hostname !== 'string') return '';
  let host = hostname.trim().toLowerCase();
  // 去掉末尾的点（如 baidu.com.）
  if (host.endsWith('.')) host = host.slice(0, -1);
  // 忽略 www. 前缀
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

/**
 * 从 URL 中解析出归一化域名。
 * @param {string|undefined} url
 * @returns {string} 域名；URL 非法或不支持时返回 ''
 */
export function getHostFromUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return normalizeHost(parsed.hostname);
  } catch {
    return '';
  }
}

/**
 * 判断页面是否可被本扩展操作（刷新 / 注入脚本）。
 * chrome://、扩展页、about: 等内部页面无法注入与刷新。
 * @param {string|undefined} url
 * @returns {boolean}
 */
export function isSupportedUrl(url) {
  return getHostFromUrl(url) !== '';
}

/* ------------------------------------------------------------------ *
 * 时间格式化
 * ------------------------------------------------------------------ */

/**
 * 生成扩展图标 badge 文案。
 * 剩余 > 1 分钟：`5M`、`4M`、`3M`（向上取整）；
 * 剩余 ≤ 1 分钟：`59S`、`58S`、`57S`（向下取整，最大 59）。
 * @param {number} remainingMs 剩余毫秒
 * @returns {string}
 */
export function formatBadge(remainingMs) {
  const ms = Math.max(0, remainingMs);
  if (ms >= MINUTE_MS) {
    // 减 1 毫秒再向上取整，保证恰好 60.000s 时显示 1M 而不是 2M
    return `${Math.ceil((ms - 1) / MINUTE_MS)}M`;
  }
  const seconds = Math.min(59, Math.floor(ms / SECOND_MS));
  return `${seconds}S`;
}

/**
 * 格式化为 MM:SS，用于弹窗状态回显（最大支持 24 小时）。
 * @param {number} remainingMs
 * @returns {string}
 */
export function formatClock(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / SECOND_MS));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 把毫秒周期格式化为易读文案，用于提示语与 tooltip。
 * 整分钟显示「X 分钟」，否则显示「X 秒」。
 * @param {number} ms
 * @returns {string}
 */
export function formatInterval(ms) {
  if (!ms) return '—';
  if (ms % MINUTE_MS === 0) return `${ms / MINUTE_MS} 分钟`;
  if (ms % SECOND_MS === 0) return `${ms / SECOND_MS} 秒`;
  return `${(ms / SECOND_MS).toFixed(1)} 秒`;
}

/* ------------------------------------------------------------------ *
 * 统一校验规则
 * ------------------------------------------------------------------ */

/**
 * 解析并校验秒级输入。
 * 小于下限：自动重置为下限并给出 warn 级提示（仍然可以启用）；
 * 大于上限：返回 error，不允许启用。
 * @param {string|number} raw 输入框原始值
 * @param {{ min: number, max: number, autoResetMessage: string, maxMessage: string, emptyMessage: string }} rules
 * @returns {{ ok: boolean, seconds: number|null, level: 'error'|'warn'|'ok', message: string }}
 */
export function validateSecondsInput(raw, rules) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { ok: false, seconds: null, level: 'error', message: rules.emptyMessage };
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return { ok: false, seconds: null, level: 'error', message: rules.emptyMessage };
  }
  if (value > rules.max) {
    return { ok: false, seconds: null, level: 'error', message: rules.maxMessage };
  }
  if (value < rules.min) {
    // 需求：刷新输入小于 60 自动重置为 60
    return {
      ok: true,
      seconds: rules.min,
      level: 'warn',
      message: rules.autoResetMessage.replace('{min}', String(rules.min)),
    };
  }
  // 向下取整，避免小数进入计时逻辑
  return { ok: true, seconds: Math.floor(value), level: 'ok', message: '' };
}

/** 刷新周期校验（单位秒，下限 60，上限 86400） */
export function validateRefreshSeconds(raw) {
  return validateSecondsInput(raw, {
    min: REFRESH_MIN_SECONDS,
    max: REFRESH_MAX_SECONDS,
    emptyMessage: `请输入 ${REFRESH_MIN_SECONDS} ~ ${REFRESH_MAX_SECONDS} 之间的秒数`,
    autoResetMessage: `已小于 ${REFRESH_MIN_SECONDS} 秒，自动按 {min} 秒启用`,
    maxMessage: `周期不能超过 24 小时（${REFRESH_MAX_SECONDS} 秒）`,
  });
}

/** 点击周期校验（单位秒，下限 1，上限 86400） */
export function validateClickSeconds(raw) {
  return validateSecondsInput(raw, {
    min: CLICK_MIN_SECONDS,
    max: CLICK_MAX_SECONDS,
    emptyMessage: `请输入 ${CLICK_MIN_SECONDS} ~ ${CLICK_MAX_SECONDS} 之间的秒数`,
    autoResetMessage: `已小于 ${CLICK_MIN_SECONDS} 秒，自动按 {min} 秒启用`,
    maxMessage: `周期不能超过 24 小时（${CLICK_MAX_SECONDS} 秒）`,
  });
}

/**
 * 校验元素选择器：不能为空，且不允许包含换行等明显非法字符。
 * @param {string} raw
 * @returns {{ ok: boolean, value: string, message: string }}
 */
export function validateSelector(raw) {
  const value = String(raw ?? '').trim();
  if (value === '') {
    return { ok: false, value: '', message: '请填写元素选择器，如 #submit 或 .btn-next' };
  }
  if (/[\r\n]/.test(value)) {
    return { ok: false, value, message: '选择器不能包含换行' };
  }
  return { ok: true, value, message: '' };
}

/** 匹配序号允许的最大值，防止误填超大数字 */
export const MATCH_MAX = 9999;

/**
 * 解析「匹配序号」：选择器命中多个元素时，指定点击哪一个。
 * 支持：正整数（第 N 个，从 1 开始）、`last`（最后一个）、`-1`（等价于 last）。
 * 留空默认为 1（即原来的 querySelector 行为）。
 * @param {string|number} raw
 * @returns {{ ok: boolean, value: number|'last', message: string }}
 */
export function parseMatchToken(raw) {
  const text = String(raw ?? '').trim().toLowerCase();
  if (text === '' || text === '1') return { ok: true, value: 1, message: '' };
  if (text === 'last' || text === 'l' || text === '-1') return { ok: true, value: 'last', message: '' };
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    if (value < 1) return { ok: false, value: 1, message: '序号需为不小于 1 的整数' };
    if (value > MATCH_MAX) {
      return { ok: false, value: 1, message: `序号不能超过 ${MATCH_MAX}` };
    }
    return { ok: true, value, message: '' };
  }
  return { ok: false, value: 1, message: '序号只能填数字或 last，例如 2、3、last' };
}

/**
 * 把匹配序号转成中文说明，用于提示与 tooltip。
 * @param {number|'last'|undefined|null} value
 * @returns {string}
 */
export function formatMatch(value) {
  if (value === 'last') return '最后一个';
  const index = Number(value);
  if (!Number.isFinite(index) || index < 1) return '第 1 个';
  return `第 ${index} 个`;
}

/** 统一取值：没配过序号时按 1（第一个）处理，兼容旧配置 */
export function normalizeMatch(value) {
  if (value === 'last') return 'last';
  const index = Number(value);
  if (Number.isFinite(index) && index >= 1) return Math.floor(index);
  return 1;
}

/**
 * 校验「点击周期必须小于刷新周期」（仅当刷新已启用时才需要）。
 * @param {number} clickMs 点击周期（毫秒）
 * @param {number|null} refreshMs 刷新周期（毫秒），未启用传 null
 * @returns {{ ok: boolean, message: string }}
 */
export function validateClickBeforeRefresh(clickMs, refreshMs) {
  if (!refreshMs) return { ok: true, message: '' };
  if (clickMs >= refreshMs) {
    return {
      ok: false,
      message: `自动点击周期需小于刷新周期（当前刷新 ${formatInterval(refreshMs)}）`,
    };
  }
  return { ok: true, message: '' };
}
