WeChat Mini Program – Contracts (Internal Branch Managers)
Overview

内部小程序，用户是各城市店长。主页 8 个城市按钮（广州、佛山、惠州、嘉兴、绍兴、南通、常州、苏州）。

进入城市页：两个入口

新建合同（create）

合同历史（list）

使用微信云开发（数据库 + 云函数 + 云存储）。前端基础 JS + WXML/WXSS。

Tech / Folders
miniprogram/
  pages/
    index/               入口
    city/                城市页（去新建/历史）
    contract-new/        新建/编辑/查看合同
    contract-list/       合同历史列表
  components/            （如有）
cloudfunctions/
  createContract/        新建：流水号、入库、渲染DOCX、上传
  contractOps/           通用操作：update（编辑保存）、render（重渲染覆盖）

Data Model (Firestore-like, 微信云数据库)

contracts（主集合）

_id

cityCode（如 guangzhou, foshan …）

cityName（中文）

branchCode（如广州分公司 gzh_a / gzh_b；其他城市默认不填）

branchName

contractType（如 rent_std, rent_zeroDown）

contractTypeName

fields（表单字段对象，见下）

file.docxFileID（云存储文件 id）

deleted: bool（软删除）

createdAt / updatedAt

serials

文档 id：SERIAL#<scope>#<YYYYMMDD>

seq: number（当天流水）

重要字段（节选）：

客户：clientName, clientId, clientPhone, clientAddress, clientEmergencyContact, clientEmergencyPhone

车辆：carModel, carColor, carPlate, carVin, carRentalCity

期限：contractValidPeriodStart, contractValidPeriodEnd, rentDurationMonth

金额（数值）：rentMonthly, rentToday, rentPaybyDayInMonth, deposit, depositInitial, depositServiceFee

金额（大写）由服务端生成：rentMonthlyFormal, rentTodayFormal, depositFormal, depositServiceFeeFormal

新增计算：depositRemaining = rentMonthly - depositInitial 及 depositRemainingFormal

流水：contractSerialNumber（数值），contractSerialNumberFormatted（字符串）

Serial Number

规则：TSFZX-<AA>-<YYYYMMDD>-<seq3>

AA 由城市/分公司映射（如 FS、GZ、…）

日期取业务时区（Asia/Shanghai）当天：避免凌晨跨 UTC 的错日

每日递增，事务确保原子性

Templates (DOCX)

存储于云存储（按分公司/城市/类型降级命中）：

contractTemplates/branches/<branchCode>/<contractType>.docx

contractTemplates/cities/<cityCode>/<contractType>.docx

contractTemplates/types/<contractType>.docx

contractTemplates/defaults/default.docx

使用 docxtemplater，定界符 [[ ... ]]，例如 [[clientName]]。

渲染后上传到：contracts/<cityCode>/<branchCode||default>/<contractType||default>/<Serial>.docx
（覆盖同路径，即使 fileID 可能相同，下载到的内容是最新的）

Cloud Functions
createContract

入参：cityCode, cityName, branchCode, branchName, contractType, contractTypeName, payload(fields)

步骤：

业务时区时间 → YYYYMMDD

事务：serials 取/增 seq，写入 contracts 文档（含格式化流水号）

服务器生成金额大写与 depositRemaining 等衍生字段

模板命中（一次下载命中策略），渲染 docx，上传到固定路径

回写 file.docxFileID，返回 _id 与 fileID

contractOps

update(id, fields)：

服务器端白名单复算金额大写 / depositRemaining

contracts.doc(id).update({fields, updatedAt})

render(id)：

读取文档 → 选模板 → 渲染 → 覆盖上传 → 更新（或保留）file.docxFileID

Frontend – contract-new

模式：create | edit | view

选择器

分公司：仅广州显示（gzh_a/gzh_b），编辑/查看不允许修改（只读展示）

合同类型：城市多类型时显示；编辑/查看不允许修改（只读展示）

表单渲染：基于 FIELDS schema → 计算 visibleFields，WXML 使用
value="{{form[item.name]}}"，事件 onInput/onInputNumber/onDateChange 写入 form.xxx

提交

create：调用 createContract → 成功后可自动预览 DOCX

edit：合并动作（推荐）：update → render → openDocument → navigateBack

导航：现在编辑页点击“保存并生成”后会自动 navigateBack 返回列表

Frontend – contract-list

条件：{ cityCode, deleted != true }

排序：createdAt desc, _id desc（双键游标分页）

列表项：clientName - carPlate、副标题：contractSerialNumberFormatted | contractDate、branchName | contractTypeName

操作：编辑（跳转带上 id/mode=edit/cityCode/city）、删除（云函数软删）

Soft Delete

仅设置 deleted: true, deletedAt, deletedBy?，查询一律过滤 deleted != true

Validation

仅对 visibleFields 做必填与长度校验；隐藏的门店字段不要前端必填

carVin 长度为 14（已修正）

Timezone

一律使用 Asia/Shanghai 计算“今天”（流水日期、contractDate 缺省展示等）

可按城市映射扩展，但默认上面这个

Known UX Rules

编辑页：合同类型/分公司不可再选（只读显示）

“保存并生成” 单按钮：

edit：update → render → open → back

create：createContract → open（可选 back）

新建页不再弹“未找到门店资料”，autofillBranch 静默执行或按广州+已选分公司才触发

Indexing (建议)

contracts: 复合索引

[cityCode, deleted, createdAt DESC, _id DESC]

如要按类型筛选：[cityCode, contractType, deleted, createdAt DESC, _id DESC]

Error Handling

渲染失败：返回“已保存但文档未生成”，保留列表的“重新生成”能力

模板错：docxtemplater 报错时记录 [tpl] miss/use / render error 日志

超时：云函数超时设为 ≥15s，内存 ≥512MB

Future hooks

车牌联想：在广州按分公司读取车辆集合，carPlate 输入时下拉提示（未实现，占位）

权限与隔离：当前不隔离（所有店长可见所有城市），后续加