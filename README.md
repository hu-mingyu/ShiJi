# ShiJi

ShiJi 是一款用于记录和回顾日常💩情况的 PWA。可在浏览器中使用，也可添加到 iPhone 或 iPad 主屏幕，像普通 App 一样打开。

## 功能

- **快速记录：**一键添加记录，或使用计时器记录💩时长；也可补录日期和时间。
- **更多信息：**可以同时记录颜色、状态和顺畅度；添加备注或“🔥吃辣了”标签；支持修改和删除。
- **日历与统计：**按周、月、年查看记录，并查看对应周期的统计数据；可以生成分享图片。

## 在 iPhone 或 iPad 上安装

1. 在 iPhone 或 iPad 上用 **Safari** 打开 ShiJi 的网页地址（https://hu-mingyu.github.io/ShiJi/）。
2. 点击 Safari 工具栏中的分享按钮：<img src="public/icons/safari-share.svg" width="18" alt="分享图标" style="vertical-align: -4px" />。
3. 向下滚动并选择**添加到主屏幕**。
4. 确认名称后点击**添加**。
5. 回到主屏幕，点击 ShiJi 图标即可打开。

## 备份指南

**请务必定期备份记录。**记录只保存在当前设备的浏览器中，不会自动同步。清除浏览器数据、更换设备或浏览器、卸载相关应用时，记录可能无法恢复。
### 导出备份

1. 点击页面右上角**上次备份**，或左上角菜单栏的“导出/备份”。
2. 选择**更多**或页面下方**分享按钮**<img src="public/icons/safari-share.svg" width="18" alt="分享图标" style="vertical-align: -4px" />。
3. 向下滚动并选择**存储到“文件”**。
4. 选择保存位置，点击右上角“存储”完成下载 JSON 备份文件。

### 导入备份

1. 在 ShiJi 右上角菜单中选择**导入数据**。
2. 从“文件”中选择之前导出的 JSON 备份。
3. 按页面提示完成导入。

导入前请确认选对备份文件，并保留原始文件作为副本。跨设备使用时，请先在旧设备导出，再在新设备打开 ShiJi 并导入该文件。

## 本地开发

需要 Node.js 和 npm。在项目目录运行：

```bash
npm install
npm run dev
```

## 贡献

欢迎提交 Issue 或 Pull Request。提交前请运行 `npm run build`，并简要说明改动内容。

## Contributors

- **Mingyu Hu** — Creator, design, development, and testing.
- **OpenAI Codex** — AI-assisted development, implementation, debugging, and documentation.
