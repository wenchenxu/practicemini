# 项目长期记忆

## 飞书通知系统（已完成）
- 4 个云函数（vehicleOps / contractV2 / contractOps / dailyReport）在写 vehicle_history 后推送飞书卡片。
- 每个云函数目录有自己的 `.env`（已被 .gitignore 排除），存 `FEISHU_WEBHOOK_URL`，用 `dotenv` 读取。
- 三个业务云函数的 `notifyFeishu` 使用 Node 内置 https 模块（零额外依赖）；需本地 `npm install dotenv` 后用「上传并部署：所有文件」部署（.env 和 node_modules 一起上传）。
- 2026-09 修复：车辆数据普遍只有 `cityCode` 没有 `cityName`，推送卡片缺城市名。已加 `CITY_NAMES` 三级降级（cityName → CITY_NAMES[cityCode] → cityCode）。dailyReport 的 buildVehicleCityMap 本就有降级，计数不受影响。

## dailyReport 云函数（定时报告）
- 触发器：`dailyReport8PM`，cron `0 0 20 * * * *`（每晚 8 点北京时间），timeout 60s。
- 日报每天存库不推送；周报（周日）和月报（月末）存库 + 推飞书。报告存 `reports` 集合（需在云控制台手动创建，saveReport 已 try-catch 容错）。
- `action: 'generate'` 支持自定义区间（startDate/endDate/label/push），`push:false` 只返回不推送。
- 实时快照按 cityCode+branchCode 在 JS 分组（复用 fetchAllVehicles），有城市合计 + 分公司明细两级展示。
- 关键坑：改触发器后必须单独「上传触发器」，否则云端不生效。
- 2026-10-08 重大修复：周报/月报长期缺失的根因是 isSunday/isLastDayOfMonth 依赖 en-CA locale 文本（`weekday === 'Sun'`），云函数 Node 16 的老 ICU 中 en-CA 输出 "Sun."（带句点）导致判断恒 false。已改为纯数值计算（getUTCDay + 当月天数比较）。**教训：云函数里任何日期/星期逻辑禁止依赖 locale 文本，一律数值化。**
- `action:'test'` 支持 `force: 'weekly'|'monthly'|'all'`，可随时强制验证周报/月报完整链路（生成→存库→推飞书）。

## 环境/工具备忘
- 用户 npm 全局配置代理 `http://127.0.0.1:7890`（Clash，写在 ~/.npmrc 和系统环境变量），代理未运行时 npm 安装会失败。绕过方法：`$env:HTTP_PROXY=$null; $env:HTTPS_PROXY=$null; npm install --userconfig=无代理npmrc`。
- 用户明确不需要 tcb CLI 方案（未完成安装，已忽略）。
- ECS：Ubuntu + Node/Express + Nginx，域名 api.tusifu.cn（法大大代理），可作为飞书事件回调服务器。
- 生产云环境 `cloudbase-9gvp1n95af42e30d`，开发环境 `dev-4gzrr3qf9d8c8caa`；小程序 appid `wx69a2de4846371ca1`。
