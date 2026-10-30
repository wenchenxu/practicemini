const cloud = require('wx-server-sdk');
const https = require('https');
require('dotenv').config();

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

// ===== 城市映射 =====
const CITY_NAMES = {
  guangzhou: '广州', suzhou: '苏州', foshan: '佛山', huizhou: '惠州',
  jiaxing: '嘉兴', shaoxing: '绍兴', changzhou: '常州', nantong: '南通'
};

// 修复乱码：部分历史数据把中文以 URL 编码（%XX）形式入库（如 %E5%B9%BF%E5%B7%9E = 广州）
function safeDecodeUrl(str) {
  if (typeof str !== 'string' || !str) return str;
  if (/^[\x21-\x7E]+$/.test(str) && /%[0-9A-Fa-f]{2}/.test(str)) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
  }
  return str;
}

// ===== 事件类型 =====
const EVENT_TYPES = [
  { key: 'rent_start',         label: '新签' },
  { key: 'rent_end',           label: '退租' },
  { key: '换车退租',            label: '换车退' },
  { key: '换车起租',            label: '换车起' },
  { key: 'maintenance_start',  label: '维修起' },
  { key: 'maintenance_end',    label: '维修止' },
  { key: 'vehicle_retired',    label: '报废' },
  { key: 'offline_rent_start', label: '线下签' }
];

// ===== 飞书推送配置 =====
// Webhook 从环境变量 FEISHU_WEBHOOK_URL 读取。
// ⚠️ wx-server-sdk 无法在运行时获取“当前环境 ID”字符串，因此不靠代码判断环境，
//    而是靠「云开发控制台 → 云函数 → 配置 → 环境变量」按环境分别设置该变量：
//    生产环境填真实飞书机器人地址；dev 环境不设置（留空=自动跳过推送）。
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';
console.log('[飞书推送] ' + (FEISHU_WEBHOOK_URL ? 'webhook 已配置，将推送' : 'webhook 未配置，将跳过'));

exports.main = async (event, context) => {
  // 定时触发器
  if (event.Type === 'Timer' && event.TriggerName === 'dailyReport8PM') {
    return await runReport();
  }
  // 手动测试（可传 force: 'weekly' | 'monthly' | 'all' 强制生成对应报告，便于验证）
  if (event.action === 'test') {
    return await runReport(event.force || null);
  }
  // 手动生成自定义区间报告（补报/测试用）
  if (event.action === 'generate') {
    return await generateCustomReport(event);
  }
  return { ok: false, error: 'unknown-trigger' };
};

