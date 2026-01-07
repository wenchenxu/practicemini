// 城市名
export const CITY_CODE_MAP = {
    guangzhou: '广州',
    foshan: '佛山',
    huizhou: '惠州',
    jiaxing: '嘉兴',
    shaoxing: '绍兴',
    nantong: '南通',
    changzhou: '常州',
    suzhou: '苏州',
  };
  
  // 仅广州有两个分公司
  export const BRANCH_OPTIONS_BY_CITY = {
    guangzhou: [
      { code: 'gzh_a', name: '广州兔斯夫' },
      { code: 'gzh_b', name: '广州益行' },
    ],
    // 其他城市不配置 = 不显示分公司选择
  };
  
  // 合同类型：广州两种，其它城市默认 rent_std
  export const TYPE_OPTIONS_BY_CITY = {
    guangzhou: [
        { code: 'rent_std',  name: '纯租租赁' },
        { code: 'rent_zeroDown', name: '零押金租赁' },
    ],
    foshan: [
        { code: 'rent_std',  name: '纯租租赁' },
        { code: 'rent_zeroDown', name: '零押金租赁' },
    ],
    // ▼▼▼ 新增：惠州也支持两种类型 ▼▼▼
    huizhou: [
        { code: 'rent_std',  name: '纯租租赁' },
        { code: 'rent_rto', name: '以租代购' },
    ],
    default: [{ code: 'rent_std', name: '纯租租赁' }],
  };
  
  // 编号中的 aa：广州按分公司映射 GZ1/GZ2，其他城市按城市默认
  export const AA_BY_BRANCH = {
    gzh_a: 'GZ1',
    gzh_b: 'GZ2',
  };
  export const AA_DEFAULT_PER_CITY = {
    guangzhou: 'GZ',
    foshan: 'FS',
    huizhou: 'HZ',
    jiaxing: 'JX',
    shaoxing: 'SX',
    nantong: 'NT',
    changzhou: 'CZ',
    suzhou: 'SUZ',
  };
  