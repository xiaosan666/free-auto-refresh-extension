# 隐私政策 / Privacy Policy

**生效日期 / Effective date：** 2026-10-19
**适用产品 / Applies to：** 定时刷新 & 自动点击（Chrome 扩展） / Auto Refresh & Auto Click (Chrome Extension)

---

## 中文版

### 一、我们收集什么

**我们不会收集、存储或上传任何数据。**

本扩展：

- 不采集任何个人信息、浏览记录、页面内容或账号信息；
- 不向任何服务器发送数据；扩展内**没有任何网络请求**；
- 不含任何第三方统计、广告或追踪代码。

### 二、数据保存在哪里

你设置的定时规则（域名、刷新周期、点击选择器与周期）以及当前倒计时状态，**只保存在你本机浏览器的 `chrome.storage.local` 中**：

- 数据不离开你的设备，开发者无法访问；
- 卸载扩展或清除浏览器数据会一并删除这些配置；
- 扩展不提供账号体系，也不存在云端同步。

### 三、我们为什么申请这些权限

| 权限 | 用途 |
| --- | --- |
| `tabs` | 读取当前标签页 URL 以判断所属域名，并在倒计时结束时刷新该标签页 |
| `scripting` | 在你主动启用的页面上，点击你配置的 CSS 选择器所匹配的元素 |
| `storage` | 在本机保存定时配置与倒计时状态，关闭浏览器后仍可恢复 |
| `alarms` | 浏览器回收后台进程后定时唤醒，保证倒计时持续准确 |
| `host_permissions: <all_urls>` | 你可能对任意网站启用本功能，目标域名无法预先声明 |

**权限仅在功能需要时使用**：未启用任何定时任务时，扩展不读取页面、不注入脚本、不执行刷新与点击。所有操作都发生在你主动配置的域名下。

### 四、数据处理与第三方共享

- 不存在数据处理行为，因此不涉及出售、共享或转让给第三方；
- 不含远程代码：所有逻辑均打包在扩展内，运行时不下载任何脚本；
- 本扩展为开源项目，代码可自行审查：<https://github.com/xiaosan666/free-auto-refresh-extension>

### 五、儿童隐私

本扩展不面向 13 岁以下儿童，也不会有意收集儿童信息。

### 六、政策变更

如未来功能调整导致数据处理方式变化，我们会先更新本文档并在仓库发布变更记录。

### 七、联系我们

如有疑问，请在项目仓库提交 Issue：<https://github.com/xiaosan666/free-auto-refresh-extension/issues>

---

## English Version

### 1. What we collect

**We do not collect, store, or transmit any data.**

This extension:

- Does **not** collect any personal information, browsing history, page content, or account data;
- Makes **no network requests at all** — nothing is ever sent to a server;
- Contains **no** analytics, advertising, or tracking code of any kind.

### 2. Where data is stored

Your timer settings (domain, refresh interval, click selector and interval) and the current countdown state are stored **only in your browser's local `chrome.storage.local`**:

- The data never leaves your device, and the developer cannot access it;
- Uninstalling the extension or clearing browser data removes all settings;
- There is no account system and no cloud sync.

### 3. Why each permission is needed

| Permission | Purpose |
| --- | --- |
| `tabs` | Read the tab URL to determine its domain, and reload the tab when the countdown reaches zero |
| `scripting` | On pages where you enabled it, click the element matching the CSS selector you configured |
| `storage` | Save timer settings and countdown state locally so they survive browser restarts |
| `alarms` | Wake the background service worker periodically so countdowns stay accurate |
| `host_permissions: <all_urls>` | You may enable the feature on any website, so target domains cannot be declared in advance |

**Permissions are used only when required:** if no timer is enabled, the extension does not read pages, inject scripts, or perform refreshes/clicks. All actions run only on domains you explicitly configure.

### 4. Data processing and third-party sharing

- There is no data processing, so nothing is sold, shared, or transferred to third parties;
- No remote code: every line of logic ships inside the package and no script is fetched at runtime;
- The project is open source and auditable: <https://github.com/xiaosan666/free-auto-refresh-extension>

### 5. Children's privacy

The extension is not directed at children under 13 and does not knowingly collect information from them.

### 6. Changes to this policy

If a future feature changes how data is handled, this document will be updated and the change will be published in the repository.

### 7. Contact

Questions are welcome via GitHub Issues: <https://github.com/xiaosan666/free-auto-refresh-extension/issues>