// ========================================
// 主入口
// ========================================
async function runReport(force = null) {
  const now = new Date(); // 触发时为 12:00 UTC = 20:00 Beijing

  // --- 北京时间日期（纯数值计算，不依赖 locale 文本）---
  // ★ 教训：云函数 Node 16 的 ICU 与本地 Node 22 不同，en-CA 的 weekday
  //   文本（如 "Sun." 带句点）和月份格式（可能为文本 "Sep"）会随 ICU 版本
  //   变化，导致 === 'Sun' 恒为 false。星期/月份判断必须用纯数值。
  const bjParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);

  const bjYearNum  = Number(bjParts.find(p => p.type === 'year').value);
  const bjMonthNum = Number(bjParts.find(p => p.type === 'month').value);
  const bjDayNum   = Number(bjParts.find(p => p.type === 'day').value);
  const bjYear  = String(bjYearNum);
  const bjMonth = String(bjMonthNum).padStart(2, '0');
  const bjDay   = String(bjDayNum).padStart(2, '0');

  // 星期几：取北京当天正午的绝对时间戳再算 UTC 星期（0 = 周日），与 locale 无关
  const weekdayNum = new Date(`${bjYear}-${bjMonth}-${bjDay}T12:00:00+08:00`).getUTCDay();

  // 是否本月最后一天：与当月总天数直接数值比较
  // Date.UTC(年, 月(1-based), 0) = 该月最后一天
  const daysInMonth = new Date(Date.UTC(bjYearNum, bjMonthNum, 0)).getUTCDate();

  let isSunday = (weekdayNum === 0);
  let isLastDayOfMonth = (bjDayNum === daysInMonth);

  // 手动测试时可用 force 强制生成周报/月报（定时触发不传 force，不受影响）
  if (force === 'weekly' || force === 'all') isSunday = true;
  if (force === 'monthly' || force === 'all') isLastDayOfMonth = true;

  const weekdayName = ['日', '一', '二', '三', '四', '五', '六'][weekdayNum];
  console.log(`[Report] Beijing date: ${bjYear}-${bjMonth}-${bjDay} (周${weekdayName}), isSunday=${isSunday}, isLastDayOfMonth=${isLastDayOfMonth}${force ? `, force=${force}` : ''}`);

  // --- 计算各报告的时间区间 ---
  const dailyStart  = new Date(now.getTime() - 24 * 60 * 60 * 1000);          // 昨晚 20:00
  const weeklyStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);     // 上周日 20:00
  const monthlyStart = new Date(`${bjYear}-${bjMonth}-01T00:00:00+08:00`);   // 本月 1 号 00:00
  const reportDate = `${bjYear}-${bjMonth}-${bjDay}`;

  // --- 拉取全部车辆（供城市映射 + 实时快照共用）---
  const vehicles = await fetchAllVehicles();

  // --- 生成并存储日报（每天，存库不推送）---
  let dailySaved = false;
  try {
    const dailyContent = await buildPeriodReport('日报', dailyStart, now, vehicles);
    dailySaved = await saveReport('daily', `车辆日报 ${bjMonth}/${bjDay}`, dailyContent, dailyStart, now, reportDate);
    console.log('[Report] Daily report saved:', dailySaved);
  } catch (e) {
    console.error('[Report] 日报生成失败:', e.message);
  }

  // --- 生成并存储 + 推送 周报（周日；独立容错，不影响月报）---
  let weeklyResult = null;
  if (isSunday) {
    try {
      const weeklyContent = await buildPeriodReport('周报', weeklyStart, now, vehicles);
      const weeklySaved = await saveReport('weekly', `车辆周报 ${bjMonth}/${bjDay}`, weeklyContent, weeklyStart, now, reportDate);
      console.log('[Report] Weekly report saved:', weeklySaved);
      const weeklyPush = await pushFeishu(`车辆周报 ${bjMonth}/${bjDay}`, weeklyContent);
      console.log('[Report] Weekly report pushed to Feishu');
      weeklyResult = { saved: weeklySaved, pushed: !!(weeklyPush && (weeklyPush.code === 0 || weeklyPush.StatusCode === 0)) };
    } catch (e) {
      console.error('[Report] 周报生成失败:', e.message);
      weeklyResult = { error: e.message };
    }
  }

  // --- 生成并存储 + 推送 月报（月末；独立容错）---
  let monthlyResult = null;
  if (isLastDayOfMonth) {
    try {
      const monthlyContent = await buildPeriodReport('月报', monthlyStart, now, vehicles);
      const monthlySaved = await saveReport('monthly', `车辆月报 ${bjMonth}`, monthlyContent, monthlyStart, now, reportDate);
      console.log('[Report] Monthly report saved:', monthlySaved);
      const monthlyPush = await pushFeishu(`车辆月报 ${bjMonth}`, monthlyContent);
      console.log('[Report] Monthly report pushed to Feishu');
      monthlyResult = { saved: monthlySaved, pushed: !!(monthlyPush && (monthlyPush.code === 0 || monthlyPush.StatusCode === 0)) };
    } catch (e) {
      console.error('[Report] 月报生成失败:', e.message);
      monthlyResult = { error: e.message };
    }
  }

  return {
    ok: true,
    reportDate,
    weekday: weekdayName,
    daily: { saved: dailySaved },
    weekly: weeklyResult,
    monthly: monthlyResult
  };
}

// ========================================
// 存储报告到数据库
// ========================================
async function saveReport(reportType, title, content, periodStart, periodEnd, reportDate) {
  try {
    await db.collection('reports').add({
      data: {
        reportType,   // 'daily' | 'weekly' | 'monthly' | 'custom'
        title,
        content,
        periodStart,
        periodEnd,
        reportDate,   // 'YYYY-MM-DD' 格式，方便按日期查询
        createdAt: db.serverDate()
      }
    });
    return true;
  } catch (e) {
    // 保存失败不阻断推送（常见原因：reports 集合尚未在云控制台创建）
    console.error('[Report] 保存报告失败（不影响推送）:', e.message);
    return false;
  }
}

