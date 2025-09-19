// pages/contract-new/index.js
const db = wx.cloud.database();
const COL = db.collection('contracts');

const FIELDS = [
  // ---- Branch ----
  { name:'branchName', label:'门店名称', type:'string', required:true,  maxLength:50 },
  { name:'branchAddress', label:'门店地址', type:'string', required:true, maxLength:200 },
  { name:'branchManagerName', label:'门店负责人姓名', type:'string', required:true, maxLength:50 },
  { name:'branchLicense', label:'门店营业执照号', type:'string', required:false, maxLength:100 },
  { name:'branchPhone', label:'门店电话', type:'number', required:true, min:0, strLenMin:5, strLenMax:20, help:'5-20位' },
  { name:'branchBankAccount', label:'门店银行账号', type:'number', required:true, min:0, strLenMin:6, strLenMax:30, help:'6-30位' },
  { name:'branchBankName', label:'开户行名称', type:'string', required:true, maxLength:100 },
  { name:'branchCityCode', label:'城市编码', type:'string', required:true, maxLength:10 },

  // ---- Client ----
  { name:'clientName', label:'客户姓名', type:'string', required:true, maxLength:50 },
  { name:'clientId', label:'客户证件号（数字）', type:'number', required:true, min:0, strLenMin:6, strLenMax:30 },
  { name:'clientPhone', label:'客户电话', type:'number', required:true, min:0, strLenMin:5, strLenMax:20, help:'5-20位' },
  { name:'clientAddress', label:'客户地址', type:'string', required:true, maxLength:200 },
  { name:'clientEmergencyContact', label:'紧急联系人姓名', type:'string', required:true, maxLength:50 },
  { name:'clientEmergencyPhone', label:'紧急联系人电话', type:'number', required:true, min:0, strLenMin:5, strLenMax:20, help:'5-20位' },

  // ---- Car ----
  { name:'carModel', label:'车型', type:'string', required:true, maxLength:50 },
  { name:'carColor', label:'车身颜色', type:'string', required:true, maxLength:20 },
  { name:'carPlate', label:'车牌号', type:'string', required:true, maxLength:15 },
  { name:'carVin', label:'VIN（17位）', type:'string', required:true, minLength:17, maxLength:17, help:'必须17位' },
  { name:'carRentalCity', label:'租赁城市', type:'string', required:true, maxLength:20 },

  // ---- Contract / Rent ----
  { name:'contractValidPeriodStart', label:'合同生效日期', type:'date', required:true },
  { name:'contractValidPeriodEnd', label:'合同结束日期', type:'date', required:true },
  { name:'rentDurationMonth', label:'租期（月）', type:'number', required:true, min:1, max:120 },
  { name:'rentMonthly', label:'月租（数字）', type:'number', required:true, min:0 },
  { name:'rentMonthlyFormal', label:'月租（大写/中文）', type:'string', required:false, maxLength:50 },
  { name:'rentToday', label:'首日支付（数字）', type:'number', required:true, min:0 },
  { name:'rentTodayFormal', label:'首日支付（大写/中文）', type:'string', required:false, maxLength:50 },
  { name:'rentPaybyDayInMonth', label:'每月支付日（1-31）', type:'number', required:true, min:1, max:31 },

  // ---- Deposit ----
  { name:'deposit', label:'押金总额', type:'number', required:true, min:0 },
  { name:'depositInitial', label:'押金首付', type:'number', required:true, min:0 },
  { name:'depositFormal', label:'押金总额（大写/中文）', type:'string', required:false, maxLength:50 },
  { name:'depositServiceFee', label:'服务费', type:'number', required:true, min:0 },
  { name:'depositServiceFeeFormal', label:'服务费（大写/中文）', type:'string', required:false, maxLength:50 },

  // ---- Dates / Serial ----
  { name:'contractDate', label:'签约日期', type:'date', required:true },
  { name:'contractSerialNumber', label:'合同流水号', type:'number', required:true, min:0, strLenMin:1, strLenMax:20 },
];

