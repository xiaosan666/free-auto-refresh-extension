/**
 * 全局常量：弹窗与后台 Service Worker 共用，保证两边规则完全一致。
 * 修改这里的常量即可调整快捷项、上下限与存储键名。
 */

/* ------------------------------------------------------------------ *
 * 时间单位（毫秒）
 * ------------------------------------------------------------------ */
export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;

/* ------------------------------------------------------------------ *
 * chrome.storage.local 的存储键名
 * ------------------------------------------------------------------ */
/** 域名配置：<hostname> -> { refresh, click } */
export const STORE_KEY_CONFIGS = 'domainConfigs';
/** 标签页运行时：<tabId> -> { hostname, url, refreshNextAt, clickNextAt, ... } */
export const STORE_KEY_RUNTIMES = 'tabRuntimes';

/* ------------------------------------------------------------------ *
 * 快捷时间选项
 * ------------------------------------------------------------------ */
/** 定时刷新的快捷项：1M / 5M / 10M / 15M / 60M */
export const REFRESH_PRESETS = [
  { label: '1M', ms: 1 * MINUTE_MS },
  { label: '5M', ms: 5 * MINUTE_MS },
  { label: '10M', ms: 10 * MINUTE_MS },
  { label: '15M', ms: 15 * MINUTE_MS },
  { label: '60M', ms: 60 * MINUTE_MS },
];

/** 自动定时点击的快捷项：1M / 4M / 9M / 59M */
export const CLICK_PRESETS = [
  { label: '1M', ms: 1 * MINUTE_MS },
  { label: '4M', ms: 4 * MINUTE_MS },
  { label: '9M', ms: 9 * MINUTE_MS },
  { label: '59M', ms: 59 * MINUTE_MS },
];

/* ------------------------------------------------------------------ *
 * 输入上下限（单位：秒）
 * ------------------------------------------------------------------ */
/** 刷新周期下限：小于 60 秒自动重置为 60 秒 */
export const REFRESH_MIN_SECONDS = 60;
/** 刷新周期上限：24 小时 */
export const REFRESH_MAX_SECONDS = 24 * 60 * 60;
/** 点击周期下限：1 秒 */
export const CLICK_MIN_SECONDS = 1;
/** 点击周期上限：24 小时 */
export const CLICK_MAX_SECONDS = 24 * 60 * 60;

/* ------------------------------------------------------------------ *
 * 后台调度
 * ------------------------------------------------------------------ */
/** 滴答间隔：1 秒（驱动 badge 与动作触发） */
export const TICK_MS = SECOND_MS;
/** 兜底心跳 alarm 名称：SW 被系统回收后由它唤醒并重建滴答器 */
export const HEARTBEAT_ALARM = 'auto-refresh-heartbeat';
/** 心跳周期（分钟）。Chrome 120+ 最小支持 0.5 分钟，创建失败时回退到 1 分钟 */
export const HEARTBEAT_PERIOD_MINUTES = 0.5;

/* ------------------------------------------------------------------ *
 * 弹窗与后台之间的消息类型
 * ------------------------------------------------------------------ */
export const MSG = {
  ENABLE_REFRESH: 'ENABLE_REFRESH',
  STOP_REFRESH: 'STOP_REFRESH',
  ENABLE_CLICK: 'ENABLE_CLICK',
  STOP_CLICK: 'STOP_CLICK',
};

/* ------------------------------------------------------------------ *
 * 图标资源（普通态 / 启用态），setIcon 必须指向真实存在的文件
 * ------------------------------------------------------------------ */
export const ICONS = {
  normal: {
    16: 'images/icon-16.png',
    32: 'images/icon-32.png',
    48: 'images/icon-48.png',
    128: 'images/icon-128.png',
  },
  active: {
    16: 'images/icon-16-active.png',
    32: 'images/icon-32-active.png',
    48: 'images/icon-48-active.png',
    128: 'images/icon-128-active.png',
  },
};

/**
 * 倒计时胶囊配色：淡蓝底 + 深蓝字 + 淡蓝描边
 * 自绘图标与「原生 badge 兜底方案」共用这套配色，保证观感一致。
 */
export const BADGE_BACKGROUND_COLOR = '#E8F0FF';
export const BADGE_FOREGROUND_COLOR = '#1D4ED8';
export const BADGE_BORDER_COLOR = 'rgba(29, 78, 216, 0.35)';

/**
 * 倒计时图标样式：
 *   - 'solid'  ：纯色倒计时牌（整块圆角色块 + 大号数字，数字最大、最醒目，但看不到底图）
 *   - 'overlay'：在原图标底部叠加淡蓝胶囊（保留图标启用态，字号相对小一些）
 * 想换风格只改这一处即可。
 */
export const BADGE_STYLE = 'solid';

/** 纯色倒计时牌配色：品牌蓝底 + 白色文字，对比度最高 */
export const BADGE_SOLID_BACKGROUND_COLOR = '#1D4ED8';
export const BADGE_SOLID_TEXT_COLOR = '#FFFFFF';
/** 纯色牌的圆角比例（相对边长） */
export const BADGE_SOLID_RADIUS_RATIO = 0.22;

/**
 * 自绘图标的尺寸档位：Chrome 会按设备像素比挑选最合适的一档。
 * 自绘是为了精确控制胶囊的内边距与字号（原生 badge 会在 3 字符时换行）。
 */
export const BADGE_ICON_SIZES = [16, 32, 64];

/** 绘制倒计时胶囊时使用的底图（用 128px 源图缩放，保证清晰） */
export const BADGE_BASE_ICON = {
  normal: 'images/icon-128.png',
  active: 'images/icon-128-active.png',
};
/** 扩展图标 tooltip 的默认文案 */
export const DEFAULT_ACTION_TITLE = '定时刷新 & 自动点击';