// ========================================
// 手动生成自定义区间报告（action: 'generate'）
// 参数：
//   startDate  必填，'YYYY-MM-DD'，如 '2026-08-01'
//   endDate    必填，'YYYY-MM-DD'，如 '2026-08-31'
//   label      可选，报告标题前缀，默认 '月报'
//   push       可选，是否推送飞书，默认 true
// ========================================
async function generateCustomReport(event) {
  const { startDate, endDate, label = '月报', push = true } = event;

  if (!startDate || !endDate) {
    return { ok: false, error: 'startDate 和 endDate 必填，格式 YYYY-MM-DD' };
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return { ok: false, error: '日期格式错误，请用 YYYY-MM-DD（如 2026-08-01）' };
  }

  // 时间区间：startDate 00:00:00 ~ endDate 23:59:59（北京时间）
  const start = new Date(`${startDate}T00:00:00+08:00`);
  const end = new Date(`${endDate}T23:59:59+08:00`);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    return { ok: false, error: '日期无效，或 startDate 晚于 endDate' };
  }

  const vehicles = await fetchAllVehicles();
  const content = await buildPeriodReport(label, start, end, vehicles);
  const title = `车辆${label} ${startDate} ~ ${endDate}`;

  // 存入数据库（失败不阻断）
  const saved = await saveReport('custom', title, content, start, end, `${startDate}_${endDate}`);

  // 推送飞书
  let pushResult = null;
  if (push) {
    pushResult = await pushFeishu(title, content);
  }

  return {
    ok: true,
    title,
    saved,
    pushResult,
    content   // 返回报告全文，方便在控制台直接查看
  };
}

// ========================================
// 拉取全部车辆（供城市映射 + 实时快照共用）
// ========================================
async function fetchAllVehicles() {
  const col = db.collection('vehicles');
  let allVehicles = [];
  let page = 0;
  const LIMIT = 1000;

  while (true) {
    const res = await col.skip(page * LIMIT).limit(LIMIT).field({
      _id: true, cityCode: true, cityName: true, branchCode: true, branchName: true,
      plate: true, rentStatus: true, maintenanceStatus: true, retired: true
    }).get();
    if (!res.data || res.data.length === 0) break;
    allVehicles = allVehicles.concat(res.data);
    page++;
    if (res.data.length < LIMIT) break;
  }

  console.log(`[Report] Fetched ${allVehicles.length} vehicles`);
  return allVehicles;
}

// ========================================
// 纯函数：vehicleId → 城市名 映射
// ========================================
function buildVehicleCityMap(vehicles) {
  const map = {};
  for (const v of vehicles) {
    const cityName = safeDecodeUrl(v.cityName) || CITY_NAMES[v.cityCode] || v.cityCode || '未知';
    map[v._id] = cityName;
  }
  return map;
}

// ========================================
// 纯函数：实时快照，按 城市 + 分公司 分组
// 返回格式化好的文本行数组
// ========================================
function buildSnapshotText(vehicles) {
  // --- 按 cityCode + branchCode 分组统计 ---
  const groups = {};
  const cityTotals = {};

  for (const v of vehicles) {
    if (v.retired) continue; // 排除已售/报废

    const cityKey = v.cityCode || '';
    const branchKey = v.branchCode || '';
    const key = `${cityKey}|${branchKey}`;

    if (!groups[key]) {
      groups[key] = {
        cityCode: cityKey,
        branchCode: branchKey,
        branchName: '',
        total: 0, rented: 0, available: 0, maintenance: 0
      };
    }
    const g = groups[key];
    g.total++;
    if (v.rentStatus === 'rented') g.rented++;
    else if (v.rentStatus === 'available') g.available++;
    if (v.maintenanceStatus === 'in_maintenance') g.maintenance++;
    if (!g.branchName && v.branchName) g.branchName = v.branchName;

    // 城市合计
    if (!cityTotals[cityKey]) {
      cityTotals[cityKey] = { total: 0, rented: 0, available: 0, maintenance: 0 };
    }
    const t = cityTotals[cityKey];
    t.total++;
    if (v.rentStatus === 'rented') t.rented++;
    else if (v.rentStatus === 'available') t.available++;
    if (v.maintenanceStatus === 'in_maintenance') t.maintenance++;
  }

  // --- 按城市名 → 分公司 排序输出 ---
  const cityOrder = Object.keys(cityTotals).sort((a, b) => {
    const nameA = CITY_NAMES[a] || a || '未知';
    const nameB = CITY_NAMES[b] || b || '未知';
    return nameA.localeCompare(nameB, 'zh');
  });

  const lines = [];
  for (const cityKey of cityOrder) {
    const cityName = CITY_NAMES[cityKey] || cityKey || '未知';

    // 该城市下的所有分组
    const cityGroups = Object.values(groups)
      .filter(g => g.cityCode === cityKey)
      .sort((a, b) => (a.branchCode || '').localeCompare(b.branchCode || ''));

    if (cityGroups.length === 1 && !cityGroups[0].branchCode) {
      // 无分公司：直接输出城市一行
      const g = cityGroups[0];
      lines.push(`${cityName}：总${g.total} 已租${g.rented} 闲置${g.available} 维修${g.maintenance}`);
    } else {
      // 有分公司：先输出城市合计，再逐个分公司
      const t = cityTotals[cityKey];
      lines.push(`${cityName}：总${t.total} 已租${t.rented} 闲置${t.available} 维修${t.maintenance}`);
      for (const g of cityGroups) {
        const branchLabel = g.branchName || g.branchCode;
        lines.push(`  ${cityName}·${branchLabel}：总${g.total} 已租${g.rented} 闲置${g.available} 维修${g.maintenance}`);
      }
    }
  }

  return lines;
}

