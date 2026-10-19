# Chrome 应用商店上架文案（可直接粘贴 / Ready-to-paste store listing）

> 提交位置：开发者控制台 → 商品详情 → 「商店信息（Store listing）」
> 建议主语言：Chinese (zh-CN)；如需英文商店页，在「添加语言」里再贴英文版。

---

## 1. 简短描述（Short description，≤132 字符）

**中文**

```
按域名定时自动刷新页面，并可定时自动点击指定元素，扩展图标实时显示倒计时。
```

**English**

```
Auto-refresh tabs on a timer, auto-click any element by CSS selector, with a live countdown on the toolbar icon.
```

---

## 2. 详细说明（Detailed description）

> 使用方式：主语言贴中文版；点「添加语言 → English」后，在英文页签贴英文版。
> 说明字段上限 16,000 字符，下面两版都远低于上限。

**中文（主语言）**

```
定时刷新 & 自动点击 —— 让页面自己"动"起来。

【定时刷新】
· 快捷选择 1M / 5M / 10M / 15M / 60M，点击即生效
· 也可自定义秒数（下限 60 秒），输入后点"启用"生效
· 按域名生效：同域名下切换路径继续生效，地址变化自动重新计时
· 同域名的所有标签页（含后续新开的）都会自动执行，互不干扰
· 页面上实时显示剩余时间

【自动定时点击】
· 填入任意 CSS 选择器（#id、.class 等），按周期自动点击匹配元素
· 快捷选择 1M / 4M / 9M / 59M，也可自定义秒数
· 与刷新同时启用时，会自动校验"点击周期 < 刷新周期"

【图标实时倒计时】
· 剩余大于 1 分钟显示 5M / 4M / 3M，小于 1 分钟显示 59S / 58S / 57S
· 随时点击图标查看剩余时间，可分别停止刷新与点击

【隐私】
· 不联网、不采集、不上传任何数据
· 所有配置只保存在你本机的 chrome.storage.local
· 开源可审计：https://github.com/xiaosan666/free-auto-refresh-extension

适用场景：监控数据看板、定时签到、页面保活、周期性检查页面状态、演示与大屏值守等需要"页面按固定节奏自动刷新"的工作。
```

**English**

```
Auto Refresh & Auto Click — put your pages on autopilot.

AUTO REFRESH
· One-click presets: 1M / 5M / 10M / 15M / 60M — they take effect immediately
· Or type a custom interval in seconds (minimum 60s)
· Works per domain: switching paths within the same domain keeps it running, and the timer restarts when the address changes
· Applies to every tab of that domain, including tabs opened later — each with its own countdown
· The remaining time is shown right in the popup

AUTO CLICK
· Enter any CSS selector (#id, .class, …) and the matching element is clicked on schedule
· Presets: 1M / 4M / 9M / 59M, or a custom interval in seconds
· When both features are on, the extension enforces "click interval < refresh interval"

LIVE COUNTDOWN ON THE ICON
· Shows 5M / 4M / 3M above one minute, and 59S / 58S / 57S below one minute
· Open the popup anytime to see the remaining time and stop refresh or click independently

PRIVACY
· No network requests, no data collection, no uploads
· All settings stay in your local chrome.storage.local
· Open source and auditable: https://github.com/xiaosan666/free-auto-refresh-extension

Use cases: monitoring dashboards, scheduled check-ins, keeping pages alive, periodically checking a page's state, unattended demos and big-screen displays — any work that needs a page to refresh on a fixed schedule.
```

---

## 3. 其他表单项

| 项目 | 填写建议 |
| --- | --- |
| 类别 / Category | Productivity（或 Developer Tools） |
| 语言 / Language | Chinese (zh-CN) |
| 主页 URL | `https://github.com/xiaosan666/free-auto-refresh-extension` |
| 隐私政策 URL | `https://github.com/xiaosan666/free-auto-refresh-extension/blob/main/PRIVACY.md` |
| 是否收集用户数据 | 否 / No（勾选"不收集"） |
| 是否为单用途 | 是：定时刷新与定时点击页面（同一用途：页面定时自动化） |
| 是否含远程代码 | 否 / No |

---

## 4. 权限用途说明（审核表单逐条填写，建议用英文）

| Permission | Justification（可直接粘贴） |
| --- | --- |
| `tabs` | Read the tab URL to determine its domain and reload the tab when the refresh countdown reaches zero. |
| `scripting` | On pages where the user enabled it, click the element matching the CSS selector configured by the user. |
| `storage` | Store per-domain timer settings and countdown state locally so timers survive browser restarts. |
| `alarms` | Wake the service worker periodically to keep countdowns accurate after the browser terminates it. |
| `host_permissions: <all_urls>` | The user may enable auto-refresh/auto-click on any website they choose, so target domains cannot be declared in advance. No data is collected or transmitted. |

> 提示：宽泛主机权限可能触发 **Limited visibility**（商品不出现在搜索结果）。理由按上表写清楚可显著降低概率。

---

## 5. 上传素材清单

- [ ] 图标 128×128：`images/icon-128.png`
- [ ] 截图 1：弹窗主界面（展示两个功能区）
- [ ] 截图 2：图标倒计时效果（工具栏特写，1280×800 或 640×400）
- [ ] 截图 3（可选）：实际运行中页面自动刷新/点击的场景
- [ ] 宣传小图块 440×280（可选，推荐位用）
- [ ] 打包文件：`bash scripts/package.sh` 生成的 `dist/*.zip`
