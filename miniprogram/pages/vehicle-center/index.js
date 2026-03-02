// miniprogram/pages/vehicle-center/index.js
// const db = wx.cloud.database();

Page({
  data: {
    city: '',
    cityCode: '',
    cityName: '',
    list: [],            // 车辆列表
    loading: false,
    hasMore: true,
    lastCreatedAt: null,
    lastId: '',
    statusFilter: 'all',  // all / available / rented / maintenance
    searchKeyword: '',     // 搜索关键字（车牌 / 司机名 / VIN）
    counts: {
      all: 0,
      available: 0,
      rented: 0,
      maintenance: 0,
      misc: 0,
      insurance: 0, // 新增：合并后的保险预警
      annual: 0  // 新增：年审预警数
    }
  },

  _searchTimer: null,   // 搜索防抖定时器

  onLoad(options) {
    const city = options.city || '';
    const cityCode = options.cityCode || '';
    const branchCode = options.branchCode || '';
    const branchName = decodeURIComponent(options.branchName || '');

    this.setData({ city, cityCode, branchCode, branchName });
    const displayTitle = branchName ? branchName : city;
    if (displayTitle) {
      wx.setNavigationBarTitle({ title: `${displayTitle} - 车辆中心` });
    }
    // this.resetAndFetch();
  },

  onShow() {
    // 每次返回页面都刷新，不能同时和 onLoad 的 resetAndFetch 存在，否则重复
    this.resetAndFetch();
    this.checkExpirations();
  },

  // 下拉刷新
  onPullDownRefresh() {
    this.resetAndFetch().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 触底加载更多
  onReachBottom() {
    this.fetchList();
  },

  // 切换状态筛选
  onStatusFilterTap(e) {
    const status = e.currentTarget.dataset.status || 'all';
    if (status === this.data.statusFilter) return;
    this.setData({ statusFilter: status }, () => {
      this.resetAndFetch();
    });
  },

  // 搜索输入：实时搜索 + 防抖
  onSearchInput(e) {
    const keyword = e.detail.value || '';
    this.setData({ searchKeyword: keyword });

    // 防抖：用户停止输入 300ms 后再查一次
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    this._searchTimer = setTimeout(() => {
      // console.log('[vehicle-center] debounce search keyword =', this.data.searchKeyword);
      this.resetAndFetch();
    }, 300);
  },

  // 清除搜索
  onSearchClear() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.setData({ searchKeyword: '' }, () => {
      // console.log('[vehicle-center] onSearchClear');
      this.resetAndFetch();
    });
  },

  // 重置分页条件 + 重新拉第一页
  async resetAndFetch() {
    this.setData({
      list: [],
      loading: false,
      hasMore: true,
      lastCreatedAt: null,
      lastId: ''
    });
    // 并行执行，互不阻塞
    this.fetchStats();
    await this.fetchList();
  },

  // 3. 新增统计方法
  async fetchStats() {
    const { cityCode, branchCode } = this.data;
    if (!cityCode) return;

    const db = wx.cloud.database();
    const _ = db.command;

    // 构造基础查询
    const base = { cityCode };
    if (branchCode) {
      base.branchCode = branchCode;
    }
    const now = new Date();
    const warningDate = new Date();
    warningDate.setDate(now.getDate() + 60); // 60天内预警

    // 有效日期判定：大于 2000年
    const validDate = _.gt(new Date('2000-01-01'));
    // 预警判定：<= 60天
    const isUrgent = _.lte(warningDate);

    // 构造条件：(有效 且 急需)
    const warnCond = _.and([validDate, isUrgent]);

    // 并发查询5个状态的数量
    try {
      const pAll = db.collection('vehicles').where(base).count();

      const pAvailable = db.collection('vehicles').where({
        ...base,
        rentStatus: 'available',
      }).count();

      const pRented = db.collection('vehicles').where({
        ...base,
        rentStatus: 'rented'
      }).count();

      const pMaintenance = db.collection('vehicles').where({
        ...base,
        maintenanceStatus: 'in_maintenance'
      }).count();

      const pMisc = db.collection('vehicles').where({
        ...base,
        rentStatus: 'misc'
      }).count();

      // 保险预警：(交强险急需) OR (商业险急需)
      const pInsuranceWarn = db.collection('vehicles').where(_.and([
        base,
        _.or([
          { liabInsEnd: warnCond },
          { commInsEnd: warnCond }
        ])
      ])).count();

      // 年审预警
      const pAnnualWarn = db.collection('vehicles').where({
        ...base,
        annualInspectionDate: warnCond
      }).count();

      const results = await Promise.all([pAll, pAvailable, pRented, pMaintenance, pInsuranceWarn, pAnnualWarn, pMisc]);

      this.setData({
        counts: {
          all: results[0].total,
          available: results[1].total,
          rented: results[2].total,
          maintenance: results[3].total,
          insurance: results[4].total, // 合并后的保险
          annual: results[5].total,
          misc: results[6].total,
        }
      });
    } catch (e) {
      console.error('[fetchStats] error', e);
    }
  },

  // 核心：分页拉车辆列表
  async fetchList() {
    if (this.data.loading || !this.data.hasMore) return;

    const {
      cityCode,
      branchCode,
      statusFilter,
      lastCreatedAt,
      lastId,
      searchKeyword
    } = this.data;

    if (!cityCode) return;

    this.setData({ loading: true });

    const db = wx.cloud.database();
    const _ = db.command;
    const pageSize = 20;

    // 基础条件：按城市
    const baseWhere = { cityCode };
    if (branchCode) {
      baseWhere.branchCode = branchCode;
    }
    let orderByField = 'createdAt';
    let orderByType = 'desc';

    // 预警日期计算 (60天)
    const now = new Date();
    const warningDate = new Date();
    warningDate.setDate(now.getDate() + 60);
    const validDate = _.gt(new Date('2000-01-01'));
    const isUrgent = _.lte(warningDate);
    const warnCond = _.and([validDate, isUrgent]);

    // 按状态筛选
    let filterCond = baseWhere;
    let isMemorySortMode = false; // 标记是否需要前端内存排序

    if (['available', 'rented', 'misc'].includes(statusFilter)) {
      baseWhere.rentStatus = statusFilter;
    } else if (statusFilter === 'maintenance') {
      baseWhere.maintenanceStatus = 'in_maintenance';
    } else if (statusFilter === 'insurance') {
      // 交强险 OR 商业险 急需处理
      filterCond = _.and([
        baseWhere,
        _.or([
          { liabInsEnd: warnCond },
          { commInsEnd: warnCond }
        ])
      ]);
      // 数据库无法直接按 min(a,b) 排序，所以我们不依赖数据库排序
      // 而是取回一批数据，在前端排
      isMemorySortMode = true;
    } else if (statusFilter === 'annual') {
      baseWhere.annualInspectionDate = _.gt(new Date('2000-01-01'));
      orderByField = 'annualInspectionDate';
      orderByType = 'asc';
    }
    // 'all' 不加任何条件

    // 关键字（模糊搜车牌 / 司机名 / VIN）
    const kw = (searchKeyword || '').trim();

    if (kw) {
      const regex = db.RegExp({
        regexp: kw,
        options: 'i' // 不区分大小写
      });

      filterCond = _.and([
        baseWhere,
        _.or(
          { plate: regex },
          { currentDriverName: regex }, // 修改：支持搜 currentDriverName
          { driverName: regex },   // 兼容旧字段，已淘汰?
          { vin: regex }           // 顺便支持按 VIN 搜
        )
      ]);
    }

    // --- 构造查询对象 ---
    let query = db.collection('vehicles').where(filterCond);

    // 如果是内存排序模式 (保险筛选)，我们暂时忽略分页游标，一次性拉取前 100 条
    // 因为前端排序后，原来的 _id / createdAt 游标就失效了
    if (isMemorySortMode) {
      // 这是一个取舍：为了排序准确，我们牺牲了无限滚动，改为“显示最紧急的前100台”
      // 对于单城市的预警车辆，通常不会超过 100 台
      if (this.data.list.length > 0) {
        // 如果已经加载过（例如做了假分页），就直接返回
        this.setData({ loading: false, hasMore: false });
        return;
      }
      query = query.limit(100);
    } else {
      // 普通模式：使用游标分页
      if (lastId && orderByField === 'createdAt') {
        if (lastCreatedAt) {
          query = query.where(_.or([
            { createdAt: _.lt(lastCreatedAt) },
            { createdAt: lastCreatedAt, _id: _.lt(lastId) }
          ]));
        } else {
          query = query.where({ _id: _.lt(lastId) });
        }
      } else if (lastId) {
        // 非 createdAt 排序 (如年审)，使用 skip (性能折衷)
        query = query.skip(this.data.list.length);
      }
      query = query.limit(pageSize);
      query = query.orderBy(orderByField, orderByType).orderBy('_id', 'desc');
    }

    try {
      const { data } = await query.get();

      // --- 数据处理与计算过期天数 ---
      const nowTs = new Date().setHours(0, 0, 0, 0);

      const calcDays = (dateStr) => {
        if (!dateStr) return 9999;
        const d = new Date(dateStr);
        if (isNaN(d.getTime()) || d.getFullYear() < 2000) return 9999;
        const diffTime = d.getTime() - nowTs;
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      };

      const getExpiryInfo = (days, label) => {
        if (days === 9999) return null;
        if (days > 60) return null; // > 60天隐藏
        if (days < 0) return { text: `${label}逾期${Math.abs(days)}天`, type: 'expired' };
        if (days === 0) return { text: `${label}今天到期`, type: 'warning' };
        return { text: `${label}：${days}天`, type: 'warning' };
      };

      // const newList = this.data.list.concat(data || []);
      const normalized = (data || []).map(item => {
        const rentStatus = item.rentStatus ||
          (item.status === 'rented' ? 'rented' : 'available');
        const maintenanceStatus = item.maintenanceStatus ||
          (item.status === 'maintenance' ? 'in_maintenance' : 'none');

        // 旧字段
        const statusLabel = maintenanceStatus === 'in_maintenance'
          ? (rentStatus === 'rented' ? '已租 · 维修中' : '闲置 · 维修中')
          : (rentStatus === 'rented' ? '已租' : '闲置');

        // 计算预警
        const liabDays = calcDays(item.liabInsEnd);
        const commDays = calcDays(item.commInsEnd);
        const annualDays = calcDays(item.annualInspectionDate);

        const liabInfo = getExpiryInfo(liabDays, '交强险');
        const commInfo = getExpiryInfo(commDays, '商业险');
        const annualInfo = getExpiryInfo(annualDays, '年审');

        const sortKey = Math.min(liabDays, commDays);

        // 分配到 row2 和 row3 展示 (避免增加高度)
        return {
          ...item,
          rentStatus,
          maintenanceStatus,
          // statusLabel,
          driverName: item.currentDriverName || item.driverName || '',
          liabExpiry: liabInfo,   // 交强险信息
          commExpiry: commInfo,   // 商业险信息
          annualExpiry: annualInfo, // 年审信息
          _sortKey: sortKey // 临时字段用于排序
        };
      });

      // 批量补充司机姓名，避免依赖车辆文档中的旧 driverName 缓存
      // 方案一：前端排序
      if (isMemorySortMode) {
        normalized.sort((a, b) => a._sortKey - b._sortKey);
      }

      const driverIds = Array.from(new Set(
        normalized
          .map(item => item.currentDriverId)
          .filter(Boolean)
      ));

      let driverMap = {};
      if (driverIds.length > 0) {
        try {
          const { data: drivers } = await db
            .collection('drivers')
            .where({ clientId: _.in(driverIds) })
            .get();

          driverMap = (drivers || []).reduce((acc, cur) => {
            acc[cur.clientId] = {
              name: cur.name || '',
              phone: cur.phone || ''
            };
            return acc;
          }, {});
        } catch (e) { console.error('fetch drivers failed', e); }
      }

      const enriched = normalized.map(item => {
        // 优先级：
        // 1. 查表得到的最新名字 (标准ID) - 车辆表自带的 CSV 导入名字 (currentDriverName)

        const stdId = item.currentDriverId;
        const driverInfo = driverMap[stdId] || {};

        const resolvedName =
          driverInfo.name ||
          item.currentDriverName ||
          '';

        const resolvedPhone =
          driverInfo.phone ||
          item.currentDriverPhone || // 如果车辆表自带
          '';

        return {
          ...item,
          driverName: resolvedName,
          currentDriverPhone: resolvedPhone
        };
      });

      const newList = this.data.list.concat(enriched);
      // const newList = this.data.list.concat(normalized);

      // 更新游标：取本次最后一条
      let newLastCreatedAt = lastCreatedAt;
      let newLastId = lastId;

      if (data && data.length > 0) {
        const tail = data[data.length - 1];
        newLastId = tail._id || '';

        if (tail.createdAt) {
          // 只有在 tail 有 createdAt 时才更新
          newLastCreatedAt = tail.createdAt;
        }
      }

      this.setData({
        list: newList,
        lastCreatedAt: newLastCreatedAt,
        lastId: newLastId,
        hasMore: isMemorySortMode ? false : (data.length === pageSize)
      });
    } catch (e) {
      // console.error('[vehicle-center] fetchList error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 跳详情
  toDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const { city, cityCode } = this.data;
    wx.navigateTo({
      url: `/pages/vehicle-detail/index?id=${id}&city=${encodeURIComponent(city)}&cityCode=${encodeURIComponent(cityCode)}`
    });
  },

  // 🔍 检查保险/年检到期
  async checkExpirations() {
    const { curCity } = this.data; // 获取当前筛选的城市 (例如 'suzhou')
    if (!curCity) return;

    // 1. 防止骚扰：检查今天是否已经弹过窗了
    const storageKey = `last_expire_check_${curCity}`;
    const lastCheckDate = wx.getStorageSync(storageKey);
    const todayStr = new Date().toDateString(); // e.g. "Sat Dec 27 2025"

    // 如果今天已经检查并提示过，就不再弹窗（你可以注释掉这一行来强制测试）
    if (lastCheckDate === todayStr) {
      console.log('今日已提示过到期预警，跳过');
      return;
    }

    const db = wx.cloud.database();
    const _ = db.command;

    // 2. 计算时间范围
    const now = new Date();
    const thirtyDaysLater = new Date();
    thirtyDaysLater.setDate(now.getDate() + 30);

    try {
      // 3. 查询数据库
      // 逻辑：城市匹配 + (过期时间 < 30天后) + (过期时间 > 2000年 防止空数据干扰)
      // 注意：这里假设你的 liabInsEnd 存的是 Date 对象或时间戳
      // 如果存的是 "2025-05-11" 字符串，比较逻辑会略有不同，建议存 Date 对象
      let whereCond = {
        cityCode: curCity,
        // 条件：liabInsEnd 小于等于未来30天 (包含了已过期的)
        liabInsEnd: _.lte(thirtyDaysLater).and(_.gt(new Date('2000-01-01')))
      };
      if (this.data.branchCode) {
        whereCond.branchCode = this.data.branchCode;
      }

      const res = await db.collection('vehicles').where(whereCond).get();

      const expiringVehicles = res.data || [];

      if (expiringVehicles.length > 0) {
        // 4. 构造提醒文案
        const count = expiringVehicles.length;
        // 取出前两辆的车牌做展示
        const plates = expiringVehicles.slice(0, 2).map(v => v.plate).join('、');
        const moreText = count > 2 ? ` 等 ${count} 辆车` : ' ';

        const content = `当前城市有 ${count} 辆车交强险即将到期或已过期！\n\n涉及车辆：${plates}${moreText}\n\n请尽快处理，以免影响运营。`;

        // 5. 弹窗
        wx.showModal({
          title: '⚠️ 保险到期预警',
          content: content,
          confirmText: '查看详情',
          cancelText: '知道了',
          confirmColor: '#ff4d4f', // 红色警示
          success: (mRes) => {
            if (mRes.confirm) {
              // 点击查看，可以跳转到特定筛选页，或者只是关闭
              // 这里暂时只做关闭，你可以扩展成自动筛选出这些车
            }
            // 6. 记录今天已提示
            wx.setStorageSync(storageKey, todayStr);
          }
        });
      }

    } catch (err) {
      console.error('[Check Expiration Error]', err);
    }
  }
});
