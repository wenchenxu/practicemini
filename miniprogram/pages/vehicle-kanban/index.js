Page({
    data: {
        // 定义城市映射 (你可以从全局配置 config.js 引入)
        cityMap: {
            'guangzhou': '广州',
            'foshan': '佛山',
            'huizhou': '惠州',
            'jiaxing': '嘉兴',
            'shaoxing': '绍兴',
            'nantong': '南通',
            'changzhou': '常州',
            'suzhou': '苏州'
        },
        list: [],

        grand: {
            total: 0,
            rented: 0,
            available: 0,
            utilization: '0.0',
            utilizationRate: 0
        },

        loading: true
    },

    onLoad() {
        this.fetchAllStats();
    },

    onPullDownRefresh() {
        this.fetchAllStats().then(() => {
            wx.stopPullDownRefresh();
        });
    },

    async fetchAllStats() {
        try {
            const res = await wx.cloud.callFunction({
                name: 'vehicleOps',
                data: { action: 'getAllCitiesStats' }
            });

            if (res.result.ok) {
                // 将云端数据与本地城市名合并
                const rawList = res.result.list;

                // 确保我们定义的 cityMap 里的城市都能显示（即使云端没数据也要显示0）
                const displayList = Object.keys(this.data.cityMap).map(code => {
                    const found = rawList.find(r => r.cityCode === code);
                    return {
                        cityCode: code,
                        cityName: this.data.cityMap[code],
                        // 如果库里没这个城市的数据，给默认值
                        total: found ? found.total : 0,
                        rented: found ? found.rented : 0,
                        available: found ? found.available : 0,
                        maintenance: found ? found.maintenance : 0,
                        utilization: found ? found.utilization : '0.0',
                        utilizationRate: found ? found.utilizationRate : 0
                    };
                });

                // 2. 新增：计算全国总和
                let gTotal = 0;
                let gRented = 0;
                let gAvailable = 0;

                displayList.forEach(item => {
                    gTotal += item.total;
                    gRented += item.rented;
                    gAvailable += item.available;
                });

                // 计算全国出租率
                let gRate = 0;
                if (gTotal > 0) {
                    gRate = (gRented / gTotal) * 100;
                }

                this.setData({
                    list: displayList,
                    grand: {
                        total: gTotal,
                        rented: gRented,
                        available: gAvailable,
                        utilization: gRate.toFixed(1),
                        utilizationRate: gRate
                    },
                    loading: false
                });
            }
        } catch (e) {
            console.error(e);
            this.setData({ loading: false });
        }
    },

    // 跳转详情
    toCityDetail(e) {
        const code = e.currentTarget.dataset.code;
        wx.navigateTo({
            url: `/pages/vehicles/index?cityCode=${code}`
        });
    }
});