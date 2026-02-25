require('dotenv').config();
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const { connectDB } = require('./db');
const User = require('./models/User');
const ClassModel = require('./models/Class');

const SALT_ROUNDS = 10;

const upsertUser = async ({ role, username, email, name, password, classes }) => {
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const filter = username ? { username } : { email };
  const update = {
    role,
    username: username || undefined,
    email: email || undefined,
    name,
    classes: classes || [],
    passwordHash,
  };

  await User.findOneAndUpdate(filter, update, { upsert: true, new: true, setDefaultsOnInsert: true });
};

const seed = async () => {
  await connectDB();

  const className = 'Grade 11 Adv 3';
  await ClassModel.updateOne(
    { name: className },
    { $setOnInsert: { name: className, grade: '', section: '' } },
    { upsert: true }
  );

  await upsertUser({
    role: 'admin',
    username: 'admin',
    name: 'System Admin',
    password: 'psps26',
    classes: [],
  });

  await upsertUser({
    role: 'teacher',
    email: 'tum23092039@privatemoe.gov.ae',
    name: 'محمود النقيب',
    password: 'teacheruser1',
    classes: [className],
  });

  await upsertUser({
    role: 'student',
    email: 'stum2309230923@privatemoe.gov.ae',
    name: 'محمد مدثر',
    password: 'redbanana',
    classes: [className],
  });

  console.log('Seed complete: admin + teacher + student created/updated.');
  await mongoose.disconnect();
};

seed().catch(async (error) => {
  console.error('Seed failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
