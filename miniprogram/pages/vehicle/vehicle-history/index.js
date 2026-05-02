// pages/vehicle-history/index.js
Page({
    data: {
      plate: '',
      vehicleId: '',
      list: [],
      loading: true
    },
  
    onLoad(options) {
      const { vehicleId, plate } = options;
      this.setData({ vehicleId, plate });
      this.loadHistory();
    },
  
    async loadHistory() {
      const db = wx.cloud.database();
      const _ = db.command;
  
      this.setData({ loading: true });
  
      const { data } = await db
        .collection('vehicle_history')
        .where({ vehicleId: this.data.vehicleId })
        .orderBy('createdAt', 'desc')
        .get();
  
      // 一次性查出所有司机姓名，避免逐条请求
      const historyList = data || [];
      const driverIds = Array.from(new Set(
        historyList
          .map(item => item.driverClientId)
          .filter(Boolean)
      ));

      let driverMap = {};
      if (driverIds.length > 0) {
        const { data: drivers } = await db
          .collection('drivers')
          .where({ clientId: _.in(driverIds) })
          .get();

        driverMap = (drivers || []).reduce((acc, cur) => {
          acc[cur.clientId] = cur.name || '';
          return acc;
        }, {});
      }

      // 补充格式化时间 + 司机名（无司机时展示 no driver）
      const result = historyList.map(item => {
        const createdAtFormatted = item.createdAt
          ? new Date(item.createdAt).toLocaleString()
          : '';

        const driverName = item.driverClientId
          ? (driverMap[item.driverClientId] || '')
          : '';

        return {
          ...item,
          createdAtFormatted,
          driverName: driverName || '无'
        };
      });
  
      this.setData({
        list: result,
        loading: false
      });
    }
  });
  