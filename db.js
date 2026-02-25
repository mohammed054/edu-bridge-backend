const mongoose = require('mongoose');
const Teacher = require('./models/Teacher');
const ClassModel = require('./models/Class');
const Student = require('./models/Student');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  }
};

const seedBaseData = async () => {
  const defaultTeacher =
    (await Teacher.findOne({ employeeId: 'T-001' })) ||
    (await Teacher.create({
      name: 'Maha Khaled',
      email: 'maha.teacher@school.local',
      employeeId: 'T-001',
      subject: 'Advisory',
      avatarUrl: '',
    }));

  const defaultClass =
    (await ClassModel.findOne({ name: 'Grade 11 Adv 3' })) ||
    (await ClassModel.create({
      name: 'Grade 11 Adv 3',
      grade: '11',
      section: 'Adv 3',
      teacherId: defaultTeacher._id,
    }));

  const seedStudents = [
    { name: 'Lina Saad', studentId: 'S-1101', email: 'lina.saad@student.local', guardianName: 'Mr. Saad' },
    { name: 'Omar Nasser', studentId: 'S-1102', email: 'omar.nasser@student.local', guardianName: 'Mrs. Nasser' },
    { name: 'Sara Ali', studentId: 'S-1103', email: 'sara.ali@student.local', guardianName: 'Mr. Ali' },
    { name: 'Yousef Hamad', studentId: 'S-1104', email: 'yousef.hamad@student.local', guardianName: 'Mrs. Hamad' },
    { name: 'Mariam Adel', studentId: 'S-1105', email: 'mariam.adel@student.local', guardianName: 'Mr. Adel' },
  ];

  for (const student of seedStudents) {
    const exists = await Student.findOne({ studentId: student.studentId });
    if (!exists) {
      await Student.create({
        ...student,
        classId: defaultClass._id,
      });
    }
  }
};

module.exports = { connectDB, seedBaseData };
