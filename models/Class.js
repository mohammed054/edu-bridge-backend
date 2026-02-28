const mongoose = require('mongoose');

const classSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    grade: { type: String, default: '', trim: true },
    section: { type: String, default: '', trim: true },
    institutionId: { type: String, default: 'hikmah-main', trim: true, index: true },
    campusId: { type: String, default: 'main-campus', trim: true, index: true },
    academicYear: { type: String, default: '', trim: true, index: true },
    capacity: { type: Number, default: 35, min: 1 },
    isArchived: { type: Boolean, default: false, index: true },
    teachers: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    subjects: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model('Class', classSchema);


