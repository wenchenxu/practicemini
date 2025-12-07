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
        misc: 0
      }
    },
  
    _searchTimer: null,   // 搜索防抖定时器

    onLoad(options) {
      const city = options.city || '';
      const cityCode = options.cityCode || '';
  
      this.setData({ city, cityCode });
      // this.resetAndFetch();
    },
  
    onShow() {
      // 每次返回页面都刷新，不能同时和 onLoad 的 resetAndFetch 存在，否则重复
      this.resetAndFetch();
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
        const { cityCode } = this.data;
        if (!cityCode) return;
        
        const db = wx.cloud.database();
        const _ = db.command;
  
        // 构造基础查询
        const base = { cityCode };
  
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
  
          const [rAll, rAvail, rRent, rMaint, rMisc] = await Promise.all([
            pAll, pAvailable, pRented, pMaintenance, pMisc
          ]);
  
          this.setData({
            counts: {
              all: rAll.total,
              available: rAvail.total,
              rented: rRent.total,
              maintenance: rMaint.total,
              misc: rMisc.total
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
        statusFilter, 
        lastCreatedAt, 
        lastId,
        searchKeyword
      } = this.data;

      if (!cityCode) return;
  
      this.setData({ loading: true });
  
      const db = wx.cloud.database();
      const _  = db.command;
      const pageSize = 20;
  
      // 基础条件：按城市
      const baseWhere = { cityCode };
  
      // 按状态筛选
      // 按状态筛选（新版）
      if (statusFilter === 'available') {
        baseWhere.rentStatus = 'available';
      } 
      else if (statusFilter === 'rented') {
        baseWhere.rentStatus = 'rented';
      } 
      else if (statusFilter === 'maintenance') {
        baseWhere.maintenanceStatus = 'in_maintenance';
      }
      else if (statusFilter === 'misc') {
        baseWhere.rentStatus = 'misc';
      }
      // 'all' 不加任何条件

      // 关键字（模糊搜车牌 / 司机名 / VIN）
      const kw = (searchKeyword || '').trim();
      let filterCond = baseWhere;

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
                { driverName: regex },   // 兼容旧字段，已淘汰
                { vin: regex }           // 顺便支持按 VIN 搜
            )
        ]);
      }

      let where = filterCond;
      if (lastId) {
       // 有 lastId 的情况下，看看有没有 lastCreatedAt：
        if (lastCreatedAt) {
            // 完整游标：createdAt + _id 组合
            where = _.and([
                filterCond,
                _.or([
                    { createdAt: _.lt(lastCreatedAt) },
                    { createdAt: lastCreatedAt, _id: _.lt(lastId) }
                ])
            ]);
        } else {
            // 没有 createdAt，就只用 _id 做游标，保证不会总是查第一页
            where = _.and([
                filterCond,
                { _id: _.lt(lastId) }
            ]);
        }
      }
  
      try {
        // console.log('[vehicle-center] where =', where);
  
        const { data } = await db
          .collection('vehicles')
          .where(where)
          .orderBy('createdAt', 'desc')
          .orderBy('_id', 'desc')
          .limit(pageSize)
          .get();
  
        // const newList = this.data.list.concat(data || []);
        const normalized = (data || []).map(item => {
            const rentStatus = item.rentStatus ||
              (item.status === 'rented' ? 'rented' : 'available');
            const maintenanceStatus = item.maintenanceStatus ||
              (item.status === 'maintenance' ? 'in_maintenance' : 'none');
  
            const statusLabel = maintenanceStatus === 'in_maintenance'
              ? (rentStatus === 'rented' ? '已租 · 维修中' : '闲置 · 维修中')
              : (rentStatus === 'rented' ? '已租' : '闲置');
  
            return {
              ...item,
              rentStatus,
              maintenanceStatus,
              statusLabel
            };
          });
  
        // 批量补充司机姓名，避免依赖车辆文档中的旧 driverName 缓存
        const driverIds = Array.from(new Set(
          normalized
            .map(item => item.currentDriverClientId || item.currentDriverId)
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
              } catch(e) { console.error('fetch drivers failed', e); }
        }

        const enriched = normalized.map(item => {
          // 优先级：
          // 1. 查表得到的最新名字 (标准ID)
          // 2. 查表得到的最新名字 (CSV ID)
          // 3. 车辆表自带的 CSV 导入名字 (currentDriverName)
          // 4. 车辆表自带的废弃旧字段 (driverName)
          
          const stdId = item.currentDriverClientId;
          const csvId = item.currentDriverId;
          
          const driverInfo = driverMap[stdId] || driverMap[csvId] || {};

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
          hasMore: (data || []).length === pageSize
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
    }
  });
  