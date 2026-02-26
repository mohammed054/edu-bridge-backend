require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { connectDB } = require('./db');
const User = require('./models/User');
const ClassModel = require('./models/Class');
const { HIKMAH_SUBJECTS } = require('./constants/subjects');

const SALT_ROUNDS = 10;
const DEFAULT_CLASS_NAME = process.env.SEED_CLASS_NAME || 'الصف 11 (1)';
const DEFAULT_TEACHER_SUBJECT = String(process.env.SEED_TEACHER_SUBJECT || HIKMAH_SUBJECTS[0]).trim();

const requiredSeedSecrets = [
  'SEED_ADMIN_PASSWORD',
  'SEED_TEACHER_PASSWORD',
  'SEED_STUDENT_PASSWORD',
];

for (const key of requiredSeedSecrets) {
  if (!process.env[key]) {
    throw new Error(`${key} is required in .env before running the seed script.`);
  }
}

const upsertUser = async ({ role, username, email, name, password, classes, subjects }) => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const filter = username ? { username } : { email };
  const update = {
    role,
    username: username || undefined,
    email: email || undefined,
    name,
    classes: classes || [],
    subjects: subjects || [],
    passwordHash,
  };

  await User.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
};

const seed = async () => {
  await connectDB();

  const className = DEFAULT_CLASS_NAME;
  await ClassModel.updateOne(
    { name: className },
    { $setOnInsert: { name: className, grade: '', section: '' } },
    { upsert: true }
  );

  await upsertUser({
    role: 'admin',
    username: 'admin',
    name: process.env.SEED_ADMIN_NAME || 'إدارة المدرسة',
    password: process.env.SEED_ADMIN_PASSWORD,
    classes: [],
    subjects: [],
  });

  await upsertUser({
    role: 'teacher',
    email: (process.env.SEED_TEACHER_EMAIL || 'tum00000001@privatemoe.gov.ae').toLowerCase(),
    name: process.env.SEED_TEACHER_NAME || 'معلم تجريبي',
    password: process.env.SEED_TEACHER_PASSWORD,
    classes: [className],
    subjects: [DEFAULT_TEACHER_SUBJECT],
  });

  await upsertUser({
    role: 'student',
    email: (process.env.SEED_STUDENT_EMAIL || 'stum00000001@privatemoe.gov.ae').toLowerCase(),
    name: process.env.SEED_STUDENT_NAME || 'طالب تجريبي',
    password: process.env.SEED_STUDENT_PASSWORD,
    classes: [className],
    subjects: [],
  });

  console.log('تم تجهيز بيانات الإدارة والمعلم والطالب.');
  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error('فشل تجهيز البيانات:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
