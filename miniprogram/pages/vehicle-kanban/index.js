import { CITY_CODE_MAP, BRANCH_OPTIONS_BY_CITY } from '../../utils/config';

Page({
    data: {
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
                const rawList = res.result.list;

                const displayList = [];

                // 遍历配置中的每个城市
                Object.keys(CITY_CODE_MAP).forEach(cityCode => {
                    const cityName = CITY_CODE_MAP[cityCode];
                    const branches = BRANCH_OPTIONS_BY_CITY[cityCode] || [];

                    if (branches.length > 0) {
                        // 有分公司：为每个分公司生成一个卡片
                        branches.forEach(branch => {
                            const found = rawList.find(r => r.cityCode === cityCode && r.branchCode === branch.code);
                            displayList.push({
                                cityCode: cityCode,
                                branchCode: branch.code,
                                displayName: branch.name,
                                total: found ? found.total : 0,
                                rented: found ? found.rented : 0,
                                available: found ? found.available : 0,
                                maintenance: found ? found.maintenance : 0,
                                utilization: found ? found.utilization : '0.0',
                                utilizationRate: found ? found.utilizationRate : 0
                            });
                        });
                    } else {
                        // 无分公司：按城市生成卡片
                        // 累加该城市所有数据（防止之前脏数据有 branchCode 导致漏统计）
                        let total = 0, rented = 0, available = 0, maintenance = 0;
                        rawList.filter(r => r.cityCode === cityCode).forEach(found => {
                            total += found.total;
                            rented += found.rented;
                            available += found.available;
                            maintenance += found.maintenance;
                        });

                        let utilizationRate = total > 0 ? (rented / total) * 100 : 0;

                        displayList.push({
                            cityCode: cityCode,
                            branchCode: '',
                            displayName: cityName,
                            total,
                            rented,
                            available,
                            maintenance,
                            utilization: utilizationRate.toFixed(1),
                            utilizationRate
                        });
                    }
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
        const { citycode, branchcode, name } = e.currentTarget.dataset;
        // Navigation expects: cityCode, city/branchName, branchCode
        let url = `/pages/vehicle-center/index?cityCode=${citycode}&city=${encodeURIComponent(name)}`;
        if (branchcode) {
            url += `&branchCode=${branchcode}&branchName=${encodeURIComponent(name)}`;
        }
        wx.navigateTo({ url });
    }
});