const mongoose = require('mongoose');

const campusSchema = new mongoose.Schema(
  {
    campusId: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, default: 'Asia/Dubai', trim: true },
    locale: { type: String, default: 'ar-AE', trim: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const academicYearSchema = new mongoose.Schema(
  {
    yearId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    state: {
      type: String,
      enum: ['active', 'frozen', 'archived'],
      default: 'active',
    },
    startsOn: { type: Date, default: null },
    endsOn: { type: Date, default: null },
  },
  { _id: false }
);

const systemSettingSchema = new mongoose.Schema(
  {
    institutionId: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    institutionName: {
      type: String,
      default: 'Hikmah School',
      trim: true,
    },
    currentAcademicYear: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    defaultTimezone: {
      type: String,
      default: 'Asia/Dubai',
      trim: true,
    },
    defaultLocale: {
      type: String,
      default: 'ar-AE',
      trim: true,
    },
    campuses: {
      type: [campusSchema],
      default: [],
    },
    academicYears: {
      type: [academicYearSchema],
      default: [],
    },
    permissionMatrix: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
