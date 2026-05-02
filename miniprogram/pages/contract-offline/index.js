import { BRANCH_OPTIONS_BY_CITY, TYPE_OPTIONS_BY_CITY } from '../../utils/config';
const { ensureAccess } = require('../../utils/guard');
const app = getApp();

const BASE_FIELDS = [
  // ---- Client ----
  { name: 'clientName', label: '姓名', type: 'string', requiredWhen: 'always', maxLength: 12 },
  { name: 'clientId', label: '身份证号码', type: 'string', requiredWhen: 'always', minLength: 18, maxLength: 18 },
  { name: 'clientPhone', label: '电话', type: 'string', requiredWhen: 'always', min: 0, minLength: 11, maxLength: 11 },

  // ---- Car ----
  { name: 'carModel', label: '车型', type: 'string', disabled: true, requiredWhen: 'never', maxLength: 50, hideOnCreate: true },
  { name: 'carPlate', label: '车牌号', type: 'string', disabled: true, requiredWhen: 'never', minLength: 8, maxLength: 8, hideOnCreate: true },

  // ---- Contract / Rent ----
  { name: 'contractDate', label: '签约日期', type: 'date', requiredWhen: 'always' },
  { name: 'rentDurationMonth', label: '租期（月）', type: 'number', requiredWhen: 'always', min: 1, max: 60 },
  { name: 'termType', label: '年限选择', type: 'string', requiredWhen: 'never' },
  { name: 'contractValidPeriodStart', label: '生效日期', type: 'date', requiredWhen: 'always' },
  { name: 'contractValidPeriodEnd', label: '结束日期', type: 'date', requiredWhen: 'always' },
  { name: 'rentPaybyDayInMonth', label: '每月支付日', type: 'number', requiredWhen: 'always', help: '1-31号', min: 1, max: 31 },

  // ---- Type specifics (std) ----
  { name: 'rentMonthly', label: '月租金', type: 'number', requiredWhen: 'never', min: 0 }, 
  { name: 'rentToday', label: '首日支付金', type: 'number', requiredWhen: 'never', min: 0 },

  // ---- Type specifics (rto) ----
  { name: 'rentMonthlyFirstYear', label: '1—12期租金', type: 'number', requiredWhen: 'never', min: 0, hideOnCreate: true },
  { name: 'rentMonthlySecondYear', label: '13—24期租金', type: 'number', requiredWhen: 'never', min: 0, hideOnCreate: true },
  { name: 'sellPrice', label: '车辆购买售价', type: 'number', requiredWhen: 'never', min: 0, hideOnCreate: true },

  // ---- Deposit ----
  { name: 'deposit', label: '押金总额', type: 'number', requiredWhen: 'always', min: 0 },
  { name: 'depositToday', label: '押金首付', type: 'number', requiredWhen: 'always', min: 0 }
];

const FIELDS = BASE_FIELDS.map(f => ({
  ...f,
  required: (f.requiredWhen === 'always')
}));