// ========================================
// 构建单个周期报告
// ========================================
async function buildPeriodReport(label, startTime, endTime, vehicles) {
  // --- 城市映射（用于事件计数）---
  const vehicleCityMap = buildVehicleCityMap(vehicles);

  // --- 查询区间内所有 vehicle_history ---
  let allHistory = [];
  let page = 0;
  const LIMIT = 1000;

  while (true) {
    const res = await db.collection('vehicle_history')
      .where({ createdAt: _.gte(startTime).and(_.lt(endTime)) })
      .skip(page * LIMIT)
      .limit(LIMIT)
      .orderBy('createdAt', 'desc')
      .get();
    if (!res.data || res.data.length === 0) break;
    allHistory = allHistory.concat(res.data);
    page++;
    if (res.data.length < LIMIT) break;
  }

  console.log(`[Report] ${label}: fetched ${allHistory.length} history records`);

  // --- 按城市 + 事件类型计数 ---
  const eventCounts = {};
  for (const record of allHistory) {
    const cityName = vehicleCityMap[record.vehicleId] || '未知';
    if (!eventCounts[cityName]) eventCounts[cityName] = {};

    const evtDef = EVENT_TYPES.find(e => e.key === record.eventType);
    const evtLabel = evtDef ? evtDef.label : record.eventType;
    eventCounts[cityName][evtLabel] = (eventCounts[cityName][evtLabel] || 0) + 1;
  }

  // --- 实时车辆状态快照（按城市/分公司分组，复用已拉取的车辆数据）---
  const snapshotLines = buildSnapshotText(vehicles);

  // --- 格式化报告 ---
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  const startStr = fmt.format(startTime);
  const endStr   = fmt.format(endTime);

  let report = `📊 车辆${label}\n`;
  report += `区间：${startStr} ~ ${endStr}\n`;

  // ━━━ 事件汇总 ━━━
  report += `\n【事件汇总】\n`;
  const citiesWithEvents = Object.keys(eventCounts).sort();

  if (citiesWithEvents.length === 0) {
    report += `本周期无车辆状态变更\n`;
  } else {
    for (const city of citiesWithEvents) {
      const parts = [];
      for (const evt of EVENT_TYPES) {
        const count = eventCounts[city][evt.label];
        if (count) parts.push(`${evt.label}${count}`);
      }
      if (parts.length > 0) {
        report += `${city}：${parts.join(' ')}\n`;
      }
    }
  }

  // ━━━ 实时车辆状态 ━━━
  report += `\n【实时车辆状态】\n`;
  if (snapshotLines.length === 0) {
    report += `无车辆数据\n`;
  } else {
    for (const line of snapshotLines) {
      report += line + `\n`;
    }
  }

  return report.trim();
}

// ========================================
// 飞书推送报告
// ========================================
async function pushFeishu(title, content) {
  if (!FEISHU_WEBHOOK_URL) {
    console.warn('[飞书推送] 未配置 FEISHU_WEBHOOK_URL，跳过推送');
    console.log('[飞书推送] 报告内容：\n' + content);
    return { ok: false, reason: 'not-configured' };
  }

  try {
    const _url = new URL(FEISHU_WEBHOOK_URL);
    const body = JSON.stringify({
      msg_type: 'interactive',
      card: {
        header: {
          title: { tag: 'plain_text', content: title },
          template: 'blue'
        },
        elements: [{
          tag: 'div',
          text: { tag: 'lark_md', content: content }
        }]
      }
    });

    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: _url.hostname,
        path: _url.pathname + _url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ raw: data }); }
        });
      });
      req.on('error', (e) => {
        console.error('[飞书推送] 请求失败:', e.message);
        resolve({ ok: false, error: e.message });
      });
      req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
      req.write(body);
      req.end();
    });

    console.log('[飞书推送] 响应:', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('[飞书推送] 异常:', e.message);
    return { ok: false, error: e.message };
  }
}
