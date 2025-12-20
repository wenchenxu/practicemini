Tusifu 合同系统 / 车辆·司机·签署全栈项目上下文说明
1. 概览

Tusifu 是一个完整的“车辆租赁合同管理”系统，包含以下端：

微信小程序前端
微信云开发（TCB）数据库
微信云函数（Node）
ECS Node.js 后端（法大大电子签署）
管理模块：合同中心 / 司机中心 / 车辆中心 / 车辆详情 / 车辆历史

整个项目实现以下核心能力：

创建合同（含车辆绑定 + 司机自动创建/更新）
车辆状态管理（租赁、空闲、维修——三轴模型：rentStatus+maintenanceStatus）
司机档案管理（按身份证号唯一）
车辆历史（时间线）
法大大签署流程（上传 → 处理文件 → 创建签署任务 → 获取签署链接 → 下载合同）

2. 技术栈

微信小程序（WXML / WXSS / JS）
微信云开发数据库（TCB）
微信云函数（Node 16）
Node.js (Express, Axios, Crypto, Multer…）部署在阿里 ECS
Nginx 反向代理（api.tusifu.cn / api-stg.tusifu.cn）
法大大 FASC 5.1 API

3. 数据模型（TCB）
3.1 contracts（合同）

主要字段：

_id
cityCode
branchCode
createdAt
deleted
fields: {
  carPlate, carModel, carColor, carVin
  clientId, clientName, clientPhone
  clientAddress, clientAddressCurrent
  clientEmergencyContact, clientEmergencyContactPhone
  contractDate
  contractValidPeriodStart
  contractValidPeriodEnd
  contractSerialNumberFormatted
  deposit, rentMonthly, rentDurationMonth
}
file.pdfFileID
file.docxFileID（未来可扩展）


合同创建时自动更新：driver + vehicle

3.2 drivers（司机）

唯一约束：clientId（身份证号）

_id
clientId
name
phone
cityCode
cityName
addressRegistered
addressCurrent
emergencyContactName
emergencyContactPhone
status: '租车中'
lastContractId
createdAt
updatedAt

3.3 vehicles（车辆）

采用双轴模型：

rentStatus: 'available' | 'rented'
maintenanceStatus: 'none' | 'in_maintenance'
currentDriverId: string|null
plate
vin
model
color
cityCode
createdAt
updatedAt


❗ 已废弃旧字段 status，不再使用。

3.4 vehicle_history（车辆时间线）

只写不改、不删除。用于重建车辆生命周期。

_id
vehicleId
plate
eventType            // rent_start | rent_end | maintenance_toggle | status_change
fromStatus           // 文案，如 '闲置'、'已租 · 维修中'
toStatus
driverClientId
driverClientName
driverClientPhone
contractId
operator
createdAt

4. 云函数结构
4.1 contractV2（创建合同 + 司机创建/更新 + 车辆状态变化 + 历史）

执行顺序：
生成合同流水号
创建合同记录
Upsert 司机（按身份证号）
检查车辆：是否 available
更新车辆为 rented（保留 maintenanceStatus）
写入 vehicle_history（仅一条）
在事务运行 db.runTransaction 内。
状态变更逻辑（合同创建）：

旧状态：
  oldRentStatus          // available / rented
  oldMaintenanceStatus   // none / in_maintenance

新状态（创建合同）：
  rentStatus = 'rented'
  maintenanceStatus = oldMaintenanceStatus

4.2 vehicleOps（车辆操作：设为可出租、标记维修）
行为：

newStatus = "available" → 结束租赁（rent_end），解绑司机
newStatus = "maintenance" → toggle 维修轴
none → in_maintenance
in_maintenance → none

不再写字段：

status（删除）
newStatus（删除）
deriveStatus（删除）

历史写法：
fromStatus = format(oldRentStatus, oldMaintenanceStatus)
toStatus = format(newRentStatus, newMaintenanceStatus)

5. ECS 服务端（法大大）

结构：

app.post('/api/esign/getToken')
app.post('/api/esign/uploadFileByUrl')
app.post('/api/esign/convertFddUrlToFileId')
app.post('/api/esign/createTaskV51')     ← 最复杂（带附件、盖章控件、骑缝章、企业 actor、个人 actor）
app.post('/api/esign/getActorUrl')
app.post('/api/esign/getOwnerDownloadUrl')
app.post('/api/esign/corpEntityList')    ← 取企业主体


签名策略：严格按法大大 Postman Pre-request Script 重写
（时间戳、nonce、contentMap、sortParameters、sign(hash, hmac)）

业务流程：

临时文件 URL → upload-by-url → fddFileUrl
fddFileUrl → file/process → fileId （主合同+附件）
fileId + actor + sealFields → createTaskV51
signTaskId → actor/get-url → actorSignTaskEmbedUrl
owner/get-download-url → 下载合同 PDF

6. 小程序前端结构

目录（核心页面）：

pages/
  contract-new/
  contract-list/
  driver-center/
  driver-detail/
  vehicle-center/
  vehicle-detail/
  vehicle-history/

6.1 contract-new（新建合同）
车辆选择器：从可出租车辆列表加载（rentStatus = 'available'）
选车后自动填充：plate/model/color/vin
提交时调用：
wx.cloud.callFunction('contractV2', payload) 
contractV2 仍在开发调试中。之前已完成，没有涵盖车辆和司机管理的是 createContract

6.2 vehicle-center（车辆中心）

支持：

无限滚动
状态筛选（全部 / 空闲 / 已租 / 维修）
搜索（实时模糊匹配 plate/model/color/driverName）
点击进入 vehicle-detail

6.3 vehicle-detail（车辆详情）

显示：

plate
model
color
rentStatus
maintenanceStatus
driverName
lastContractId

操作按钮（根据状态动态变化）：

设为可出租（结束租赁）
标记维修 / 取消维修（toggle）
跳转：
“查看车辆历史” → vehicle-history

6.4 vehicle-history

时间线样式

每条记录展示：

createdAt
fromStatus → toStatus
driverName(optional)
contractId(optional)

7. 状态模型（必须遵守）

车辆状态不再使用 status。
唯一有效的数据模型：
rentStatus        'available' | 'rented'
maintenanceStatus 'none' | 'in_maintenance'

用于展示的“最终状态文案”：
if in_maintenance:
    已租 · 维修中  或 闲置 · 维修中
else:
    已租 或 闲置

8. 未来扩展（已预留兼容）

车辆进入维修时，允许调配替代其他闲置车辆
合同 + 司机 + 车辆 三方联动报表
租期到期提醒（云函数定时触发器）
合同模板管理（字段动态渲染）
保险，年检到期提醒（优先级低）

9. Agent / AI 工具协作提示（非常重要）

在你的编辑器里运行的 AI Agent 需要知道：
永远不要生成车辆状态字段 status（除非用于 UI 临时显示）
车辆实际状态由 rentStatus + maintenanceStatus 决定
车辆历史必须追加，不允许修改或删除
合同创建时必须走 contractV2 流程
车辆状态更改必须走 vehicleOps
ECS createTaskV51 必须完全遵守法大大 Pre-request Script 规则
所有云开发数据库操作必须显式处理 createdAt: db.serverDate()
前端所有入口必须按 cityCode 分城市加载数据

10. 如果你需要 AI 自动生成代码：关键关键词提示

在 agent 中可以这样写（非常重要）：

When generating code:

- Don't write “status” field into DB for vehicles, use rentStatus and maintenanceStatus instead
- Always append vehicle_history entries
- All contract creation must invoke contractV2
- All vehicle status updates must use vehicleOps
- File signing flow must follow createTaskV51
- Use db.serverDate() for timestamps
- Use TCB transactions for composite operations