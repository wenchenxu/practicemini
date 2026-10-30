# 项目长期记忆

## 合同到期提醒系统（2026-10 完成）
- 合同中心 Tab 改为合同状态轴：生效中 / 到期提醒 / 已结束 / 全部；签署状态改列表项角标（三色：已签绿/未发起灰/待签红/逾期异常橙），不再做独立 Tab。
- "到期提醒"= 到期日 ≤30 天 + 已过期未终结；服务端查询（修复客户端过滤分页陷阱）；按到期日升序 → 已过期自动置顶；倒计时标签 `已过期X天`/`今天到期`/`剩X天`。
- **核心不变式（2026-10-15 确立）：一车一当前合同**——每车牌 createdAt 最新非软删合同=当前合同，其余一律终态。判断用 createdAt（非起始日期，表单字段可编辑不可信）。
- contractStatus 状态机 v2：无/active(生效中) → expired(AutoReturn 00:05 自动回库标记) → terminated(真实退租/确认收车) / renewed(同司机新合同替代) / superseded(换司机替代或起草重做，文案"已替代/已作废")。
- 不变式三重保障：①contractV2 创建后终结同车牌旧合同；②AutoReturn 扫 rented 车时自愈终结旧合同；③vehicleOps `rebuildContractStatus`（手动云端测试调用，dryRun 预览，幂等）存量清洗。
- **AutoReturn 选合同以 contractStatus 轴为准**（原 esign.signTaskStatus 挑选是"脏字段做决策"反模式）；与签署同步定时器（07:30）零耦合。
- 签署状态同步：api-fadada `syncPendingSignTasks`（Timer 07:30 全量 + 前端入口静默同步 30min 节流 lastContractSignSyncTs），只同步当前合同，终态=task_finished/task_terminated/revoked/expired/abolishing。
- 到期窗口天数在 contractOps getConfig（EXPIRING_WINDOW_DAYS 常量），前端兜底 30，改云函数即可调，无需小程序发版。
- 按钮样式：`.tab` 上下 padding 18rpx（字体 24rpx 不变）。

## 飞书通知系统（已完成）
- 4 个云函数（vehicleOps / contractV2 / contractOps / dailyReport）在写 vehicle_history 后推送飞书卡片。
- 飞书 webhook 现改为**控制台环境变量**按环境配置（不再放 .env）：生产环境 4 个函数各设 `FEISHU_WEBHOOK_URL=<真实地址>`；dev 环境不设（空=跳过推送）。`.env` 里不留 webhook 行。其余 .env 里的密钥仍用 `dotenv` 读取。
- 三个业务云函数的 `notifyFeishu` 使用 Node 内置 https 模块（零额外依赖）；需本地 `npm install dotenv` 后用「上传并部署：所有文件」部署（.env 和 node_modules 一起上传）。
- **重大教训（2026-10-14）**：微信云函数运行时**无法获取"当前环境 ID"字符串**——`TENCENTCLOUD_NAMESPACE` 不在官方环境变量表，`DYNAMIC_CURRENT_ENV` 是 Symbol 非字符串，`getWXContext()` 只返回 OPENID/APPID/UNIONID。因此**禁止用代码判断环境来选配置**；按环境区分配置只能靠①控制台环境变量（推荐，天然按环境隔离，重传代码不清除）或②部署时换 .env。曾误用 `process.env.TENCENTCLOUD_NAMESPACE === prodEnvId` 做判断，导致 IS_PROD 恒 false、生产飞书静默约 6 天（reports 照常写库但飞书收不到）。修复：4 个函数改回单 key `process.env.FEISHU_WEBHOOK_URL`，值由控制台按环境注入。
- 2026-09 修复：车辆数据普遍只有 `cityCode` 没有 `cityName`，推送卡片缺城市名。已加 `CITY_NAMES` 三级降级（cityName → CITY_NAMES[cityCode] → cityCode）。dailyReport 的 buildVehicleCityMap 本就有降级，计数不受影响。

## dailyReport 云函数（定时报告）
- 触发器：`dailyReport8PM`，cron `0 0 20 * * * *`（每晚 8 点北京时间），timeout 60s。
- 日报每天存库不推送；周报（周日）和月报（月末）存库 + 推飞书。报告存 `reports` 集合（需在云控制台手动创建，saveReport 已 try-catch 容错）。
- `action: 'generate'` 支持自定义区间（startDate/endDate/label/push），`push:false` 只返回不推送。
- 实时快照按 cityCode+branchCode 在 JS 分组（复用 fetchAllVehicles），有城市合计 + 分公司明细两级展示。
- 关键坑：改触发器后必须单独「上传触发器」，否则云端不生效。
- 2026-10-08 重大修复：周报/月报长期缺失的根因是 isSunday/isLastDayOfMonth 依赖 en-CA locale 文本（`weekday === 'Sun'`），云函数 Node 16 的老 ICU 中 en-CA 输出 "Sun."（带句点）导致判断恒 false。已改为纯数值计算（getUTCDay + 当月天数比较）。**教训：云函数里任何日期/星期逻辑禁止依赖 locale 文本，一律数值化。**
- `action:'test'` 支持 `force: 'weekly'|'monthly'|'all'`，可随时强制验证周报/月报完整链路（生成→存库→推飞书）。
- 2026-10-30 新增 vehicleOps 后门 action `listNoBranch`（查某城市无 branchCode 的车辆，用于排查快照「城市·」行）。另：`exportCsv` 后端支持仅传 cityCode 导出全城车辆（前端 UI 才强制选分公司）。
- 2026-10-30 新增 vehicleOps 后门 action `deleteJunkVehicles`（两阶段安全删车：dryRun 预检→护栏校验→可选删历史/软删合同）和 `fixEncodedCityNames`（修复 URL 编码乱码存量数据，dryRun 默认 true）。
- 2026-10-30 乱码根因：合同 cityName 被编码入库后，经「contract-detail 续约 → encodeURIComponent → 页面解码一次」链路自我传播。已三层防御修复：contractV2 入口解码 + notifyFeishu 显示解码（4 个云函数均有 safeDecodeUrl）+ dailyReport 兜底。**教训：前端跳转编码 + 页面解码 + 库中被污染值二次编码 = 乱码传播循环，云函数入口必须做解码防御。**

## 环境/工具备忘
- 用户 npm 全局配置代理 `http://127.0.0.1:7890`（Clash，写在 ~/.npmrc 和系统环境变量），代理未运行时 npm 安装会失败。绕过方法：`$env:HTTP_PROXY=$null; $env:HTTPS_PROXY=$null; npm install --userconfig=无代理npmrc`。
- 用户明确不需要 tcb CLI 方案（未完成安装，已忽略）。
- ECS：Ubuntu + Node/Express + Nginx，域名 api.tusifu.cn（法大大代理），可作为飞书事件回调服务器。
- 生产云环境 `cloudbase-9gvp1n95af42e30d`，开发环境 `dev-d0gkbgouhfab4a5c2`（旧的 `dev-4gzrr3qf9d8c8caa` 已停用销毁、数据不可恢复）；小程序 appid `wx69a2de4846371ca1`。
- 2026-10 新 dev 环境重建清单：手动建 7 个集合（vehicles/drivers/contracts/vehicle_history/reports/whitelist/whitelist_setting）；其中 vehicles/drivers/contracts/vehicle_history 权限设"所有用户可读"（前端直读）；部署 9 个云函数（所有文件）；whitelist 手动加自己的 admin openid（先 callFunction auth-service action:getOpenid 拿 openid）；从生产导出测试数据导入；dev 环境不上传定时触发器（避免和 prod 重复推飞书/自动还车）。
