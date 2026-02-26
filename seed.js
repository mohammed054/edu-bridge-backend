require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { connectDB } = require('./db');
const User = require('./models/User');
const ClassModel = require('./models/Class');
const Subject = require('./models/Subject');
const { HIKMAH_SUBJECTS } = require('./constants/subjects');
const { ADMIN_USERNAME } = require('./utils/userValidation');

const SALT_ROUNDS = 10;
const DEFAULT_CLASS_NAME = process.env.SEED_CLASS_NAME || '???? 11 (1)';
const DEFAULT_TEACHER_SUBJECT = String(process.env.SEED_TEACHER_SUBJECT || HIKMAH_SUBJECTS[0]).trim();

const requiredSeedSecrets = ['SEED_ADMIN_PASSWORD', 'SEED_TEACHER_PASSWORD', 'SEED_STUDENT_PASSWORD'];

for (const key of requiredSeedSecrets) {
  if (!process.env[key]) {
    throw new Error(`${key} is required in .env before running the seed script.`);
  }
}

const upsertUser = async ({ role, username, email, name, password, classes, subject }) => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const filter = username ? { username } : { email };
  const update = {
    role,
    username: username || undefined,
    email: email || undefined,
    name,
    classes: classes || [],
    subject: subject || '',
    subjects: subject ? [subject] : [],
    passwordHash,
  };

  const user = await User.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  return user;
};

const seed = async () => {
  await connectDB();

  await Promise.all(
    HIKMAH_SUBJECTS.map((subjectName) =>
      Subject.updateOne(
        { name: subjectName },
        { $setOnInsert: { name: subjectName, maxMarks: 100 } },
        { upsert: true }
      )
    )
  );

  const className = DEFAULT_CLASS_NAME;
  await ClassModel.updateOne(
    { name: className },
    { $setOnInsert: { name: className, grade: '', section: '', teachers: [], subjects: [DEFAULT_TEACHER_SUBJECT] } },
    { upsert: true }
  );

  await upsertUser({
    role: 'admin',
    username: ADMIN_USERNAME,
    name: process.env.SEED_ADMIN_NAME || '????? ???????',
    password: process.env.SEED_ADMIN_PASSWORD,
    classes: [],
    subject: '',
  });

  const teacher = await upsertUser({
    role: 'teacher',
    email: (process.env.SEED_TEACHER_EMAIL || 'tum00000001@privatemoe.gov.ae').toLowerCase(),
    name: process.env.SEED_TEACHER_NAME || '???? ??????',
    password: process.env.SEED_TEACHER_PASSWORD,
    classes: [className],
    subject: DEFAULT_TEACHER_SUBJECT,
  });

  await upsertUser({
    role: 'student',
    email: (process.env.SEED_STUDENT_EMAIL || 'stum00000001@moe.sch.ae').toLowerCase(),
    name: process.env.SEED_STUDENT_NAME || '???? ??????',
    password: process.env.SEED_STUDENT_PASSWORD,
    classes: [className],
    subject: '',
  });

  await ClassModel.updateOne(
    { name: className },
    {
      $addToSet: {
        teachers: teacher._id,
        subjects: DEFAULT_TEACHER_SUBJECT,
      },
    }
  );

  console.log('?? ????? ?????? ??????? ??????? ??????? ???????.');
  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error('??? ????? ????????:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});


