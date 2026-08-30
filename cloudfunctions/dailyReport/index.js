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
const FEISHU_WEBHOOK_URL = process.env.FEISHU_WEBHOOK_URL || '';

exports.main = async (event, context) => {
  // 定时触发器
  if (event.Type === 'Timer' && event.TriggerName === 'dailyReport8PM') {
    return await runReport();
  }
  // 手动测试
  if (event.action === 'test') {
    return await runReport();
  }
  return { ok: false, error: 'unknown-trigger' };
};

// ========================================
// 主入口
// ========================================
async function runReport() {
  const now = new Date(); // 触发时为 12:00 UTC = 20:00 Beijing

  // --- 北京时间日期 ---
  const bjParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(now);

  const bjYear  = bjParts.find(p => p.type === 'year').value;
  const bjMonth = bjParts.find(p => p.type === 'month').value;
  const bjDay   = bjParts.find(p => p.type === 'day').value;
  const bjWeekday = bjParts.find(p => p.type === 'weekday').value;

  const isSunday = (bjWeekday === 'Sun');

  // 判断今天是否是本月最后一天
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', month: '2-digit'
  }).formatToParts(tomorrow);
  const isLastDayOfMonth = tomorrowParts.find(p => p.type === 'month').value !== bjMonth;

  console.log(`[Report] Beijing date: ${bjYear}-${bjMonth}-${bjDay} (${bjWeekday}), isSunday=${isSunday}, isLastDayOfMonth=${isLastDayOfMonth}`);

  // --- 计算各报告的时间区间 ---
  const dailyStart  = new Date(now.getTime() - 24 * 60 * 60 * 1000);          // 昨晚 20:00
  const weeklyStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);     // 上周日 20:00
  const monthlyStart = new Date(`${bjYear}-${bjMonth}-01T00:00:00+08:00`);   // 本月 1 号 00:00
  const reportDate = `${bjYear}-${bjMonth}-${bjDay}`;

  // --- 构建 vehicleId → cityName 映射 ---
  const vehicleCityMap = await buildVehicleCityMap();

  // --- 生成并存储日报（每天，存库不推送）---
  const dailyContent = await buildPeriodReport('日报', dailyStart, now, vehicleCityMap);
  await saveReport('daily', `车辆日报 ${bjMonth}/${bjDay}`, dailyContent, dailyStart, now, reportDate);
  console.log('[Report] Daily report saved');

  // --- 生成并存储 + 推送 周报（周日）---
  let weeklyContent = null;
  if (isSunday) {
    weeklyContent = await buildPeriodReport('周报', weeklyStart, now, vehicleCityMap);
    await saveReport('weekly', `车辆周报 ${bjMonth}/${bjDay}`, weeklyContent, weeklyStart, now, reportDate);
    console.log('[Report] Weekly report saved');
    await pushFeishu(`车辆周报 ${bjMonth}/${bjDay}`, weeklyContent);
    console.log('[Report] Weekly report pushed to Feishu');
  }

  // --- 生成并存储 + 推送 月报（月末）---
  let monthlyContent = null;
  if (isLastDayOfMonth) {
    monthlyContent = await buildPeriodReport('月报', monthlyStart, now, vehicleCityMap);
    await saveReport('monthly', `车辆月报 ${bjMonth}`, monthlyContent, monthlyStart, now, reportDate);
    console.log('[Report] Monthly report saved');
    await pushFeishu(`车辆月报 ${bjMonth}`, monthlyContent);
    console.log('[Report] Monthly report pushed to Feishu');
  }

  return {
    ok: true,
    reportDate,
    daily: { saved: true },
    weekly: isSunday ? { saved: true, pushed: true } : null,
    monthly: isLastDayOfMonth ? { saved: true, pushed: true } : null
  };
}

// ========================================
// 存储报告到数据库
// ========================================
async function saveReport(reportType, title, content, periodStart, periodEnd, reportDate) {
  await db.collection('reports').add({
    data: {
      reportType,   // 'daily' | 'weekly' | 'monthly'
      title,
      content,
      periodStart,
      periodEnd,
      reportDate,   // 'YYYY-MM-DD' 格式，方便按日期查询
      createdAt: db.serverDate()
    }
  });
}

// ========================================
// 构建 vehicleId → cityName 映射
// ========================================
async function buildVehicleCityMap() {
  const col = db.collection('vehicles');
  let allVehicles = [];
  let page = 0;
  const LIMIT = 1000;

  while (true) {
    const res = await col.skip(page * LIMIT).limit(LIMIT).field({
      _id: true, cityCode: true, cityName: true, plate: true
    }).get();
    if (!res.data || res.data.length === 0) break;
    allVehicles = allVehicles.concat(res.data);
    page++;
    if (res.data.length < LIMIT) break;
  }

  const map = {};
  for (const v of allVehicles) {
    const cityName = v.cityName || CITY_NAMES[v.cityCode] || v.cityCode || '未知';
    map[v._id] = cityName;
  }
  console.log(`[Report] Vehicle city map built: ${Object.keys(map).length} vehicles`);
  return map;
}

// ========================================
// 构建单个周期报告
// ========================================
async function buildPeriodReport(label, startTime, endTime, vehicleCityMap) {
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

  // --- 查询实时车辆状态快照 ---
  const snapshotRes = await db.collection('vehicles').aggregate()
    .match({ retired: _.neq(true) })
    .group({
      _id: '$cityName',
      total:       $.sum(1),
      rented:      $.sum($.cond({ if: $.eq(['$rentStatus', 'rented']),        then: 1, else: 0 })),
      available:   $.sum($.cond({ if: $.eq(['$rentStatus', 'available']),     then: 1, else: 0 })),
      maintenance: $.sum($.cond({ if: $.eq(['$maintenanceStatus', 'in_maintenance']), then: 1, else: 0 }))
    })
    .end();

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
  if (!snapshotRes.list || snapshotRes.list.length === 0) {
    report += `无车辆数据\n`;
  } else {
    const sorted = snapshotRes.list.sort((a, b) =>
      (a._id || '').localeCompare(b._id || '')
    );
    for (const item of sorted) {
      const cityName = item._id || '未知';
      report += `${cityName}：总${item.total} 已租${item.rented} 闲置${item.available} 维修${item.maintenance}\n`;
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