Page({
  data: {
    city: '',
    mode: 'create', // create | view | edit
    id: '',
    fields: FIELDS,
    form: {}
  },

  onLoad(query) {
    const city = decodeURIComponent(query.city || '');
    const mode = (query.mode || 'create');
    const id = query.id || '';
    this.setData({ city, mode, id, fields: FIELDS });
    wx.setNavigationBarTitle({ title: `${city} - ${mode === 'create' ? '新增' : (mode === 'view' ? '查看' : '编辑')}` });
    if (id) this.fetchDetail(id);
  },

  async fetchDetail(id) {
    try {
      const { data } = await COL.doc(id).get();
      // 兼容老数据结构
      const form = data.fields || {};
      this.setData({ form });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 文本输入
  onInput(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  // 数字输入（保留字符串以便长度校验，再在保存时转为 Number）
  onInputNumber(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // 先保留字符串
    this.setData({ [`form.${name}`]: value });
  },

  // 日期
  onDateChange(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value; // yyyy-mm-dd
    this.setData({ [`form.${name}`]: value });
  },

  // 校验函数
  validate() {
    const { form } = this.data;
    for (const f of FIELDS) {
      const v = form[f.name];

      // 必填
      if (f.required) {
        if (f.type === 'string' && (!v || !String(v).trim())) {
          return `${f.label}为必填`;
        }
        if ((f.type === 'number' || f.type === 'date') && (v === undefined || v === null || v === '')) {
          return `${f.label}为必填`;
        }
      }

      // 类型与长度/范围
      if (f.type === 'string' && v) {
        const len = String(v).length;
        if (f.minLength && len < f.minLength) return `${f.label}长度需≥${f.minLength}`;
        if (f.maxLength && len > f.maxLength) return `${f.label}长度需≤${f.maxLength}`;
      }

      if (f.type === 'number' && (v !== '' && v !== undefined)) {
        const str = String(v);
        // 数字的“长度”要求（如账号/电话），先以字符串长度校验
        if (f.strLenMin && str.length < f.strLenMin) return `${f.label}长度需≥${f.strLenMin}`;
        if (f.strLenMax && str.length > f.strLenMax) return `${f.label}长度需≤${f.strLenMax}`;
        // 再转为数值检查范围
        const num = Number(v);
        if (!isFinite(num)) return `${f.label}必须为数字`;
        if (f.min !== undefined && num < f.min) return `${f.label}需≥${f.min}`;
        if (f.max !== undefined && num > f.max) return `${f.label}需≤${f.max}`;
      }

      if (f.type === 'date' && v) {
        // 简单校验格式 yyyy-mm-dd
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${f.label}格式不正确`;
      }
    }
    // 额外强约束：VIN 17位
    if ((form.carVin || '').length !== 17) return 'VIN 必须为 17 位';
    // 每月支付日 1-31（上面已校验 min/max，这里冗余保护）
    const payDay = Number(form.rentPaybyDayInMonth);
    if (!(payDay >= 1 && payDay <= 31)) return '每月支付日需在 1 到 31 之间';
    return ''; // 通过
  },

  // 保存前转换数字
  toPersistObject() {
    const obj = {};
    for (const f of FIELDS) {
      const v = this.data.form[f.name];
      if (f.type === 'number') {
        obj[f.name] = (v === '' || v === undefined || v === null) ? null : Number(v);
      } else {
        obj[f.name] = v !== undefined ? v : null;
      }
    }
    return obj;
  },

  async onSubmit() {
    const { city, mode, id } = this.data;

    const err = this.validate();
    if (err) {
      wx.showToast({ title: err, icon: 'none' });
      return;
    }

    const fields = this.toPersistObject();

    try {
      if (mode === 'create') {
        await COL.add({
          data: {
            city,
            fields,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          }
        });
        wx.showToast({ title: '已保存' });
      } else if (mode === 'edit' && id) {
        await COL.doc(id).update({
          data: { fields, updatedAt: db.serverDate() }
        });
        wx.showToast({ title: '已更新' });
      }
      setTimeout(() => { wx.navigateBack({ delta: 1 }); }, 300);
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  toEdit() {
    const { city, id } = this.data;
    wx.navigateTo({
      url: `/pages/contract-new/index?city=${encodeURIComponent(city)}&mode=edit&id=${id}`
    });
  }
});