Page({
  data: {
    cityCode: '',
    city: '',
    selectedBranchCode: '',
    selectedBranchName: '',

    showTypePicker: false,
    typeOptions: [],
    typeIndex: -1,
    selectedTypeCode: '',
    selectedTypeName: '',

    vehiclePickerOptions: [],
    vehiclePickerRange: [],
    vehiclePickerIndex: -1,

    fields: FIELDS,
    form: {},
    visibleFields: [],
    saving: false,
    mode: 'create',
    id: '',
  },

  onLoad(options) {
    const run = () => {
      if (!ensureAccess()) return;
      const cityCode = decodeURIComponent(options.cityCode || '');
      const city = decodeURIComponent(options.city || '');
      const selectedBranchCode = options.branchCode || '';
      const selectedBranchName = decodeURIComponent(options.branchName || '');
      const mode = options.mode || 'create';
      const id = options.id || '';

      this.setData({ cityCode, city, selectedBranchCode, selectedBranchName, mode, id });
      wx.setNavigationBarTitle({ title: mode === 'edit' ? `编辑线下合同 - ${city}` : `补录线下合同 - ${city}` });

      this.initVisibleFields();

      // Only keeping rent_std and rent_rto for offline mode per requirements
      const allTypes = TYPE_OPTIONS_BY_CITY[cityCode] || TYPE_OPTIONS_BY_CITY.default;
      const typeOptions = allTypes.filter(t => t.code === 'rent_std' || t.code === 'rent_rto');
      if (typeOptions.length === 0) typeOptions.push({ code: 'rent_std', name: '纯租租赁' });

      const showTypePicker = typeOptions.length > 1;
      const typeIndex = typeOptions.length === 1 ? 0 : -1;
      const selectedTypeCode = typeIndex >= 0 ? typeOptions[typeIndex].code : '';
      const selectedTypeName = typeIndex >= 0 ? typeOptions[typeIndex].name : '';

      this.setData({
        typeOptions, showTypePicker, typeIndex, selectedTypeCode, selectedTypeName,
      });

      if (mode === 'edit') {
        this.loadContract(id);
      } else {
        this.loadAvailableVehicles(cityCode, selectedBranchCode);
      }
    };
    if (app.globalData.initialized) run();
    else app.$whenReady(run);
  },

  initVisibleFields() {
    const visible = this.data.fields.filter(f => !f.hideOnCreate);
    this.setData({ visibleFields: visible });
  },

  async loadContract(id) {
    wx.showLoading({ title: '加载中...', mask: true });
    try {
      const db = wx.cloud.database();
      const res = await db.collection('contracts').doc(id).get();
      const contract = res.data;
      if (!contract) throw new Error('合同不存在');

      const fields = contract.fields || {};
      const typeCode = contract.contractType || 'rent_std';
      const typeName = contract.contractTypeName || '普通租赁';
      
      const tIdx = this.data.typeOptions.findIndex(t => t.code === typeCode);
      
      this.setData({
        form: Object.assign({}, fields),
        selectedTypeCode: typeCode,
        selectedTypeName: typeName,
        typeIndex: tIdx,
        vehiclePickerRange: [`${fields.carPlate || ''} ${fields.carModel || ''}`.trim()],
        vehiclePickerIndex: 0,
      });
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onPickType(e) {
    const idx = Number(e.detail.value);
    const opt = this.data.typeOptions[idx];
    this.setData({
      typeIndex: idx,
      selectedTypeCode: opt.code,
      selectedTypeName: opt.name,
    });
  },

  onInput(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  onInputNumber(e) {
    const name = e.currentTarget.dataset.name;
    let value = e.detail.value;
    if (name === 'rentPaybyDayInMonth' && value !== '') {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 1 || num > 31) {
        wx.showToast({ title: '只能1-31', icon: 'none' });
        value = value.slice(0, -1);
      }
    }
    this.setData({ [`form.${name}`]: value });
  },

  onTermTypeChange(e) {
    const val = Number(e.detail.value) === 1 ? 'long_term' : 'standard';
    this.setData({ 'form.termType': val });
  },

  onDateChange(e) {
    const name = e.currentTarget.dataset.name;
    const value = e.detail.value;
    this.setData({ [`form.${name}`]: value });
  },

  async loadAvailableVehicles(cityCode, branchCode = '') {
    wx.showLoading({ title: '加载车辆...', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'vehicleOps',
        data: { action: 'listAvailable', payload: { cityCode, branchCode } }
      });
      const data = res.result?.list || [];
      this.setData({
        vehiclePickerOptions: data,
        vehiclePickerRange: data.map(v => `${v.plate || ''} ${v.model || ''}`.trim()),
        vehiclePickerIndex: -1
      });
    } catch (e) {
      wx.showToast({ title: '加载车辆失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onVehiclePickChange(e) {
    const idx = Number(e.detail.value);
    const vehicle = this.data.vehiclePickerOptions[idx];
    if (!vehicle) return;
    this.setData({
      vehiclePickerIndex: idx,
      'form.carPlate': vehicle.plate || '',
      'form.carModel': vehicle.model || '',
      'form.carColor': vehicle.color || '',
      'form.carVin': vehicle.vin || '',
    });
  },

  validate() {
    const { form, selectedTypeCode, mode } = this.data;
    if (!selectedTypeCode) return '请选择合同类型';
    if (mode === 'create' && (this.data.vehiclePickerIndex < 0 || !form.carPlate)) return '请选择车辆';

    for (const f of FIELDS) {
      const v = form[f.name];
      // Type specific skips
      if (selectedTypeCode === 'rent_rto' && (f.name === 'rentMonthly' || f.name === 'rentToday')) continue;
      
      if (f.required) {
        if (f.name === 'contractValidPeriodEnd' && form.termType === 'long_term') continue;
        if (v === undefined || v === null || v === '') return `${f.label}必填`;
      }
    }

    if (selectedTypeCode === 'rent_rto') {
      if (!form.rentMonthlyFirstYear) return '1—12期租金必填';
      if (!form.rentMonthlySecondYear) return '13—24期租金必填';
      if (!form.sellPrice) return '车辆购买售价必填';
    } else {
      if (!form.rentMonthly && form.rentMonthly !== 0) return '月租金必填';
      if (!form.rentToday && form.rentToday !== 0) return '首日支付金必填';
    }

    const { contractValidPeriodStart: s, contractValidPeriodEnd: e, termType } = form;
    if (termType !== 'long_term' && s && e && e <= s) return '结束日期必须晚于开始日期';

    return '';
  },

  toPersistObject() {
    const obj = {};
    for (const f of FIELDS) {
      let v = this.data.form[f.name];
      if (f.name === 'contractValidPeriodEnd' && this.data.form.termType === 'long_term') {
        v = '长期有效';
      }
      if (f.type === 'number') obj[f.name] = v === '' || v == null ? null : Number(v);
      else obj[f.name] = v !== undefined ? v : null;
    }
    return obj;
  },

  async onSubmit() {
    const err = this.validate();
    if (err) return wx.showToast({ title: err, icon: 'none', duration: 3000 });

    const payload = this.toPersistObject();
    
    if (this.data.saving) return;
    this.setData({ saving: true });

    wx.showLoading({ title: '登记写入中...', mask: true });

    try {
      if (this.data.mode === 'edit' && this.data.id) {
        // Edit mode
        const res = await wx.cloud.callFunction({
          name: 'contractOps',
          data: { action: 'update', id: this.data.id, fields: payload }
        });
        if (res?.result?.error) throw new Error(res.result.error);
        
        wx.showToast({ title: '更新成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 1500);
      } else {
        // Create mode
        const res = await wx.cloud.callFunction({
          name: 'contractV2',
          data: {
            cityCode: this.data.cityCode,
            cityName: this.data.city,
            branchCode: this.data.selectedBranchCode || null,
            branchName: this.data.selectedBranchName || null,
            contractType: this.data.selectedTypeCode,
            contractTypeName: this.data.selectedTypeName,
            isOffline: true,
            payload
          }
        });

        const result = res?.result || {};
        if (result.error) throw new Error(result.error);

        wx.showToast({ title: '已收录为线下合同', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack({ delta: 1 });
        }, 1500);
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  }
});
